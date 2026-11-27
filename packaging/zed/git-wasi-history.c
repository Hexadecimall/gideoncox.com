#include "git-wasi.h"

#include <git2/sys/errors.h>
#include <inttypes.h>
#include <locale.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <wchar.h>
#include <wctype.h>

static int is_history_ref(const char *name)
{
    return !strncmp(name, "refs/heads/", 11) || !strncmp(name, "refs/remotes/", 13) ||
        !strncmp(name, "refs/tags/", 10);
}

static void write_oid(const git_oid *id)
{
    char hex[GIT_OID_HEXSZ + 1];
    fputs(git_oid_tostr(hex, sizeof(hex), id), stdout);
}

static int history_head(git_repository *repo)
{
    git_reference *head = NULL;
    int code = git_repository_head(&head, repo);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
        return 0;
    if (code < 0)
        return code;
    git_wasi_field("R");
    write_oid(git_reference_target(head));
    fputc('\0', stdout);
    if (git_reference_is_branch(head)) {
        fputs("HEAD -> ", stdout);
        git_wasi_field(git_reference_shorthand(head));
    } else {
        git_wasi_field("HEAD");
    }
    git_reference_free(head);
    return 0;
}

static int history_refs(git_repository *repo, git_revwalk *walk, int all, int decorate)
{
    git_reference_iterator *iterator = NULL;
    git_reference *ref = NULL;
    int code = git_reference_iterator_new(&iterator, repo);
    if (code < 0)
        return code;
    while ((code = git_reference_next(&ref, iterator)) == 0) {
        const char *name = git_reference_name(ref);
        if (is_history_ref(name)) {
            git_object *commit = NULL;
            if (git_reference_peel(&commit, ref, GIT_OBJECT_COMMIT) == 0) {
                const git_oid *id = git_object_id(commit);
                if (decorate) {
                    git_wasi_field("R");
                    write_oid(id);
                    fputc('\0', stdout);
                    git_wasi_field(name);
                }
                if (all)
                    code = git_revwalk_push(walk, id);
            }
            git_object_free(commit);
        }
        git_reference_free(ref);
        if (code < 0)
            break;
    }
    git_reference_iterator_free(iterator);
    return code == GIT_ITEROVER ? 0 : code;
}

static int start_revision(git_revwalk *walk, git_repository *repo, const char *scope, const char *value)
{
    if (!strcmp(scope, "all") || !strcmp(scope, "path")) {
        int code = git_revwalk_push_head(walk);
        return code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH ? 0 : code;
    }

    git_object *commit = NULL;
    int code;
    if (!strcmp(scope, "branch") && strcmp(value, "HEAD")) {
        git_reference *branch = NULL;
        code = git_branch_lookup(&branch, repo, value, GIT_BRANCH_LOCAL);
        if (code == GIT_ENOTFOUND)
            code = git_branch_lookup(&branch, repo, value, GIT_BRANCH_REMOTE);
        if (code == 0)
            code = git_reference_peel(&commit, branch, GIT_OBJECT_COMMIT);
        git_reference_free(branch);
    } else {
        code = git_revparse_single(&commit, repo, value);
    }
    if (code == 0)
        code = git_revwalk_push(walk, git_object_id(commit));
    git_object_free(commit);
    return code;
}

static int is_shallow_boundary(git_repository *repo, const git_oid *oid);

static int file_entry(git_tree_entry **entry, git_tree *tree, const char *path)
{
    if (!tree)
        return 0;
    int code = git_tree_entry_bypath(entry, tree, path);
    if (code == 0 && git_tree_entry_type(*entry) == GIT_OBJECT_TREE) {
        git_tree_entry_free(*entry);
        *entry = NULL;
    }
    return code == GIT_ENOTFOUND ? 0 : code;
}

