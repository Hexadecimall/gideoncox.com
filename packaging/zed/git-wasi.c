#include "git-wasi.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

static const char *repository_path = "/repo";

int git_wasi_fail(const char *operation)
{
    const git_error *error = git_error_last();
    fprintf(stderr, "%s: %s\n", operation, error ? error->message : "Git operation failed");
    return 1;
}

void git_wasi_field(const char *value)
{
    if (value)
        fputs(value, stdout);
    fputc('\0', stdout);
}

static int status(git_repository *repo)
{
    git_status_options options;
    if (git_status_options_init(&options, GIT_STATUS_OPTIONS_VERSION) < 0)
        return git_wasi_fail("Preparing repository status");
    options.flags = GIT_STATUS_OPT_INCLUDE_UNTRACKED |
        GIT_STATUS_OPT_RECURSE_UNTRACKED_DIRS |
        GIT_STATUS_OPT_RENAMES_HEAD_TO_INDEX;

    git_status_list *entries = NULL;
    if (git_status_list_new(&entries, repo, &options) < 0)
        return git_wasi_fail("Reading repository status");

    for (size_t i = 0; i < git_status_list_entrycount(entries); i++) {
        const git_status_entry *entry = git_status_byindex(entries, i);
        const git_diff_delta *staged = entry->head_to_index;
        const git_diff_delta *unstaged = entry->index_to_workdir;
        const char *path = unstaged ? unstaged->new_file.path : staged->new_file.path;
        printf("%u", (unsigned)entry->status);
        fputc('\0', stdout);
        git_wasi_field(path);
        git_wasi_field(staged && staged->status == GIT_DELTA_RENAMED ? staged->old_file.path : NULL);
    }
    git_status_list_free(entries);
    return 0;
}

static int read_branch(git_repository *repo)
{
    git_reference *head = NULL;
    if (git_reference_lookup(&head, repo, "HEAD") < 0)
        return git_wasi_fail("Reading HEAD");
    const char *branch = git_reference_symbolic_target(head);
    git_wasi_field(branch);
    git_reference_free(head);

    git_oid commit;
    int code = git_reference_name_to_id(&commit, repo, "HEAD");
    if (code == GIT_ENOTFOUND) {
        git_wasi_field(NULL);
    } else if (code < 0) {
        return git_wasi_fail("Resolving HEAD");
    } else {
        char id[GIT_OID_HEXSZ + 1];
        git_oid_tostr(id, sizeof(id), &commit);
        git_wasi_field(id);
    }
    return 0;
}

static void emit_branch(const char *name, int is_head, git_commit *commit)
{
    git_wasi_field(name);
    git_wasi_field(is_head ? "1" : "0");
    if (!commit) {
        git_wasi_field(NULL);
        return;
    }
    char id[GIT_OID_HEXSZ + 1];
    git_wasi_field(git_oid_tostr(id, sizeof(id), git_commit_id(commit)));
    git_wasi_field(git_commit_summary(commit));
    printf("%" PRId64 "%c", (int64_t)git_commit_time(commit), 0);
    git_wasi_field(git_commit_author(commit)->name);
    git_wasi_field(git_commit_parentcount(commit) ? "1" : "0");
}

static int list_branches(git_repository *repo)
{
    git_branch_iterator *iterator = NULL;
    if (git_branch_iterator_new(&iterator, repo, GIT_BRANCH_ALL) < 0)
        return git_wasi_fail("Listing Git branches");
    git_reference *ref = NULL;
    git_branch_t category;
    int code;
    while ((code = git_branch_next(&ref, &category, iterator)) == 0) {
        git_object *commit = NULL;
        code = git_reference_peel(&commit, ref, GIT_OBJECT_COMMIT);
        if (code == 0)
            emit_branch(git_reference_name(ref), git_branch_is_head(ref) == 1, (git_commit *)commit);
        git_object_free(commit);
        git_reference_free(ref);
        if (code < 0)
            break;
    }
    git_branch_iterator_free(iterator);
    if (code != GIT_ITEROVER)
        return git_wasi_fail("Reading a Git branch");

    if (git_repository_head_unborn(repo) == 1) {
        git_reference *head = NULL;
        if (git_reference_lookup(&head, repo, "HEAD") < 0)
            return git_wasi_fail("Reading the new Git branch");
        emit_branch(git_reference_symbolic_target(head), 1, NULL);
        git_reference_free(head);
    } else if (git_repository_head_detached(repo) == 1) {
        git_object *head = NULL;
        if (git_revparse_single(&head, repo, "HEAD^{commit}") < 0)
            return git_wasi_fail("Reading detached HEAD");
        emit_branch("HEAD", 1, (git_commit *)head);
        git_object_free(head);
    }
    return 0;
}

