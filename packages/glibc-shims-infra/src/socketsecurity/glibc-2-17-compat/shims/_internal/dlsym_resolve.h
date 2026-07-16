// Shared dlsym(RTLD_NEXT, name) helper. Used by every shim to look up the
// "real" glibc symbol at runtime. Callers cache the resolved pointer in a
// file-static `void*` so each shim pays exactly one dlsym call per process
// lifetime (first invocation), regardless of how hot the wrapped function is.

#ifndef SOCKETSECURITY_GLIBC_2_17_COMPAT_SHIMS_INTERNAL_DLSYM_RESOLVE_H_
#define SOCKETSECURITY_GLIBC_2_17_COMPAT_SHIMS_INTERNAL_DLSYM_RESOLVE_H_

#if defined(__GLIBC__) && defined(__linux__)

#include <dlfcn.h>

#ifdef __cplusplus
extern "C" {
#endif

// Look up `name` in the next shared object after the wrapping binary —
// i.e. glibc when present. Returns the resolved symbol pointer (cast at
// the call site to the appropriate function-pointer type) or NULL when
// the symbol is absent (the fallback case).
static inline void* socketsecurity_compat_resolve_next(const char* name) {
  return dlsym(RTLD_NEXT, name);
}

#ifdef __cplusplus
}  // extern "C"
#endif

#endif  // __GLIBC__ && __linux__

#endif  // SOCKETSECURITY_GLIBC_2_17_COMPAT_SHIMS_INTERNAL_DLSYM_RESOLVE_H_
