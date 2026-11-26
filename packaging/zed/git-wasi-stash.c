#include "git-wasi.h"
#include <git2/sys/errors.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int stash_record(size_t index, const char *message, const git_oid *oid, void *payload)
{
    (void)message;
    git_commit *commit = NULL;
    int code = git_commit_lookup(&commit, payload, oid);
    if (code == 0) {
        char hex[GIT_OID_HEXSZ + 1];
        const char *summary = git_commit_summary(commit);
        printf("stash@{%zu}%c%s%c%" PRId64 "%c%s\n", index, 0,
            git_oid_tostr(hex, sizeof(hex), oid), 0, (int64_t)git_commit_time(commit), 0,
            summary ? summary : "");
    }
    git_commit_free(commit);
    return code;
}

int git_wasi_stash_list(git_repository *repo)
{
    int code = git_stash_foreach(repo, stash_record, repo);
    return code < 0 ? git_wasi_fail("Reading Git stashes") : 0;
}

int git_wasi_stash_restore(git_repository *repo, const char *action, const char *arg)
{
    char *end;
    unsigned long long index = strtoull(arg, &end, 10);
    if (*arg < '0' || *arg > '9' || *end || index > UINT32_MAX) {
        fputs("Invalid Git stash index.\n", stderr);
        return 1;
    }
    int code;
    if (!strcmp(action, "stash-apply"))
        code = git_stash_apply(repo, index, NULL);
    else if (!strcmp(action, "stash-pop"))
        code = git_stash_pop(repo, index, NULL);
    else
        code = git_stash_drop(repo, index);
    return code < 0 ? git_wasi_fail("Updating Git stash") : 0;
}

static int remove_index_path(git_index *index, const char *path)
{
    int code = git_index_remove_bypath(index, path);
    if (code == GIT_ENOTFOUND) {
        git_error_clear();
        return 0;
    }
    return code;
}

static int insert_worktree_file(
    git_index *index, git_repository *repo, const char *path, uint32_t mode)
{
    git_index_entry entry = {0};
    entry.path = path;
    entry.mode = mode;
    int code = git_blob_create_from_workdir(&entry.id, repo, path);
    return code < 0 ? code : git_index_add(index, &entry);
}

static int index_tree(git_tree **tree, git_repository *repo, git_index *index)
{
    git_oid id;
    int code = git_index_write_tree_to(&id, index, repo);
    return code < 0 ? code : git_tree_lookup(tree, repo, &id);
}

static int make_commit(git_commit **out, git_repository *repo, const git_signature *signature,
    const char *message, const git_tree *tree, size_t parent_count, const git_commit **parents)
{
    git_oid id;
    int code = git_commit_create(&id, repo, NULL, signature, signature, NULL, message,
        tree, parent_count, parents);
    return code < 0 ? code : git_commit_lookup(out, repo, &id);
}

static int order_paths(const void *left, const void *right)
{
    return strcmp(*(const char *const *)left, *(const char *const *)right);
}

static int include_rename_sources(git_strarray *selection, git_status_list **status,
    git_repository *repo, int count, char **paths)
{
    git_status_options options;
    int code = git_status_options_init(&options, GIT_STATUS_OPTIONS_VERSION);
    if (code < 0)
        return code;
    options.flags = GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX;
    if ((code = git_status_list_new(status, repo, &options)) < 0)
        return code;
    size_t entries = git_status_list_entrycount(*status);
    selection->strings = calloc((size_t)count + entries, sizeof(char *));
    if (!selection->strings)
        return -1;
    memcpy(selection->strings, paths, (size_t)count * sizeof(char *));
    qsort(selection->strings, (size_t)count, sizeof(char *), order_paths);
    for (int i = 0; i < count; ++i) {
        if (selection->count == 0 || strcmp(selection->strings[i], selection->strings[selection->count - 1]))
            selection->strings[selection->count++] = selection->strings[i];
    }
    size_t unique = selection->count;
    for (size_t i = 0; i < entries; ++i) {
        const git_status_entry *entry = git_status_byindex(*status, i);
        if (!(entry->status & GIT_STATUS_INDEX_RENAMED))
            continue;
        const git_diff_delta *rename = entry->head_to_index;
        if (bsearch(&rename->new_file.path, selection->strings, unique, sizeof(char *), order_paths) &&
            !bsearch(&rename->old_file.path, selection->strings, unique, sizeof(char *), order_paths))
            selection->strings[selection->count++] = (char *)rename->old_file.path;
    }
    return 0;
}

