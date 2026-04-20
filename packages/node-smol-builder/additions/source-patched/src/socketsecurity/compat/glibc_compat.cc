// socketsecurity/compat/glibc_compat.cc
//
// glibc compatibility layer (groundwork for lowering the glibc floor).
//
// Portions adapted from libc++abi 19.1.0 under Apache-2.0 WITH LLVM-exception.
// Source: https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/libcxxabi/src/cxa_thread_atexit.cpp
// Attribution retained in the repo LICENSE file.
//
// This file compiles on glibc Linux only. On musl it reduces to an empty
// translation unit so the sources list can stay Linux-agnostic in gyp.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/compat/glibc_compat.h"

#include <dlfcn.h>
#include <errno.h>
#include <pthread.h>
#include <stdlib.h>
#include <sys/syscall.h>
#include <unistd.h>

namespace socketsecurity {
namespace compat {

// ============================================================================
// __cxa_thread_atexit_impl — libc++abi-19.1 fallback
// ============================================================================
// Used only when glibc < 2.18 (no __cxa_thread_atexit_impl). On glibc 2.18+
// the dlsym path is taken and this fallback is never invoked.
//
// Limitations inherited from the libc++abi port:
//   - dso_symbol is ignored (glibc's impl uses it for DSO-refcount handling).
//   - Destructors registered on the main thread run at static-destruction time.
// Both are acceptable on the target floor (glibc 2.17 / CentOS 7) where no
// runtime library ships with the real impl.

namespace {

using DtorFn = void (*)(void*);

struct DtorList {
  DtorFn dtor;
  void* obj;
  DtorList* next;
};

__thread DtorList* dtors = nullptr;
__thread bool dtors_alive = false;
pthread_key_t dtors_key;

void RunDtors(void* /*unused*/) {
  while (auto head = dtors) {
    dtors = head->next;
    head->dtor(head->obj);
    free(head);
  }
  dtors_alive = false;
}

struct DtorsManager {
  DtorsManager() {
    if (pthread_key_create(&dtors_key, RunDtors) != 0) {
      abort();
    }
  }
  ~DtorsManager() { RunDtors(nullptr); }
};

int FallbackThreadAtexit(DtorFn dtor, void* obj, void* /*dso_symbol*/) {
  static DtorsManager manager;

  if (!dtors_alive) {
    if (pthread_setspecific(dtors_key, &dtors_key) != 0) {
      return -1;
    }
    dtors_alive = true;
  }

  auto* head = static_cast<DtorList*>(malloc(sizeof(DtorList)));
  if (!head) {
    return -1;
  }
  head->dtor = dtor;
  head->obj = obj;
  head->next = dtors;
  dtors = head;
  return 0;
}

}  // namespace

// ============================================================================
// at_quick_exit / quick_exit — process-wide handler list
// ============================================================================
// quick_exit and at_quick_exit arrived together in glibc 2.24. On 2.17 we
// keep our own LIFO list and drain it from our quick_exit fallback.
// C11 §7.22.4.3 requires implementations support at least 32 handlers.

namespace {

constexpr int kMaxAtQuickExitHandlers = 32;
using AtQuickExitFn = void (*)(void);
AtQuickExitFn g_at_quick_exit_handlers[kMaxAtQuickExitHandlers] = {};
int g_at_quick_exit_count = 0;
pthread_mutex_t g_at_quick_exit_mutex = PTHREAD_MUTEX_INITIALIZER;

int FallbackAtQuickExit(AtQuickExitFn handler) {
  if (!handler) {
    return -1;
  }
  pthread_mutex_lock(&g_at_quick_exit_mutex);
  if (g_at_quick_exit_count >= kMaxAtQuickExitHandlers) {
    pthread_mutex_unlock(&g_at_quick_exit_mutex);
    return -1;
  }
  g_at_quick_exit_handlers[g_at_quick_exit_count++] = handler;
  pthread_mutex_unlock(&g_at_quick_exit_mutex);
  return 0;
}

__attribute__((noreturn)) void FallbackQuickExit(int code) {
  // Snapshot the whole handler array + count under the mutex, THEN release.
  // A concurrent FallbackAtQuickExit() could otherwise write into a slot we
  // just bounds-checked but haven't loaded yet — torn function-pointer reads
  // on 32-bit and clobbered-slot reads on 64-bit. Fixed-size snapshot keeps
  // this cheap.
  AtQuickExitFn snapshot[kMaxAtQuickExitHandlers];
  int count;
  pthread_mutex_lock(&g_at_quick_exit_mutex);
  count = g_at_quick_exit_count;
  for (int i = 0; i < count; ++i) {
    snapshot[i] = g_at_quick_exit_handlers[i];
  }
  pthread_mutex_unlock(&g_at_quick_exit_mutex);

  // Drain in LIFO order (C11 §7.22.4.3).
  for (int i = count - 1; i >= 0; --i) {
    AtQuickExitFn handler = snapshot[i];
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

// ============================================================================
// __wrap_* entry points
// ============================================================================

extern "C" int __wrap___cxa_thread_atexit_impl(void (*dtor)(void*), void* obj,
                                               void* dso_symbol) {
  using ImplFn = int (*)(void (*)(void*), void*, void*);
  static ImplFn real = reinterpret_cast<ImplFn>(
      dlsym(RTLD_NEXT, "__cxa_thread_atexit_impl"));
  if (real) {
    // glibc 2.18+ path — preserve DSO refcount semantics.
    return real(dtor, obj, dso_symbol);
  }
  return socketsecurity::compat::FallbackThreadAtexit(dtor, obj, dso_symbol);
}

extern "C" ssize_t __wrap_getrandom(void* buf, size_t buflen,
                                    unsigned int flags) {
  using GetrandomFn = ssize_t (*)(void*, size_t, unsigned int);
  static GetrandomFn real =
      reinterpret_cast<GetrandomFn>(dlsym(RTLD_NEXT, "getrandom"));
  if (real) {
    // glibc 2.25+ path — preserves the vDSO fast path on glibc 2.41+.
    return real(buf, buflen, flags);
  }
#if defined(SYS_getrandom)
  // Raw syscall fallback for glibc < 2.25. On kernels < 3.17 this returns
  // -1/ENOSYS; all in-tree callers (OpenSSL, c-ares, V8 highway) handle
  // that by falling back to /dev/urandom.
  return syscall(SYS_getrandom, buf, buflen, flags);
#else
  errno = ENOSYS;
  return -1;
#endif
}

extern "C" void __wrap_quick_exit(int code) {
  using QuickExitFn = void (*)(int);
  static QuickExitFn real =
      reinterpret_cast<QuickExitFn>(dlsym(RTLD_NEXT, "quick_exit"));
  if (real) {
    // glibc 2.24+ path — C11-correct (skips thread_local dtors per C11/C++11;
    // the pre-2.24 @GLIBC_2.10 version erroneously ran them, see glibc#20198).
    real(code);
    __builtin_unreachable();
  }
  socketsecurity::compat::FallbackQuickExit(code);
}

extern "C" int __wrap_at_quick_exit(void (*handler)(void)) {
  using AtQuickExitRealFn = int (*)(void (*)(void));
  static AtQuickExitRealFn real =
      reinterpret_cast<AtQuickExitRealFn>(dlsym(RTLD_NEXT, "at_quick_exit"));
  if (real) {
    return real(handler);
  }
  return socketsecurity::compat::FallbackAtQuickExit(handler);
}

#endif  // __GLIBC__ && __linux__