int git_wasi_find_rename(char **source, git_repository *repo, git_tree *parent, git_tree *tree, const char *path)
{
    git_diff *diff = NULL;
    git_diff_options options;
    git_diff_find_options similar;
    int code = git_diff_options_init(&options, GIT_DIFF_OPTIONS_VERSION);
    if (code == 0) {
        options.flags |= GIT_DIFF_SKIP_BINARY_CHECK;
        code = git_diff_tree_to_tree(&diff, repo, parent, tree, &options);
    }
    if (code == 0)
        code = git_diff_find_options_init(&similar, GIT_DIFF_FIND_OPTIONS_VERSION);
    if (code == 0) {
        similar.flags = GIT_DIFF_FIND_RENAMES;
        code = git_diff_find_similar(diff, &similar);
    }
    if (code == 0) {
        for (size_t i = 0; i < git_diff_num_deltas(diff); i++) {
            const git_diff_delta *delta = git_diff_get_delta(diff, i);
            if (delta->status == GIT_DELTA_RENAMED && !strcmp(delta->new_file.path, path)) {
                *source = strdup(delta->old_file.path);
                if (!*source) {
                    git_error_set_oom();
                    code = -1;
                }
                break;
            }
        }
    }
    git_diff_free(diff);
    return code;
}

typedef struct path_visit {
    git_oid commit;
    char *path;
    struct path_visit *next;
} path_visit;

static void free_path_visits(path_visit *visit)
{
    while (visit) {
        path_visit *next = visit->next;
        free(visit->path);
        free(visit);
        visit = next;
    }
}

static int schedule_path(path_visit **pending, const git_oid *id, const char *path)
{
    for (const path_visit *visit = *pending; visit; visit = visit->next) {
        if (git_oid_equal(&visit->commit, id) && !strcmp(visit->path, path))
            return 0;
    }
    path_visit *visit = malloc(sizeof(*visit));
    if (!visit || !(visit->path = strdup(path))) {
        free(visit);
        git_error_set_oom();
        return -1;
    }
    visit->commit = *id;
    visit->next = *pending;
    *pending = visit;
    return 0;
}

static int schedule_head_path(path_visit **pending, git_repository *repo, const char *path)
{
    git_reference *head = NULL;
    int code = git_repository_head(&head, repo);
    if (code == 0)
        code = schedule_path(pending, git_reference_target(head), path);
    git_reference_free(head);
    return code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH ? 0 : code;
}

static int follow_parent(git_repository *repo, git_tree *tree, const git_oid *parent_id,
                         const char *path, path_visit **pending, int *changed)
{
    git_tree *parent_tree = NULL;
    git_commit *parent = NULL;
    git_tree_entry *before = NULL;
    git_tree_entry *after = NULL;
    char *rename_source = NULL;
    int code = parent_id ? git_commit_lookup(&parent, repo, parent_id) : 0;
    if (code == 0 && parent)
        code = git_commit_tree(&parent_tree, parent);
    if (code == 0)
        code = file_entry(&before, parent_tree, path);
    if (code == 0)
        code = file_entry(&after, tree, path);
    if (code == 0) {
        *changed = before && after
            ? !git_oid_equal(git_tree_entry_id(before), git_tree_entry_id(after)) ||
                git_tree_entry_filemode(before) != git_tree_entry_filemode(after)
            : before || after;
        if (!before && after && parent_tree)
            code = git_wasi_find_rename(&rename_source, repo, parent_tree, tree, path);
    }
    if (code == 0 && parent_id)
        code = schedule_path(pending, parent_id, rename_source ? rename_source : path);
    free(rename_source);
    git_tree_entry_free(before);
    git_tree_entry_free(after);
    git_tree_free(parent_tree);
    git_commit_free(parent);
    return code;
}

