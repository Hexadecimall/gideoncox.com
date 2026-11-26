#include "git-wasi.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int check_branch_name(const char *name)
{
    int valid;
    return name[0] != '-' && git_branch_name_is_valid(&valid, name) == 0 && valid;
}

static int check_switch_state(git_repository *repo)
{
    if (git_repository_state(repo) == GIT_REPOSITORY_STATE_NONE)
        return 0;
    fputs("Finish the current Git operation before switching branches.\n", stderr);
    return 1;
}

static int switch_to(git_repository *repo, git_reference *target)
{
    git_reference *head = NULL;
    int code = git_repository_head(&head, repo);
    if (code == 0 && git_oid_equal(git_reference_target(head), git_reference_target(target)))
        goto set_head;
    if (code < 0 && code != GIT_EUNBORNBRANCH && code != GIT_ENOTFOUND)
        goto done;
    git_object *commit = NULL;
    code = git_reference_peel(&commit, target, GIT_OBJECT_COMMIT);
    if (code == 0) {
        git_checkout_options options;
        code = git_checkout_options_init(&options, GIT_CHECKOUT_OPTIONS_VERSION);
        if (code == 0) {
            options.checkout_strategy =
                GIT_CHECKOUT_SAFE | GIT_CHECKOUT_RECREATE_MISSING | GIT_CHECKOUT_DONT_OVERWRITE_IGNORED;
            code = git_checkout_tree(repo, commit, &options);
        }
    }
    git_object_free(commit);
    if (code < 0)
        goto done;
set_head:
    code = git_repository_set_head(repo, git_reference_name(target));
done:
    git_reference_free(head);
    return code;
}

int git_wasi_switch_branch(git_repository *repo, const char *name)
{
    if (check_switch_state(repo))
        return 1;
    git_reference *target = NULL;
    git_reference *remote = NULL;
    git_reference *resolved = NULL;
    git_object *commit = NULL;
    int code = git_branch_lookup(&target, repo, name, GIT_BRANCH_LOCAL);
    if (code == GIT_ENOTFOUND) {
        code = git_branch_lookup(&remote, repo, name, GIT_BRANCH_REMOTE);
        if (code == 0)
            code = git_reference_resolve(&resolved, remote);
        if (code < 0)
            goto done;
        const char *tracking = git_reference_shorthand(resolved);
        const char *separator = strchr(tracking, '/');
        if (!separator || !check_branch_name(separator + 1)) {
            fputs("Invalid Git remote tracking branch.\n", stderr);
            code = 1;
            goto done;
        }
        const char *local_name = separator + 1;
        code = git_branch_lookup(&target, repo, local_name, GIT_BRANCH_LOCAL);
        if (code == GIT_ENOTFOUND) {
            code = git_reference_peel(&commit, resolved, GIT_OBJECT_COMMIT);
            if (code == 0)
                code = git_branch_create(&target, repo, local_name, (git_commit *)commit, 0);
        }
        if (code == 0)
            code = git_branch_set_upstream(target, tracking);
    }
    if (code == 0)
        code = switch_to(repo, target);
done:
    git_object_free(commit);
    git_reference_free(resolved);
    git_reference_free(remote);
    git_reference_free(target);
    return code < 0 ? git_wasi_fail("Switching Git branches") : code;
}

int git_wasi_create_branch(git_repository *repo, const char *name, const char *base)
{
    if (check_switch_state(repo))
        return 1;
    if (!check_branch_name(name)) {
        fputs("Invalid Git branch name.\n", stderr);
        return 1;
    }

    git_object *object = NULL;
    git_object *commit = NULL;
    git_reference *branch = NULL;
    int code = git_revparse_single(&object, repo, *base ? base : "HEAD");
    const int unborn = !*base && (code == GIT_EUNBORNBRANCH || code == GIT_ENOTFOUND) &&
        git_repository_head_unborn(repo) == 1;
    if (unborn) {
        code = git_branch_lookup(&branch, repo, name, GIT_BRANCH_LOCAL);
        git_reference_free(branch);
        if (code == 0) {
            fprintf(stderr, "A branch named '%s' already exists.\n", name);
            return 1;
        }
        if (code != GIT_ENOTFOUND)
            return git_wasi_fail("Checking the Git branch name");
        const char prefix[] = "refs/heads/";
        char *ref = malloc(sizeof(prefix) + strlen(name));
        if (!ref) {
            fputs("Could not allocate the Git branch name.\n", stderr);
            return 1;
        }
        memcpy(ref, prefix, sizeof(prefix) - 1);
        strcpy(ref + sizeof(prefix) - 1, name);
        code = git_repository_set_head(repo, ref);
        free(ref);
        branch = NULL;
    } else {
        if (code == 0)
            code = git_object_peel(&commit, object, GIT_OBJECT_COMMIT);
        if (code == 0)
            code = git_branch_create(&branch, repo, name, (git_commit *)commit, 0);
        if (code == 0)
            code = switch_to(repo, branch);
    }
    git_reference_free(branch);
    git_object_free(commit);
    git_object_free(object);
    return code < 0 ? git_wasi_fail("Creating the Git branch") : code;
}

int git_wasi_rename_branch(git_repository *repo, const char *name, const char *new_name)
{
    if (!check_branch_name(new_name)) {
        fputs("Invalid Git branch name.\n", stderr);
        return 1;
    }
    git_reference *old = NULL;
    git_reference *renamed = NULL;
    int code = git_branch_lookup(&old, repo, name, GIT_BRANCH_LOCAL);
    if (code == 0)
        code = git_branch_move(&renamed, old, new_name, 0);
    git_reference_free(renamed);
    git_reference_free(old);
    return code < 0 ? git_wasi_fail("Renaming the Git branch") : 0;
}

static int check_merged(git_repository *repo, git_reference *branch)
{
    git_reference *base = NULL;
    int code = git_branch_upstream(&base, branch);
    if (code == GIT_ENOTFOUND)
        code = git_repository_head(&base, repo);
    if (code == GIT_ENOTFOUND || code == GIT_EUNBORNBRANCH)
        return 0;
    if (code < 0)
        return code;
    git_reference *resolved = NULL;
    code = git_reference_resolve(&resolved, base);
    if (code == 0) {
        const git_oid *tip = git_reference_target(branch);
        const git_oid *base_oid = git_reference_target(resolved);
        code = git_oid_equal(base_oid, tip) ? 1 : git_graph_descendant_of(repo, base_oid, tip);
    }
    git_reference_free(resolved);
    git_reference_free(base);
    return code;
}

int git_wasi_delete_branch(git_repository *repo, const char *name, int remote, int force)
{
    git_reference *branch = NULL;
    int code = git_branch_lookup(&branch, repo, name, remote ? GIT_BRANCH_REMOTE : GIT_BRANCH_LOCAL);
    if (code == 0 && !remote && !force) {
        code = check_merged(repo, branch);
        if (code == 0) {
            fprintf(stderr, "Branch '%s' is not fully merged.\n", name);
            code = 1;
        } else if (code == 1) {
            code = 0;
        }
    }
    if (code == 0)
        code = git_branch_delete(branch);
    git_reference_free(branch);
    return code < 0 ? git_wasi_fail("Deleting the Git branch") : code;
}
