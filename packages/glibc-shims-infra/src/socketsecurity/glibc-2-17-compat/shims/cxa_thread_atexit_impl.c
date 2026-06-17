// __cxa_thread_atexit_impl — glibc 2.18 — libstdc++ thread_local destructors.
//
// Portions adapted from libc++abi 19.1.0 under Apache-2.0 WITH LLVM-exception.
// Source: https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/libcxxabi/src/cxa_thread_atexit.cpp
// Attribution retained in the repo LICENSE file.
//
// Limitations inherited from the libc++abi port:
//   - dso_symbol is ignored (glibc's impl uses it for DSO-refcount handling).
//   - Destructors registered on the main thread run at static-destruction
//     time.
// Both are acceptable on the target floor (glibc 2.17 / CentOS 7) where no
// runtime library ships with the real impl.
//
// Implementation note: the C++ original used a static RAII manager to set
// up + tear down the pthread_key. C has no RAII, so we use:
//   - pthread_once for the constructor (single-shot key creation).
//   - __attribute__((destructor)) for the main-thread teardown.
// Same observable behavior, different mechanism.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h"
#include "socketsecurity/glibc-2-17-compat/shims/_internal/dlsym_resolve.h"

#include <pthread.h>
#include <stdlib.h>

typedef void (*dtor_fn_t)(void*);

typedef struct dtor_list {
  dtor_fn_t dtor;
  void* obj;
  struct dtor_list* next;
} dtor_list_t;

static __thread dtor_list_t* dtors = NULL;
static __thread int dtors_alive = 0;
static pthread_key_t dtors_key;
static pthread_once_t dtors_key_once = PTHREAD_ONCE_INIT;

static void run_dtors(void* unused) {
  (void)unused;
  while (dtors) {
    dtor_list_t* head = dtors;
    dtors = head->next;
    head->dtor(head->obj);
    free(head);
  }
  dtors_alive = 0;
}

static void create_dtors_key(void) {
  if (pthread_key_create(&dtors_key, run_dtors) != 0) {
    abort();
  }
}

// Drain the main thread's destructor list at process exit. Mirrors the
// C++ original's ~DtorsManager() — pthread_key destructors only run for
// non-main threads, so the main thread needs an explicit hook.
static __attribute__((destructor)) void run_main_thread_dtors(void) {
  run_dtors(NULL);
}

typedef int (*cxa_thread_atexit_fn_t)(void (*)(void*), void*, void*);

static int fallback_thread_atexit(dtor_fn_t dtor, void* obj,
                                  void* dso_symbol) {
  (void)dso_symbol;
  pthread_once(&dtors_key_once, create_dtors_key);

  if (!dtors_alive) {
    if (pthread_setspecific(dtors_key, &dtors_key) != 0) {
      return -1;
    }
    dtors_alive = 1;
  }

  dtor_list_t* head = (dtor_list_t*)malloc(sizeof(dtor_list_t));
  if (!head) {
    return -1;
  }
  head->dtor = dtor;
  head->obj = obj;
  head->next = dtors;
  dtors = head;
  return 0;
}

int __wrap___cxa_thread_atexit_impl(void (*dtor)(void*), void* obj,
                                    void* dso_symbol) {
  static cxa_thread_atexit_fn_t real = NULL;
  static int resolved = 0;
  if (!resolved) {
    real = (cxa_thread_atexit_fn_t)socketsecurity_compat_resolve_next(
        "__cxa_thread_atexit_impl");
    resolved = 1;
  }
  if (real) {
    // glibc 2.18+ path — preserve DSO refcount semantics.
    return real(dtor, obj, dso_symbol);
  }
  return fallback_thread_atexit(dtor, obj, dso_symbol);
}

#endif  // __GLIBC__ && __linux__
