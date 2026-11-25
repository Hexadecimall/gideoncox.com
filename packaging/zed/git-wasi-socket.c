#include "streams/socket.h"

int git_socket_stream__connect_timeout;
int git_socket_stream__timeout;

int git_socket_stream_new(git_stream **out, const char *host, const char *port)
{
    GIT_UNUSED(out);
    GIT_UNUSED(host);
    GIT_UNUSED(port);
    git_error_set(GIT_ERROR_NET, "Socket transport is unavailable in the browser Git worker");
    return -1;
}

int git_socket_stream_global_init(void)
{
    return 0;
}
