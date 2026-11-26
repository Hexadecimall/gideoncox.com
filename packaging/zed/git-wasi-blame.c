#include "git-wasi.h"

#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void field_oid(const git_oid *oid)
{
    char hex[GIT_OID_HEXSZ + 1];
    git_wasi_field(git_oid_tostr(hex, sizeof(hex), oid));
}

static void field_number(size_t value)
{
    printf("%zu%c", value, 0);
}

static void fields_signature(const git_signature *signature)
{
    if (!signature) {
        for (int i = 0; i < 4; i++)
            git_wasi_field(NULL);
        return;
    }
    git_wasi_field(signature->name);
    printf("<%s>%c", signature->email, 0);
    const int offset = signature->when.offset;
    const int minutes = abs(offset);
    printf("%" PRId64 "%c%c%02d%02d%c", (int64_t)signature->when.time, 0,
        offset < 0 || signature->when.sign == '-' ? '-' : '+', minutes / 60, minutes % 60, 0);
}

static void hunk_fields(const git_blame_hunk *hunk, const char *filename)
{
    git_wasi_field("H");
    field_oid(&hunk->final_commit_id);
    field_number(hunk->final_start_line_number);
    field_number(hunk->lines_in_hunk);
    field_number(hunk->orig_start_line_number);
    git_wasi_field(hunk->orig_path ? hunk->orig_path : filename);
    git_wasi_field(hunk->boundary ? "1" : "0");
    git_wasi_field(hunk->summary);
    fields_signature(hunk->final_signature);
    fields_signature(hunk->final_committer);
}

static int compare_hunks(const void *a, const void *b)
{
    const git_blame_hunk *left = *(const git_blame_hunk *const *)a;
    const git_blame_hunk *right = *(const git_blame_hunk *const *)b;
    int comparison = git_oid_cmp(&left->final_commit_id, &right->final_commit_id);
    if (comparison != 0)
        return comparison;
    return strcmp(left->orig_path ? left->orig_path : "", right->orig_path ? right->orig_path : "");
}

static void previous_fields(const git_commit *commit, const char *path, const git_commit *parent, const char *old_path)
{
    git_wasi_field("P");
    field_oid(git_commit_id(commit));
    git_wasi_field(path);
    field_oid(git_commit_id(parent));
    git_wasi_field(old_path);
}

static int previous_rename(git_repository *repo, const git_commit *commit, const char *path,
    const git_commit *parent, git_tree *parent_tree)
{
    git_tree *tree = NULL;
    git_diff *diff = NULL;
    git_diff_options options;
    git_diff_find_options similar;
    int code = git_commit_tree(&tree, commit);
    if (code == 0)
        code = git_diff_options_init(&options, GIT_DIFF_OPTIONS_VERSION);
    if (code == 0) {
        options.flags |= GIT_DIFF_SKIP_BINARY_CHECK;
        code = git_diff_tree_to_tree(&diff, repo, parent_tree, tree, &options);
    }
    if (code == 0)
        code = git_diff_find_options_init(&similar, GIT_DIFF_FIND_OPTIONS_VERSION);
    if (code == 0) {
        similar.flags = GIT_DIFF_FIND_RENAMES;
        code = git_diff_find_similar(diff, &similar);
    }
    if (code == 0) {
        code = GIT_ENOTFOUND;
        for (size_t i = 0; i < git_diff_num_deltas(diff); i++) {
            const git_diff_delta *delta = git_diff_get_delta(diff, i);
            if (delta->status == GIT_DELTA_RENAMED && !strcmp(delta->new_file.path, path)) {
                previous_fields(commit, path, parent, delta->old_file.path);
                code = 0;
                break;
            }
        }
    }
    git_diff_free(diff);
    git_tree_free(tree);
    return code;
}

static int previous_file(git_repository *repo, const git_commit *commit, const char *path)
{
    for (unsigned int i = 0; i < git_commit_parentcount(commit); i++) {
        git_commit *parent = NULL;
        git_tree *tree = NULL;
        git_tree_entry *entry = NULL;
        int code = git_commit_parent(&parent, commit, i);
        if (code == 0)
            code = git_commit_tree(&tree, parent);
        if (code == 0)
            code = git_tree_entry_bypath(&entry, tree, path);
        if (code == 0 && git_tree_entry_type(entry) == GIT_OBJECT_BLOB)
            previous_fields(commit, path, parent, path);
        else if (tree && (code == GIT_ENOTFOUND || code == 0))
            code = previous_rename(repo, commit, path, parent, tree);

        git_tree_entry_free(entry);
        git_tree_free(tree);
        git_commit_free(parent);
        if (code != GIT_ENOTFOUND)
            return code;
    }
    return 0;
}

