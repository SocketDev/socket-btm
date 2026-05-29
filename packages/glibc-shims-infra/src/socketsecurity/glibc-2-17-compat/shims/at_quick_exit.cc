// at_quick_exit — glibc 2.24 — register handler for C11 quick_exit.
//
// Fallback: store handlers in a process-local fixed-size array drained by
// the quick_exit shim. C11 §7.22.4.3 requires implementations support at
// least 32 handlers.
//
// Shares state with shims/quick_exit.cc — the handler array, count, and
// mutex are intentionally visible to both translation units via the
// internal::QuickExitState namespace below.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h"
#include "socketsecurity/glibc-2-17-compat/shims/_internal/dlsym_resolve.h"

#include <pthread.h>

namespace socketsecurity {
namespace compat {
namespace quick_exit_state {

constexpr int kMaxHandlers = 32;
using HandlerFn = void (*)(void);
HandlerFn g_handlers[kMaxHandlers] = {};
int g_count = 0;
pthread_mutex_t g_mutex = PTHREAD_MUTEX_INITIALIZER;

}  // namespace quick_exit_state

namespace {

int FallbackAtQuickExit(quick_exit_state::HandlerFn handler) {
  if (!handler) {
    return -1;
  }
  pthread_mutex_lock(&quick_exit_state::g_mutex);
  if (quick_exit_state::g_count >= quick_exit_state::kMaxHandlers) {
    pthread_mutex_unlock(&quick_exit_state::g_mutex);
    return -1;
  }
  quick_exit_state::g_handlers[quick_exit_state::g_count++] = handler;
  pthread_mutex_unlock(&quick_exit_state::g_mutex);
  return 0;
}

}  // namespace
}  // namespace compat
}  // namespace socketsecurity

extern "C" int __wrap_at_quick_exit(void (*handler)(void)) {
  using AtQuickExitRealFn = int (*)(void (*)(void));
  static AtQuickExitRealFn real =
      socketsecurity::compat::ResolveNext<AtQuickExitRealFn>("at_quick_exit");
  if (real) {
    return real(handler);
  }
  return socketsecurity::compat::FallbackAtQuickExit(handler);
}

#endif  // __GLIBC__ && __linux__