static int show_commit(git_repository *repo, const char *revision)
{
    git_object *object = NULL;
    int code = git_revparse_single(&object, repo, revision);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
        return 2;
    if (code < 0)
        return git_wasi_fail("Resolving the commit");
    git_object *peeled = NULL;
    code = git_object_peel(&peeled, object, GIT_OBJECT_COMMIT);
    git_object_free(object);
    if (code < 0)
        return git_wasi_fail("Reading the commit");
    git_commit *commit = (git_commit *)peeled;
    char id[GIT_OID_HEXSZ + 1];
    const git_signature *author = git_commit_author(commit);
    git_wasi_field(git_oid_tostr(id, sizeof(id), git_commit_id(commit)));
    git_wasi_field(git_commit_message(commit));
    printf("%" PRId64 "%c", (int64_t)git_commit_time(commit), 0);
    git_wasi_field(author->email);
    git_wasi_field(author->name);
    git_commit_free(commit);
    return 0;
}

static int write_diff_statistics(git_diff *diff)
{
    for (size_t i = 0; i < git_diff_num_deltas(diff); i++) {
        git_patch *patch = NULL;
        if (git_patch_from_diff(&patch, diff, i) < 0)
            return git_wasi_fail("Reading a Git diff");
        if (!patch)
            continue;
        const git_diff_delta *delta = git_patch_get_delta(patch);
        if (!(delta->flags & GIT_DIFF_FLAG_BINARY)) {
            size_t added, deleted;
            if (git_patch_line_stats(NULL, &added, &deleted, patch) < 0) {
                git_patch_free(patch);
                return git_wasi_fail("Counting changed lines");
            }
            printf("%zu%c%zu%c", added, 0, deleted, 0);
            git_wasi_field(delta->new_file.path);
        }
        git_patch_free(patch);
    }
    return 0;
}

static int diff(git_repository *repo, const char *range, int statistics)
{
    git_object *base = NULL;
    git_diff *changes = NULL;
    git_buf text = GIT_BUF_INIT;
    int code = 0;
    if (!strcmp(range, "index-worktree")) {
        code = git_diff_index_to_workdir(&changes, repo, NULL, NULL);
    } else {
        code = git_revparse_single(&base, repo, "HEAD^{tree}");
        if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
            code = 0;
        if (code == 0) {
            if (!strcmp(range, "head-index"))
                code = git_diff_tree_to_index(&changes, repo, (git_tree *)base, NULL, NULL);
            else
                code = git_diff_tree_to_workdir_with_index(&changes, repo, (git_tree *)base, NULL);
        }
    }
    if (code < 0) {
        code = git_wasi_fail("Creating a Git diff");
    } else if (statistics) {
        code = write_diff_statistics(changes);
    } else if (git_diff_to_buf(&text, changes, GIT_DIFF_FORMAT_PATCH) < 0) {
        code = git_wasi_fail("Printing a Git diff");
    } else if (text.size && fwrite(text.ptr, 1, text.size, stdout) != text.size) {
        code = 1;
    }
    git_buf_dispose(&text);
    git_diff_free(changes);
    git_object_free(base);
    return code;
}

static int write_blob(git_repository *repo, const git_oid *id, unsigned int mode)
{
    if (mode != GIT_FILEMODE_BLOB && mode != GIT_FILEMODE_BLOB_EXECUTABLE)
        return 2;
    git_blob *blob = NULL;
    if (git_blob_lookup(&blob, repo, id) < 0)
        return git_wasi_fail("Reading the Git object");
    size_t size = git_blob_rawsize(blob);
    int code = fwrite(git_blob_rawcontent(blob), 1, size, stdout) == size ? 0 : 1;
    git_blob_free(blob);
    return code;
}

