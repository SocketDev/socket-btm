// at_quick_exit — glibc 2.24 — register handler for C11 quick_exit.
//
// Fallback: store handlers in a process-local fixed-size array drained by
// the quick_exit shim. C11 §7.22.4.3 requires implementations support at
// least 32 handlers.
//
// Shares state with shims/quick_exit.c — the handler array, count, and
// mutex are declared with external linkage and consumed there.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h"
#include "socketsecurity/glibc-2-17-compat/shims/_internal/dlsym_resolve.h"

#include <pthread.h>

#define SOCKETSECURITY_GLIBC_QUICK_EXIT_MAX_HANDLERS 32

typedef void (*socketsecurity_glibc_quick_exit_handler_fn_t)(void);

socketsecurity_glibc_quick_exit_handler_fn_t
    socketsecurity_glibc_quick_exit_handlers
        [SOCKETSECURITY_GLIBC_QUICK_EXIT_MAX_HANDLERS] = {0};
int socketsecurity_glibc_quick_exit_count = 0;
pthread_mutex_t socketsecurity_glibc_quick_exit_mutex =
    PTHREAD_MUTEX_INITIALIZER;

typedef int (*at_quick_exit_fn_t)(void (*)(void));

static int fallback_at_quick_exit(void (*handler)(void)) {
  if (!handler) {
    return -1;
  }
  pthread_mutex_lock(&socketsecurity_glibc_quick_exit_mutex);
  if (socketsecurity_glibc_quick_exit_count >=
      SOCKETSECURITY_GLIBC_QUICK_EXIT_MAX_HANDLERS) {
    pthread_mutex_unlock(&socketsecurity_glibc_quick_exit_mutex);
    return -1;
  }
  socketsecurity_glibc_quick_exit_handlers
      [socketsecurity_glibc_quick_exit_count++] = handler;
  pthread_mutex_unlock(&socketsecurity_glibc_quick_exit_mutex);
  return 0;
}

int __wrap_at_quick_exit(void (*handler)(void)) {
  static at_quick_exit_fn_t real = NULL;
  static int resolved = 0;
  if (!resolved) {
    real =
        (at_quick_exit_fn_t)socketsecurity_compat_resolve_next("at_quick_exit");
    resolved = 1;
  }
  if (real) {
    return real(handler);
  }
  return fallback_at_quick_exit(handler);
}

#endif  // __GLIBC__ && __linux__
