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
#include <pthread.h>
#include <stdlib.h>

namespace socketsecurity {
namespace compat {
namespace {

// libc++abi-19.1 fallback — used only when glibc < 2.18 (no
// __cxa_thread_atexit_impl). On glibc 2.18+ the dlsym path below is taken and
// this fallback is never invoked.
//
// Limitations inherited from the libc++abi port:
//   - dso_symbol is ignored (glibc's impl uses it for DSO-refcount handling).
//   - Destructors registered on the main thread run at static-destruction time.
// Both are acceptable on the target floor (glibc 2.17 / CentOS 7) where no
// runtime library ships with the real impl.

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
}  // namespace compat
}  // namespace socketsecurity

extern "C" int __wrap___cxa_thread_atexit_impl(void (*dtor)(void*), void* obj,
                                               void* dso_symbol) {
  using ImplFn = int (*)(void (*)(void*), void*, void*);
  static ImplFn real = reinterpret_cast<ImplFn>(
      dlsym(RTLD_NEXT, "__cxa_thread_atexit_impl"));
  if (real) {
    // glibc 2.18+ path — preserve DSO refcount semantics.
    return real(dtor, obj, dso_symbol);
  }
  // glibc < 2.18 fallback.
  return socketsecurity::compat::FallbackThreadAtexit(dtor, obj, dso_symbol);
}

#endif  // __GLIBC__ && __linux__