static int read_blob(git_repository *repo, const char *hex)
{
    git_oid id;
    if (git_oid_fromstr(&id, hex) < 0)
        return git_wasi_fail("Reading the object ID");
    return write_blob(repo, &id, GIT_FILEMODE_BLOB);
}

static int resolve(git_repository *repo, const char *revision)
{
    git_object *object = NULL;
    int code = git_revparse_single(&object, repo, revision);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
        return 2;
    if (code < 0)
        return git_wasi_fail("Resolving the revision");
    char hex[GIT_OID_HEXSZ + 1];
    git_wasi_field(git_oid_tostr(hex, sizeof(hex), git_object_id(object)));
    git_object_free(object);
    return 0;
}

static int read_index(git_repository *repo, const char *path)
{
    git_index *index = NULL;
    if (git_repository_index(&index, repo) < 0)
        return git_wasi_fail("Opening the Git index");
    const git_index_entry *entry = git_index_get_bypath(index, path, 0);
    int code = entry ? write_blob(repo, &entry->id, entry->mode) : 2;
    git_index_free(index);
    return code;
}

static int read_tree(git_repository *repo, const char *revision, const char *path)
{
    git_object *object = NULL;
    int code = git_revparse_single(&object, repo, revision);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
        return 2;
    if (code < 0)
        return git_wasi_fail("Resolving the Git tree");
    git_object *tree = NULL;
    code = git_object_peel(&tree, object, GIT_OBJECT_TREE);
    git_object_free(object);
    if (code < 0)
        return git_wasi_fail("Reading the Git tree");
    git_tree_entry *entry = NULL;
    code = git_tree_entry_bypath(&entry, (git_tree *)tree, path);
    if (code == GIT_ENOTFOUND)
        code = 2;
    else if (code < 0)
        code = git_wasi_fail("Reading the committed file");
    else
        code = write_blob(repo, git_tree_entry_id(entry), git_tree_entry_filemode(entry));
    git_tree_entry_free(entry);
    git_object_free(tree);
    return code;
}

static int stage(git_repository *repo, const char *path, int deleted)
{
    git_index *index = NULL;
    if (git_repository_index(&index, repo) < 0)
        return git_wasi_fail("Opening the Git index");
    int code = deleted ? git_index_remove_bypath(index, path) : git_index_add_bypath(index, path);
    if (deleted && code == GIT_ENOTFOUND)
        code = 0;
    if (code == 0)
        code = git_index_write(index);
    git_index_free(index);
    return code < 0 ? git_wasi_fail("Staging the file") : 0;
}

static int stage_content(git_repository *repo, const char *path, int executable)
{
    git_index *index = NULL;
    git_writestream *stream = NULL;
    git_index_entry entry = {0};
    entry.path = path;
    entry.mode = executable ? GIT_FILEMODE_BLOB_EXECUTABLE : GIT_FILEMODE_BLOB;

    int code = git_repository_index(&index, repo);
    if (code == 0)
        code = git_blob_create_from_stream(&stream, repo, path);
    while (code == 0) {
        char buffer[8192];
        size_t size = fread(buffer, 1, sizeof(buffer), stdin);
        if (!size)
            break;
        code = stream->write(stream, buffer, size);
    }
    if (code == 0 && ferror(stdin)) {
        fputs("Could not read the staged content.\n", stderr);
        code = 1;
    }
    if (code == 0) {
        code = git_blob_create_from_stream_commit(&entry.id, stream);
        stream = NULL;
    }
    if (code == 0) {
        code = git_index_conflict_remove(index, path);
        if (code == GIT_ENOTFOUND)
            code = 0;
    }
    if (code == 0)
        code = git_index_add(index, &entry);
    if (code == 0)
        code = git_index_write(index);
    if (stream)
        stream->free(stream);
    git_index_free(index);
    return code < 0 ? git_wasi_fail("Staging selected changes") : code;
}