static int selected_trees(git_repository *repo, const git_tree *head, git_index *actual,
    git_tree **staged, git_tree **working, git_tree **untracked, git_strarray *tracked_paths,
    git_strarray *new_paths, int count, char **paths)
{
    git_index *selected = NULL, *work = NULL, *new_files = NULL;
    int code;
    if ((code = git_index_new(&selected)) < 0 || (code = git_index_new(&work)) < 0 ||
        (code = git_index_new(&new_files)) < 0 || (code = git_index_read_tree(selected, head)) < 0 ||
        (code = git_index_read_tree(work, head)) < 0)
        goto done;

    for (int i = 0; i < count; ++i) {
        const char *path = paths[i];
        unsigned int status;
        code = git_status_file(&status, repo, path);
        if (code == GIT_ENOTFOUND) {
            code = 0;
            continue;
        }
        if (code < 0)
            goto done;
        if (status == GIT_STATUS_CURRENT || status == GIT_STATUS_IGNORED)
            continue;

        const git_index_entry *prior = git_index_get_bypath(selected, path, 0);
        const git_index_entry *entry = git_index_get_bypath(actual, path, 0);
        uint32_t mode = entry ? entry->mode : prior ? prior->mode : GIT_FILEMODE_BLOB;
        if (!prior && !entry) {
            code = insert_worktree_file(new_files, repo, path, mode);
            if (code < 0)
                goto done;
            new_paths->strings[new_paths->count++] = paths[i];
            continue;
        }
        code = entry ? git_index_add(selected, entry) : remove_index_path(selected, path);
        if (code < 0)
            goto done;
        if (status & (GIT_STATUS_WT_DELETED | GIT_STATUS_INDEX_DELETED) &&
            !(status & GIT_STATUS_WT_NEW))
            code = remove_index_path(work, path);
        else
            code = insert_worktree_file(work, repo, path, mode);
        if (code < 0)
            goto done;
        tracked_paths->strings[tracked_paths->count++] = paths[i];
    }
    if ((code = index_tree(staged, repo, selected)) < 0 ||
        (code = index_tree(working, repo, work)) < 0)
        goto done;
    if (new_paths->count)
        code = index_tree(untracked, repo, new_files);
done:
    git_index_free(new_files);
    git_index_free(work);
    git_index_free(selected);
    return code;
}

static int clear_selected(git_repository *repo, git_commit *head,
    git_strarray tracked_paths, git_strarray new_paths)
{
    git_checkout_options options;
    int code = git_checkout_options_init(&options, GIT_CHECKOUT_OPTIONS_VERSION);
    if (code < 0)
        return code;
    if (tracked_paths.count) {
        options.checkout_strategy = GIT_CHECKOUT_FORCE | GIT_CHECKOUT_DISABLE_PATHSPEC_MATCH;
        options.paths = tracked_paths;
        code = git_checkout_tree(repo, (git_object *)head, &options);
    }
    for (size_t i = 0; code == 0 && i < new_paths.count; ++i) {
        const char *root = git_repository_workdir(repo);
        const char *name = new_paths.strings[i];
        size_t length = strlen(root) + strlen(name) + 1;
        char *path = malloc(length);
        if (!path)
            return -1;
        snprintf(path, length, "%s%s", root, name);
        code = remove(path);
        free(path);
        if (code != 0)
            git_error_set(GIT_ERROR_OS, "Could not remove stashed file: %s", name);
    }
    return code;
}

static int clear_staged(git_repository *repo, git_tree *head, git_index *index)
{
    git_diff_options options;
    int code = git_diff_options_init(&options, GIT_DIFF_OPTIONS_VERSION);
    if (code < 0)
        return code;
    options.flags |= GIT_DIFF_REVERSE | GIT_DIFF_SHOW_BINARY;
    git_diff *diff = NULL;
    if ((code = git_diff_tree_to_index(&diff, repo, head, index, &options)) == 0)
        code = git_apply(repo, diff, GIT_APPLY_LOCATION_WORKDIR, NULL);
    git_diff_free(diff);
    if (code == 0)
        code = git_index_read_tree(index, head);
    return code < 0 ? code : git_index_write(index);
}