static int commit_metadata(git_repository *repo, const git_blame_hunk **hunks, size_t count)
{
    qsort(hunks, count, sizeof(*hunks), compare_hunks);
    git_commit *commit = NULL;
    const git_blame_hunk *previous = NULL;
    int code = 0;
    for (size_t i = 0; i < count; i++) {
        const git_blame_hunk *hunk = hunks[i];
        const git_oid *sha = &hunk->final_commit_id;
        if (git_oid_is_zero(sha))
            continue;
        if (!previous || !git_oid_equal(sha, &previous->final_commit_id)) {
            git_commit_free(commit);
            commit = NULL;
            code = git_commit_lookup(&commit, repo, sha);
            if (code < 0)
                break;
            git_wasi_field("M");
            field_oid(sha);
            git_wasi_field(git_commit_message(commit));
        }
        if (hunk->orig_path && !hunk->boundary && (!previous || compare_hunks(&hunks[i], &previous) != 0)) {
            code = previous_file(repo, commit, hunk->orig_path);
            if (code < 0)
                break;
        }
        previous = hunk;
    }
    git_commit_free(commit);
    return code;
}

static int tag_metadata(git_repository *repo)
{
    const char prefix[] = "refs/tags/";
    git_reference_iterator *iterator = NULL;
    int code = git_reference_iterator_glob_new(&iterator, repo, "refs/tags/*");
    if (code < 0)
        return code;
    git_reference *reference = NULL;
    while ((code = git_reference_next(&reference, iterator)) == 0) {
        git_object *target = NULL;
        if (git_reference_peel(&target, reference, GIT_OBJECT_COMMIT) == 0) {
            git_wasi_field("T");
            field_oid(git_object_id(target));
            git_wasi_field(git_reference_name(reference) + sizeof(prefix) - 1);
        }
        git_object_free(target);
        git_reference_free(reference);
    }
    git_reference_iterator_free(iterator);
    return code == GIT_ITEROVER ? 0 : code;
}

static int write_blame(git_repository *repo, git_blame *blame, const char *path)
{
    const size_t count = git_blame_get_hunk_count(blame);
    if (count == 0)
        return 0;
    const git_blame_hunk **hunks = calloc(count, sizeof(*hunks));
    if (!hunks) {
        fputs("Could not allocate Git blame memory.\n", stderr);
        return 1;
    }
    for (size_t i = 0; i < count; i++) {
        hunks[i] = git_blame_get_hunk_byindex(blame, i);
        hunk_fields(hunks[i], path);
    }
    int code = commit_metadata(repo, hunks, count);
    if (code == 0)
        code = tag_metadata(repo);
    free(hunks);
    return code;
}

static int blame_buffer(git_blame **result, git_repository *repo, const char *path, git_blame *base, size_t size)
{
    char *text = malloc(size);
    if (!text || fread(text, 1, size, stdin) != size) {
        fputs("Could not read the file for Git blame.\n", stderr);
        free(text);
        return 1;
    }
    git_filter_list *filters = NULL;
    git_buf buffer = GIT_BUF_INIT;
    int code = git_filter_list_load(&filters, repo, NULL, path, GIT_FILTER_TO_ODB, GIT_FILTER_DEFAULT);
    if (code == 0)
        code = git_filter_list_apply_to_buffer(&buffer, filters, text, size);
    if (code == 0 && buffer.size)
        code = git_blame_buffer(result, base, buffer.ptr, buffer.size);
    git_buf_dispose(&buffer);
    git_filter_list_free(filters);
    free(text);
    return code;
}

int git_wasi_blame(git_repository *repo, const char *path, const char *revision, size_t input_size)
{
    git_blame_options options;
    int code = git_blame_options_init(&options, GIT_BLAME_OPTIONS_VERSION);
    if (code < 0)
        return git_wasi_fail("Preparing Git blame");
    options.flags = GIT_BLAME_USE_MAILMAP;
    if (revision && (code = git_oid_fromstr(&options.newest_commit, revision)) < 0)
        return git_wasi_fail("Reading the Git blame revision");
    if (!revision && !input_size)
        return 0;
    git_blame *base = NULL;
    git_blame *result = NULL;
    code = git_blame_file(&base, repo, path, &options);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
        return 2;
    if (code == 0 && !revision)
        code = blame_buffer(&result, repo, path, base, input_size);
    if (code == 0 && (revision || result))
        code = write_blame(repo, revision ? base : result, path);
    git_blame_free(result);
    git_blame_free(base);
    return code < 0 ? git_wasi_fail("Reading Git blame") : code;
}