static int file_history_match(git_repository *repo, const git_commit *commit,
                              path_visit **pending, int *match)
{
    const git_oid *id = git_commit_id(commit);
    path_visit *paths = NULL;
    for (path_visit **link = pending; *link;) {
        path_visit *visit = *link;
        if (git_oid_equal(&visit->commit, id)) {
            *link = visit->next;
            visit->next = paths;
            paths = visit;
        } else {
            link = &visit->next;
        }
    }
    *match = 0;
    if (!paths)
        return 0;

    git_tree *tree = NULL;
    int code = git_commit_tree(&tree, commit);
    const unsigned int parents = is_shallow_boundary(repo, id) ? 0 : git_commit_parentcount(commit);
    for (path_visit *visit = paths; visit && code == 0; visit = visit->next) {
        // Follow each parent's filename independently. Omit merge diffs.
        for (unsigned int i = 0; i < (parents ? parents : 1) && code == 0; i++) {
            const git_oid *parent = parents ? git_commit_parent_id(commit, i) : NULL;
            int changed = 0;
            code = follow_parent(repo, tree, parent, visit->path, pending, &changed);
            if (parents <= 1 && changed)
                *match = 1;
        }
    }
    git_tree_free(tree);
    free_path_visits(paths);
    return code;
}

static void write_history_commit(const git_commit *commit, int author_date)
{
    const git_oid *id = git_commit_id(commit);
    if (author_date) {
        git_wasi_field("A");
        write_oid(id);
        printf("%c%" PRId64 "%c", 0, (int64_t)git_commit_author(commit)->when.time, 0);
    }
    git_wasi_field("C");
    write_oid(id);
    fputc('\0', stdout);
    for (unsigned int i = 0; i < git_commit_parentcount(commit); i++) {
        if (i)
            fputc(' ', stdout);
        write_oid(git_commit_parent_id(commit, i));
    }
    fputc('\0', stdout);
}

int git_wasi_history(git_repository *repo, const char *scope, const char *value, const char *order)
{
    unsigned int flags;
    const int author_date = !strcmp(order, "author");
    const int path_scope = !strcmp(scope, "path");
    const int reverse_path = path_scope && !strcmp(order, "reverse");
    if (!strcmp(order, "date"))
        flags = GIT_SORT_TOPOLOGICAL | GIT_SORT_TIME;
    else if (!strcmp(order, "topo") || author_date)
        flags = GIT_SORT_TOPOLOGICAL;
    else if (!strcmp(order, "reverse"))
        flags = reverse_path ? GIT_SORT_TOPOLOGICAL | GIT_SORT_TIME : GIT_SORT_REVERSE | GIT_SORT_TIME;
    else {
        fputs("Unknown Git history order.\n", stderr);
        return 1;
    }

    path_visit *pending = NULL;
    git_oid *reverse_ids = NULL;
    size_t count = 0, capacity = 0;
    git_revwalk *walk = NULL;
    int code = git_revwalk_new(&walk, repo);
    if (code == 0)
        code = git_revwalk_sorting(walk, flags);
    if (code == 0)
        code = history_head(repo);
    if (code == 0)
        code = history_refs(repo, walk, !strcmp(scope, "all"), 1);
    if (code == 0)
        code = start_revision(walk, repo, scope, value);
    if (code == 0 && path_scope)
        code = schedule_head_path(&pending, repo, value);
    if (code == 0) {
        git_oid id;
        while ((code = git_revwalk_next(&id, walk)) == 0) {
            git_commit *commit = NULL;
            if ((code = git_commit_lookup(&commit, repo, &id)) < 0)
                break;
            int match = 1;
            if (path_scope)
                code = file_history_match(repo, commit, &pending, &match);
            if (code == 0 && match && reverse_path) {
                if (count == capacity) {
                    capacity = capacity ? capacity * 2 : 128;
                    git_oid *larger = realloc(reverse_ids, capacity * sizeof(*larger));
                    if (!larger) {
                        git_error_set_oom();
                        code = -1;
                    } else {
                        reverse_ids = larger;
                    }
                }
                if (code == 0)
                    reverse_ids[count++] = id;
            } else if (code == 0 && match) {
                write_history_commit(commit, author_date);
            }
            git_commit_free(commit);
            if (code < 0)
                break;
        }
        if (code == GIT_ITEROVER)
            code = 0;
    }
    while (code == 0 && count) {
        git_commit *commit = NULL;
        code = git_commit_lookup(&commit, repo, &reverse_ids[--count]);
        if (code == 0)
            write_history_commit(commit, 0);
        git_commit_free(commit);
    }
    free(reverse_ids);
    free_path_visits(pending);
    git_revwalk_free(walk);
    return code < 0 ? git_wasi_fail("Reading Git history") : 0;
}

