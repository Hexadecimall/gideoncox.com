#ifndef ZED_GIT_WASI_H
#define ZED_GIT_WASI_H

#include <git2.h>

int git_wasi_fail(const char *operation);
void git_wasi_field(const char *value);
int git_wasi_history(git_repository *repo, const char *scope, const char *value, const char *order);
int git_wasi_search(git_repository *repo, const char *scope, const char *value, const char *mode, const char *query);
int git_wasi_raw_commit(git_repository *repo, const char *revision);
int git_wasi_commit_files(git_repository *repo, const char *revision, int include_shallow);
int git_wasi_find_rename(char **source, git_repository *repo, git_tree *parent, git_tree *tree, const char *path);

int git_wasi_switch_branch(git_repository *repo, const char *name);
int git_wasi_create_branch(git_repository *repo, const char *name, const char *base);
int git_wasi_rename_branch(git_repository *repo, const char *name, const char *new_name);
int git_wasi_delete_branch(git_repository *repo, const char *name, int remote, int force);

int git_wasi_blame(git_repository *repo, const char *path, const char *revision, size_t input_size);
int git_wasi_stash_list(git_repository *repo);
int git_wasi_stash_save(git_repository *repo, int staged_only, const char *message, int path_count, char **paths);
int git_wasi_stash_restore(git_repository *repo, const char *action, const char *arg);

#endif
