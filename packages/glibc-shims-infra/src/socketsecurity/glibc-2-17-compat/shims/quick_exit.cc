// quick_exit — glibc 2.24 — C11-correct quick exit.
//
// Fallback: snapshot the at_quick_exit handler list under the mutex, drain
// it in LIFO order (C11 §7.22.4.3), then _exit() to bypass atexit handlers
// and stream flushes.
//
// State shared with shims/at_quick_exit.cc via the QuickExitState
// namespace — see that file's docstring for the contract.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h"
#include "socketsecurity/glibc-2-17-compat/shims/_internal/dlsym_resolve.h"

#include <pthread.h>
#include <unistd.h>

namespace socketsecurity {
namespace compat {
namespace quick_exit_state {

// Forward declarations — defined in shims/at_quick_exit.cc.
constexpr int kMaxHandlers = 32;
using HandlerFn = void (*)(void);
extern HandlerFn g_handlers[kMaxHandlers];
extern int g_count;
extern pthread_mutex_t g_mutex;

}  // namespace quick_exit_state

namespace {

__attribute__((noreturn)) void FallbackQuickExit(int code) {
  // Snapshot the whole handler array + count under the mutex, THEN release.
  // A concurrent FallbackAtQuickExit() could otherwise write into a slot we
  // just bounds-checked but haven't loaded yet — torn function-pointer reads
  // on 32-bit and clobbered-slot reads on 64-bit. Fixed-size snapshot keeps
  // this cheap.
  quick_exit_state::HandlerFn snapshot[quick_exit_state::kMaxHandlers];
  int count;
  pthread_mutex_lock(&quick_exit_state::g_mutex);
  count = quick_exit_state::g_count;
  for (int i = 0; i < count; ++i) {
    snapshot[i] = quick_exit_state::g_handlers[i];
  }
  pthread_mutex_unlock(&quick_exit_state::g_mutex);

  // Drain in LIFO order (C11 §7.22.4.3).
  for (int i = count - 1; i >= 0; --i) {
    quick_exit_state::HandlerFn handler = snapshot[i];
    if (handler) {
      handler();
    }
  }
  // Bypass atexit handlers and buffered stream flushes — C11 quick_exit
  // contract. _exit does exactly that.
  _exit(code);
}

}  // namespace
}  // namespace compat
}  // namespace socketsecurity

extern "C" void __wrap_quick_exit(int code) {
  using QuickExitFn = void (*)(int);
  static QuickExitFn real =
      socketsecurity::compat::ResolveNext<QuickExitFn>("quick_exit");
  if (real) {
    // glibc 2.24+ path — C11-correct (skips thread_local dtors per C11/C++11;
    // the pre-2.24 @GLIBC_2.10 version erroneously ran them, see glibc#20198).
    real(code);
    __builtin_unreachable();
  }
  socketsecurity::compat::FallbackQuickExit(code);
}

#endif  // __GLIBC__ && __linux__