static int fold_message(const char *text, wchar_t **folded)
{
    const size_t length = strlen(text) + 1;
    wchar_t *value = calloc(length, sizeof(*value));
    if (!value)
        return -1;

    mbstate_t state = {0};
    if (mbsrtowcs(value, &text, length, &state) == (size_t)-1) {
        free(value);
        *folded = NULL;
        return 0;
    }
    for (wchar_t *character = value; *character; character++)
        *character = towlower((wint_t)*character);
    *folded = value;
    return 0;
}

int git_wasi_search(git_repository *repo, const char *scope, const char *value, const char *mode, const char *query)
{
    const int hash_search = !strcmp(mode, "hash");
    const int ignore_case = !strcmp(mode, "ignore-case");
    const int path_scope = !strcmp(scope, "path");
    const size_t query_length = strlen(query);
    wchar_t *folded_query = NULL;
    if (ignore_case) {
        setlocale(LC_CTYPE, "C.UTF-8");
        if (fold_message(query, &folded_query) < 0) {
            fputs("Could not allocate Git search memory.\n", stderr);
            return 1;
        }
    }

    path_visit *pending = NULL;
    git_revwalk *walk = NULL;
    int code = git_revwalk_new(&walk, repo);
    if (code == 0)
        code = git_revwalk_sorting(walk, path_scope ? GIT_SORT_TOPOLOGICAL | GIT_SORT_TIME : GIT_SORT_TIME);
    if (code == 0 && !strcmp(scope, "all"))
        code = history_refs(repo, walk, 1, 0);
    if (code == 0)
        code = start_revision(walk, repo, scope, value);
    if (code == 0 && path_scope)
        code = schedule_head_path(&pending, repo, value);
    if (code == 0) {
        git_oid id;
        while ((code = git_revwalk_next(&id, walk)) == 0) {
            git_commit *commit = NULL;
            int match = 1;
            if (path_scope || !hash_search)
                code = git_commit_lookup(&commit, repo, &id);
            if (code == 0 && path_scope)
                code = file_history_match(repo, commit, &pending, &match);
            if (code < 0 || !match) {
                git_commit_free(commit);
                if (code < 0)
                    break;
                continue;
            }
            if (hash_search) {
                char hex[GIT_OID_HEXSZ + 1];
                if (query_length <= GIT_OID_HEXSZ &&
                    !strncasecmp(git_oid_tostr(hex, sizeof(hex), &id), query, query_length))
                    git_wasi_field(hex);
                git_commit_free(commit);
                continue;
            }

            const char *message = git_commit_message_raw(commit);
            wchar_t *folded_message = NULL;
            if (folded_query && fold_message(message, &folded_message) < 0) {
                git_commit_free(commit);
                git_error_set_oom();
                code = -1;
                break;
            }
            if (folded_message ? wcsstr(folded_message, folded_query) != NULL : strstr(message, query) != NULL) {
                write_oid(&id);
                fputc('\0', stdout);
            }
            free(folded_message);
            git_commit_free(commit);
        }
        if (code == GIT_ITEROVER)
            code = 0;
    }
    git_revwalk_free(walk);
    free_path_visits(pending);
    free(folded_query);
    return code < 0 ? git_wasi_fail("Searching Git history") : 0;
}

