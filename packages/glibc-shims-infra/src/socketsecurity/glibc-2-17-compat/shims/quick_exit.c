// quick_exit — glibc 2.24 — C11-correct quick exit.
//
// Fallback: snapshot the at_quick_exit handler list under the mutex, drain
// it in LIFO order (C11 §7.22.4.3), then _exit() to bypass atexit handlers
// and stream flushes.
//
// State shared with shims/at_quick_exit.c — that file owns the storage.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h"
#include "socketsecurity/glibc-2-17-compat/shims/_internal/dlsym_resolve.h"

#include <pthread.h>
#include <unistd.h>

#define SOCKETSECURITY_GLIBC_QUICK_EXIT_MAX_HANDLERS 32

typedef void (*socketsecurity_glibc_quick_exit_handler_fn_t)(void);

// Forward declarations — owned by shims/at_quick_exit.c.
extern socketsecurity_glibc_quick_exit_handler_fn_t
    socketsecurity_glibc_quick_exit_handlers
        [SOCKETSECURITY_GLIBC_QUICK_EXIT_MAX_HANDLERS];
extern int socketsecurity_glibc_quick_exit_count;
extern pthread_mutex_t socketsecurity_glibc_quick_exit_mutex;

typedef void (*quick_exit_fn_t)(int);

__attribute__((noreturn)) static void fallback_quick_exit(int code) {
  // Snapshot the whole handler array + count under the mutex, THEN release.
  // A concurrent fallback_at_quick_exit() could otherwise write into a slot
  // we just bounds-checked but haven't loaded yet — torn function-pointer
  // reads on 32-bit and clobbered-slot reads on 64-bit. Fixed-size snapshot
  // keeps this cheap.
  socketsecurity_glibc_quick_exit_handler_fn_t
      snapshot[SOCKETSECURITY_GLIBC_QUICK_EXIT_MAX_HANDLERS];
  int count;
  int i;
  pthread_mutex_lock(&socketsecurity_glibc_quick_exit_mutex);
  count = socketsecurity_glibc_quick_exit_count;
  for (i = 0; i < count; ++i) {
    snapshot[i] = socketsecurity_glibc_quick_exit_handlers[i];
  }
  pthread_mutex_unlock(&socketsecurity_glibc_quick_exit_mutex);

  // Drain in LIFO order (C11 §7.22.4.3).
  for (i = count - 1; i >= 0; --i) {
    socketsecurity_glibc_quick_exit_handler_fn_t handler = snapshot[i];
    if (handler) {
      handler();
    }
  }
  // Bypass atexit handlers and buffered stream flushes — C11 quick_exit
  // contract. _exit does exactly that.
  _exit(code);
}

void __wrap_quick_exit(int code) {
  static quick_exit_fn_t real = NULL;
  static int resolved = 0;
  if (!resolved) {
    real = (quick_exit_fn_t)socketsecurity_compat_resolve_next("quick_exit");
    resolved = 1;
  }
  if (real) {
    // glibc 2.24+ path — C11-correct (skips thread_local dtors per C11/C++11;
    // the pre-2.24 @GLIBC_2.10 version erroneously ran them, see glibc#20198).
    real(code);
    __builtin_unreachable();
  }
  fallback_quick_exit(code);
}

#endif  // __GLIBC__ && __linux__
