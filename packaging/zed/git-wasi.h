#ifndef ZED_GIT_WASI_H
#define ZED_GIT_WASI_H

#include <git2.h>

int git_wasi_fail(const char *operation);
void git_wasi_field(const char *value);
int git_wasi_history(git_repository *repo, const char *scope, const char *value, const char *order);
int git_wasi_raw_commit(git_repository *repo, const char *revision);
int git_wasi_commit_files(git_repository *repo, const char *revision, int include_shallow);

#endif