int git_wasi_raw_commit(git_repository *repo, const char *revision)
{
    git_oid oid;
    git_odb *database = NULL;
    git_odb_object *object = NULL;
    int code = git_oid_fromstr(&oid, revision);
    if (code == 0)
        code = git_repository_odb(&database, repo);
    if (code == 0)
        code = git_odb_read(&object, database, &oid);
    if (code == GIT_ENOTFOUND) {
        code = 2;
    } else if (code < 0) {
        code = git_wasi_fail("Reading the Git commit object");
    } else if (git_odb_object_type(object) != GIT_OBJECT_COMMIT) {
        code = 2;
    } else {
        const size_t size = git_odb_object_size(object);
        code = fwrite(git_odb_object_data(object), 1, size, stdout) == size ? 0 : 1;
    }
    git_odb_object_free(object);
    git_odb_free(database);
    return code;
}

static int is_shallow_boundary(git_repository *repo, const git_oid *oid)
{
    if (!git_repository_is_shallow(repo))
        return 0;
    FILE *file = fopen("/repo/.git/shallow", "r");
    if (!file)
        return 0;
    char hex[GIT_OID_HEXSZ + 1], line[GIT_OID_HEXSZ + 3];
    git_oid_tostr(hex, sizeof(hex), oid);
    int found = 0;
    while (fgets(line, sizeof(line), file)) {
        if (strcspn(line, "\r\n") == GIT_OID_HEXSZ && !memcmp(line, hex, GIT_OID_HEXSZ)) {
            found = 1;
            break;
        }
    }
    fclose(file);
    return found;
}

static int write_diff_file(git_repository *repo, const git_diff_file *file)
{
    if (!file->mode) {
        git_wasi_field("-");
        return 0;
    }
    if (file->mode == GIT_FILEMODE_COMMIT) {
        printf("%u%cSubproject commit ", (unsigned)(GIT_OID_HEXSZ + sizeof("Subproject commit ")), 0);
        write_oid(&file->id);
        fputc('\n', stdout);
        return 0;
    }
    git_blob *blob = NULL;
    int code = git_blob_lookup(&blob, repo, &file->id);
    if (code < 0)
        return code;
    const size_t size = git_blob_rawsize(blob);
    printf("%zu%c", size, 0);
    fwrite(git_blob_rawcontent(blob), 1, size, stdout);
    git_blob_free(blob);
    return 0;
}

int git_wasi_commit_files(git_repository *repo, const char *revision, int include_shallow)
{
    git_object *object = NULL, *target = NULL;
    git_commit *parent = NULL;
    git_tree *old_tree = NULL, *new_tree = NULL;
    git_diff *diff = NULL;
    git_diff_options options;
    int code = git_revparse_single(&object, repo, revision);
    if (code < 0 || (code = git_object_peel(&target, object, GIT_OBJECT_COMMIT)) < 0)
        goto done;
    git_commit *commit = (git_commit *)target;
    int boundary = is_shallow_boundary(repo, git_commit_id(commit));
    if (boundary && !include_shallow) {
        git_wasi_field("shallow");
        goto done;
    }
    if (!boundary && git_commit_parentcount(commit) &&
        ((code = git_commit_parent(&parent, commit, 0)) < 0 || (code = git_commit_tree(&old_tree, parent)) < 0))
        goto done;
    if ((code = git_diff_options_init(&options, GIT_DIFF_OPTIONS_VERSION)) < 0 ||
        (code = git_commit_tree(&new_tree, commit)) < 0)
        goto done;
    options.flags |= GIT_DIFF_INCLUDE_TYPECHANGE;
    if ((code = git_diff_tree_to_tree(&diff, repo, old_tree, new_tree, &options)) < 0)
        goto done;
    git_wasi_field("files");
    for (size_t i = 0; i < git_diff_num_deltas(diff); i++) {
        const git_diff_delta *change = git_diff_get_delta(diff, i);
        git_wasi_field(change->new_file.path);
        if ((code = write_diff_file(repo, &change->old_file)) < 0 ||
            (code = write_diff_file(repo, &change->new_file)) < 0)
            break;
    }
done:
    git_diff_free(diff);
    git_tree_free(new_tree);
    git_tree_free(old_tree);
    git_commit_free(parent);
    git_object_free(target);
    git_object_free(object);
    return code < 0 ? git_wasi_fail("Reading the files in the Git commit") : 0;
}
