// getrandom — glibc 2.25 — vDSO-accelerated crypto entropy.
//
// Fallback: raw syscall(SYS_getrandom, ...). On kernels < 3.17 the syscall
// returns -1/ENOSYS; in-tree callers (OpenSSL, c-ares, V8 highway) handle
// that by falling back to /dev/urandom.

#if defined(__GLIBC__) && defined(__linux__)

#include "socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h"
#include "socketsecurity/glibc-2-17-compat/shims/_internal/dlsym_resolve.h"

#include <errno.h>
#include <sys/syscall.h>
#include <unistd.h>

extern "C" ssize_t __wrap_getrandom(void* buf, size_t buflen,
                                    unsigned int flags) {
  using GetrandomFn = ssize_t (*)(void*, size_t, unsigned int);
  static GetrandomFn real =
      socketsecurity::compat::ResolveNext<GetrandomFn>("getrandom");
  if (real) {
    // glibc 2.25+ path — preserves the vDSO fast path on glibc 2.41+.
    return real(buf, buflen, flags);
  }
#if defined(SYS_getrandom)
  // Raw syscall fallback for glibc < 2.25. On kernels < 3.17 this returns
  // -1/ENOSYS; in-tree callers handle that by falling back to /dev/urandom.
  return syscall(SYS_getrandom, buf, buflen, flags);
#else
  errno = ENOSYS;
  return -1;
#endif
}

#endif  // __GLIBC__ && __linux__
