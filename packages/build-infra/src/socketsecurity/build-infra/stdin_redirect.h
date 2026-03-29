#ifndef SOCKETSECURITY_BUILD_INFRA_STDIN_REDIRECT_H
#define SOCKETSECURITY_BUILD_INFRA_STDIN_REDIRECT_H

/**
 * Redirect stdin to /dev/null when not a TTY.
 *
 * Self-extracting stubs use execve to launch the real Node.js binary.
 * When stdin is piped (e.g., spawned from vitest or CI), Node.js blocks
 * reading stdin instead of executing the requested flag. This helper
 * redirects stdin to /dev/null before execve to prevent that.
 *
 * Call this immediately before execve() in stub launchers.
 */

#include <unistd.h>
#include <fcntl.h>

static inline void redirect_stdin_if_piped(void) {
#ifndef _WIN32
    if (!isatty(STDIN_FILENO)) {
        int devnull = open("/dev/null", O_RDONLY);
        if (devnull >= 0) {
            dup2(devnull, STDIN_FILENO);
            close(devnull);
        }
    }
#endif
}

#endif /* SOCKETSECURITY_BUILD_INFRA_STDIN_REDIRECT_H */
