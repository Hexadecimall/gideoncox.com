#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

int __real___main_void(void);

int __wrap___main_void(void) {
    const char *directory = getenv("PWD");
    if (directory == NULL || chdir(directory) != 0) {
        fputs("Could not enter the Cargo build script directory.\n", stderr);
        return 1;
    }
    return __real___main_void();
}