static int unstage(git_repository *repo, const char *path)
{
    git_index *index = NULL;
    git_object *tree = NULL;
    git_tree_entry *entry = NULL;
    if (git_repository_index(&index, repo) < 0)
        return git_wasi_fail("Opening the Git index");
    int code = git_revparse_single(&tree, repo, "HEAD^{tree}");
    if (code == 0)
        code = git_tree_entry_bypath(&entry, (git_tree *)tree, path);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH) {
        code = git_index_remove_bypath(index, path);
        if (code == GIT_ENOTFOUND)
            code = 0;
    } else if (code == 0) {
        git_index_entry baseline = {0};
        baseline.path = path;
        baseline.mode = git_tree_entry_filemode(entry);
        git_oid_cpy(&baseline.id, git_tree_entry_id(entry));
        code = git_index_add(index, &baseline);
    }
    if (code == 0)
        code = git_index_write(index);
    git_tree_entry_free(entry);
    git_object_free(tree);
    git_index_free(index);
    return code < 0 ? git_wasi_fail("Unstaging the file") : 0;
}

static int commit(git_repository *repo, const char *name, const char *email, const char *message)
{
    if (git_repository_state(repo) != GIT_REPOSITORY_STATE_NONE) {
        fputs("Finish the current Git operation before committing.\n", stderr);
        return 1;
    }
    git_index *index = NULL;
    git_tree *tree = NULL;
    git_signature *author = NULL;
    const git_commit *parents[1] = { NULL };
    git_commit *parent = NULL;
    git_oid id;
    int code = 1;
    if (git_repository_index(&index, repo) < 0 || git_index_write_tree(&id, index) < 0 ||
        git_tree_lookup(&tree, repo, &id) < 0) {
        git_wasi_fail("Preparing the commit");
        goto done;
    }
    if ((*name || *email ? git_signature_now(&author, name, email) : git_signature_default(&author, repo)) < 0) {
        git_wasi_fail("Set user.name and user.email in the Git configuration before committing");
        goto done;
    }
    int head = git_reference_name_to_id(&id, repo, "HEAD");
    if (head == 0) {
        if (git_commit_lookup(&parent, repo, &id) < 0) {
            git_wasi_fail("Reading the parent commit");
            goto done;
        }
        if (git_oid_equal(git_tree_id(tree), git_commit_tree_id(parent))) {
            fputs("Stage changes before committing.\n", stderr);
            goto done;
        }
        parents[0] = parent;
    } else if (head != GIT_ENOTFOUND) {
        git_wasi_fail("Resolving the parent commit");
        goto done;
    }
    if (git_commit_create(&id, repo, "HEAD", author, author, NULL, message, tree,
            parent ? 1 : 0, parents) < 0) {
        git_wasi_fail("Writing the commit");
        goto done;
    }
    char hex[GIT_OID_HEXSZ + 1];
    git_wasi_field(git_oid_tostr(hex, sizeof(hex), &id));
    code = 0;
done:
    git_commit_free(parent);
    git_signature_free(author);
    git_tree_free(tree);
    git_index_free(index);
    return code;
}