int git_wasi_stash_save(git_repository *repo, int staged_only, const char *message,
    int path_count, char **paths)
{
    git_reference *head_ref = NULL, *stash_ref = NULL;
    git_signature *identity = NULL;
    git_commit *head = NULL, *saved_index = NULL, *saved_new = NULL, *stash = NULL;
    git_tree *head_tree = NULL, *staged = NULL, *working = NULL, *untracked = NULL;
    git_index *index = NULL;
    git_status_list *status = NULL;
    git_strarray selection = {0}, tracked_paths = {0}, new_paths = {0};
    char *subject = NULL;
    int code;
    if (!staged_only && !path_count) {
        code = git_signature_default(&identity, repo);
        if (code == 0) {
            git_oid id;
            code = git_stash_save(&id, repo, identity, *message ? message : NULL, GIT_STASH_INCLUDE_UNTRACKED);
            if (code == GIT_ENOTFOUND)
                code = 0;
        }
        goto done;
    }
    if ((code = git_repository_head(&head_ref, repo)) < 0 ||
        (code = git_reference_peel((git_object **)&head, head_ref, GIT_OBJECT_COMMIT)) < 0 ||
        (code = git_commit_tree(&head_tree, head)) < 0 ||
        (code = git_repository_index(&index, repo)) < 0)
        goto done;
    if (git_index_has_conflicts(index)) {
        git_error_set_str(GIT_ERROR_STASH, "Resolve index conflicts before stashing");
        code = -1;
        goto done;
    }
    if (staged_only) {
        code = index_tree(&staged, repo, index);
        if (code < 0 || git_oid_equal(git_tree_id(staged), git_tree_id(head_tree)))
            goto done;
    } else {
        code = include_rename_sources(&selection, &status, repo, path_count, paths);
        if (code < 0)
            goto done;
        tracked_paths.strings = calloc(selection.count, sizeof(char *));
        new_paths.strings = calloc(selection.count, sizeof(char *));
        if (!tracked_paths.strings || !new_paths.strings) {
            code = -1;
            goto done;
        }
        code = selected_trees(repo, head_tree, index, &staged, &working, &untracked,
            &tracked_paths, &new_paths, (int)selection.count, selection.strings);
        if (code < 0 || (!tracked_paths.count && !new_paths.count))
            goto done;
    }

    code = git_signature_default(&identity, repo);
    if (code < 0)
        goto done;
    const char *branch = git_reference_shorthand(head_ref);
    const char *description = *message ? message : git_commit_summary(head);
    if (!description)
        description = "";
    size_t length = strlen(branch) + strlen(description) + 16;
    subject = malloc(length);
    if (!subject) {
        code = -1;
        goto done;
    }
    snprintf(subject, length, "%s %s: %s", *message ? "On" : "WIP on", branch, description);
    const git_commit *parents[3] = {head, NULL, NULL};
    if ((code = make_commit(&saved_index, repo, identity, "index snapshot", staged, 1, parents)) < 0)
        goto done;
    parents[1] = saved_index;
    if (untracked) {
        code = make_commit(&saved_new, repo, identity, "untracked files", untracked, 0, NULL);
        if (code < 0)
            goto done;
        parents[2] = saved_new;
    }
    if ((code = make_commit(&stash, repo, identity, subject, staged_only ? staged : working,
            saved_new ? 3 : 2, parents)) < 0 ||
        (code = git_reference_ensure_log(repo, "refs/stash")) < 0 ||
        (code = git_reference_create(&stash_ref, repo, "refs/stash", git_commit_id(stash), 1, subject)) < 0)
        goto done;
    code = staged_only ? clear_staged(repo, head_tree, index)
        : clear_selected(repo, head, tracked_paths, new_paths);
done:
    free(subject);
    free(new_paths.strings);
    free(tracked_paths.strings);
    free(selection.strings);
    git_status_list_free(status);
    git_index_free(index);
    git_tree_free(untracked);
    git_tree_free(working);
    git_tree_free(staged);
    git_tree_free(head_tree);
    git_commit_free(stash);
    git_commit_free(saved_new);
    git_commit_free(saved_index);
    git_commit_free(head);
    git_signature_free(identity);
    git_reference_free(stash_ref);
    git_reference_free(head_ref);
    return code < 0 ? git_wasi_fail("Saving Git stash") : 0;
}
