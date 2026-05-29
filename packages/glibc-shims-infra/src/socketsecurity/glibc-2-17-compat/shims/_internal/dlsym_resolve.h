// Shared dlsym(RTLD_NEXT, name) helper. Used by every shim to look up the
// "real" glibc symbol at runtime. The static caching pattern means each
// shim pays exactly one dlsym call per process lifetime (first invocation),
// regardless of how hot the wrapped function is.

#ifndef SOCKETSECURITY_GLIBC_2_17_COMPAT_SHIMS_INTERNAL_DLSYM_RESOLVE_H_
#define SOCKETSECURITY_GLIBC_2_17_COMPAT_SHIMS_INTERNAL_DLSYM_RESOLVE_H_

#if defined(__GLIBC__) && defined(__linux__)

#include <dlfcn.h>

namespace socketsecurity {
namespace compat {

// Look up `name` in the next shared object after the wrapping binary —
// i.e. glibc when present. Returns the resolved function pointer cast to
// FnPtr, or nullptr if the symbol is absent (the fallback case).
template <typename FnPtr>
inline FnPtr ResolveNext(const char* name) {
  return reinterpret_cast<FnPtr>(dlsym(RTLD_NEXT, name));
}

}  // namespace compat
}  // namespace socketsecurity

#endif  // __GLIBC__ && __linux__

#endif  // SOCKETSECURITY_GLIBC_2_17_COMPAT_SHIMS_INTERNAL_DLSYM_RESOLVE_H_