int main(int argc, char **argv)
{
    if (argc < 2)
        return 1;
    if (git_libgit2_init() < 0)
        return git_wasi_fail("Starting Git");

    git_repository *repo = NULL;
    int code;
    if (!strcmp(argv[1], "init") && argc == 3) {
        git_repository_init_options options;
        code = git_repository_init_options_init(&options, GIT_REPOSITORY_INIT_OPTIONS_VERSION);
        if (code == 0) {
            options.initial_head = argv[2];
            code = git_repository_init_ext(&repo, repository_path, &options);
        }
        if (code < 0)
            code = git_wasi_fail("Initializing the repository");
    } else if (git_repository_open_ext(&repo, repository_path, GIT_REPOSITORY_OPEN_NO_SEARCH, NULL) < 0) {
        code = git_wasi_fail("Opening the repository");
    } else if (!strcmp(argv[1], "status") && argc == 2) {
        code = status(repo);
    } else if (!strcmp(argv[1], "head") && argc == 2) {
        code = read_branch(repo);
    } else if (!strcmp(argv[1], "branches") && argc == 2) {
        code = list_branches(repo);
    } else if (!strcmp(argv[1], "switch-branch") && argc == 3) {
        code = git_wasi_switch_branch(repo, argv[2]);
    } else if (!strcmp(argv[1], "create-branch") && argc == 4) {
        code = git_wasi_create_branch(repo, argv[2], argv[3]);
    } else if (!strcmp(argv[1], "rename-branch") && argc == 4) {
        code = git_wasi_rename_branch(repo, argv[2], argv[3]);
    } else if (!strcmp(argv[1], "delete-branch") && argc == 5) {
        code = git_wasi_delete_branch(repo, argv[2], !strcmp(argv[3], "true"), !strcmp(argv[4], "true"));
    } else if (!strcmp(argv[1], "show") && argc == 3) {
        code = show_commit(repo, argv[2]);
    } else if (!strcmp(argv[1], "history") && argc == 5 &&
        (!strcmp(argv[2], "all") || !strcmp(argv[2], "branch") || !strcmp(argv[2], "revision") || !strcmp(argv[2], "path"))) {
        code = git_wasi_history(repo, argv[2], argv[3], argv[4]);
    } else if (!strcmp(argv[1], "search-commits") && argc == 6 &&
        (!strcmp(argv[2], "all") || !strcmp(argv[2], "branch") || !strcmp(argv[2], "revision") || !strcmp(argv[2], "path")) &&
        (!strcmp(argv[4], "hash") || !strcmp(argv[4], "ignore-case") || !strcmp(argv[4], "literal"))) {
        code = git_wasi_search(repo, argv[2], argv[3], argv[4], argv[5]);
    } else if (!strcmp(argv[1], "blame-revision") && argc == 4) {
        code = git_wasi_blame(repo, argv[2], argv[3], 0);
    } else if (!strcmp(argv[1], "blame-buffer") && argc == 4) {
        char *end;
        unsigned long length = strtoul(argv[3], &end, 10);
        if (end == argv[3] || *end || length > 16 * 1024 * 1024) {
            fputs("Invalid Git blame input size.\n", stderr);
            code = 1;
        } else {
            code = git_wasi_blame(repo, argv[2], NULL, length);
        }
    } else if (!strcmp(argv[1], "read-commit") && argc == 3) {
        code = git_wasi_raw_commit(repo, argv[2]);
    } else if (!strcmp(argv[1], "commit-files") && argc == 4) {
        code = git_wasi_commit_files(repo, argv[2], !strcmp(argv[3], "true"));
    } else if (argc == 3 && (!strcmp(argv[1], "diff") || !strcmp(argv[1], "diff-stat")) &&
        (!strcmp(argv[2], "head-index") || !strcmp(argv[2], "head-worktree") || !strcmp(argv[2], "index-worktree"))) {
        code = diff(repo, argv[2], !strcmp(argv[1], "diff-stat"));
    } else if (!strcmp(argv[1], "read-index") && argc == 3) {
        code = read_index(repo, argv[2]);
    } else if (!strcmp(argv[1], "read-head") && argc == 3) {
        code = read_tree(repo, "HEAD", argv[2]);
    } else if (!strcmp(argv[1], "read-tree") && argc == 4) {
        code = read_tree(repo, argv[2], argv[3]);
    } else if (!strcmp(argv[1], "read-blob") && argc == 3) {
        code = read_blob(repo, argv[2]);
    } else if (!strcmp(argv[1], "resolve") && argc == 3) {
        code = resolve(repo, argv[2]);
    } else if (!strcmp(argv[1], "stage") && argc == 3) {
        code = stage(repo, argv[2], 0);
    } else if (!strcmp(argv[1], "set-index-text") && argc == 4 &&
        (!strcmp(argv[3], "true") || !strcmp(argv[3], "false"))) {
        code = stage_content(repo, argv[2], !strcmp(argv[3], "true"));
    } else if (!strcmp(argv[1], "stage-deletion") && argc == 3) {
        code = stage(repo, argv[2], 1);
    } else if (!strcmp(argv[1], "unstage") && argc == 3) {
        code = unstage(repo, argv[2]);
    } else if (!strcmp(argv[1], "commit") && argc == 5) {
        code = commit(repo, argv[2], argv[3], argv[4]);
    } else {
        fputs("Unknown browser Git operation\n", stderr);
        code = 1;
    }
    git_repository_free(repo);
    git_libgit2_shutdown();
    return code;
}
