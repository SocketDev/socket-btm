// Umbrella header — declarations for every shim exposed by
// glibc-shims-infra.
//
// Drop-in for fleet Linux binaries that want to run on glibc >= 2.17. Each
// declared symbol is implemented by exactly one file under
// shims/<symbol>.cc. The compile unit is gated on __GLIBC__ + __linux__
// so musl/Windows/macOS targets compile to empty TUs (the --wrap link
// flags are then no-ops).
//
// Pattern per shim:
//   1. -Wl,--wrap=<symbol> in ldflags (see lib/link-flags.mts).
//   2. The linker rewrites caller's `<symbol>(...)` to `__wrap_<symbol>(...)`.
//   3. __wrap_<symbol> looks up the real glibc symbol via dlsym(RTLD_NEXT, ...).
//   4. If present → forward to real (glibc >= introduction version).
//   5. If absent  → fall back to a 2.17-compatible implementation.

#ifndef SOCKETSECURITY_GLIBC_2_17_COMPAT_H_
#define SOCKETSECURITY_GLIBC_2_17_COMPAT_H_

#if defined(__GLIBC__) && defined(__linux__)

#include <stddef.h>
#include <sys/types.h>

extern "C" {

// __cxa_thread_atexit_impl — glibc 2.18. libstdc++, libc++abi, Rust std all
// emit references. Upstream lld does not propagate the weak attribute to
// the verneed entry, so loading on glibc < 2.18 fails even when callers
// use __attribute__((weak)). Provide a strong definition; forward to real
// impl via dlsym when present.
int __wrap___cxa_thread_atexit_impl(void (*dtor)(void*), void* obj,
                                    void* dso_symbol);

// getrandom — glibc 2.25. Fallback: raw syscall(SYS_getrandom, ...). On
// kernels < 3.17 the syscall returns -1/ENOSYS; callers that need entropy
// (OpenSSL, c-ares, V8 highway) already fall back to /dev/urandom.
ssize_t __wrap_getrandom(void* buf, size_t buflen, unsigned int flags);

// quick_exit — glibc 2.24 (C11 std::quick_exit). Fallback: drain our own
// at_quick_exit handler list, then _exit(code).
__attribute__((noreturn)) void __wrap_quick_exit(int code);

// at_quick_exit — glibc 2.24. Fallback: store handlers in a process-local
// list that __wrap_quick_exit drains in LIFO order per C11 §7.22.4.3.
int __wrap_at_quick_exit(void (*handler)(void));

}  // extern "C"

#endif  // __GLIBC__ && __linux__

#endif  // SOCKETSECURITY_GLIBC_2_17_COMPAT_H_
