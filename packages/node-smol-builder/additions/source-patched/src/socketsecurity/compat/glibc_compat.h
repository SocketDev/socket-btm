// socketsecurity/compat/glibc_compat.h
//
// Groundwork for lowering the Linux glibc floor without yet doing so. Provides
// linker wraps that, on current glibc 2.18+ builds, dlsym() the real glibc
// implementation at runtime — behavior identical to unwrapped. On a future
// glibc 2.17 host, the dlsym lookup returns nullptr and we fall back to an
// implementation that stays within the 2.17 ABI.
//
// Each wrap is gated at preprocessor time on `defined(__GLIBC__)`:
//   - glibc: wrap is compiled, dlsym forwards, fallback available.
//   - musl:  file compiles to an empty TU; the -Wl,--wrap flag is a no-op.
//
// Wrapped symbols:
//   - __cxa_thread_atexit_impl  (glibc 2.18) — libstdc++ thread_local dtors
//   - getrandom                  (glibc 2.25) — vDSO-accelerated crypto seeding
//   - quick_exit                 (glibc 2.24) — C11-correct quick exit
//   - at_quick_exit              (glibc 2.24) — register handlers for quick_exit
//
// Pattern per wrap:
//   static FnPtr real = reinterpret_cast<FnPtr>(dlsym(RTLD_NEXT, "sym"));
//   if (real) return real(...);   // glibc has it — use real impl
//   return fallback(...);          // pre-glibc-introduction-version fallback

#ifndef SOCKETSECURITY_COMPAT_GLIBC_COMPAT_H_
#define SOCKETSECURITY_COMPAT_GLIBC_COMPAT_H_

#if defined(__GLIBC__) && defined(__linux__)

#include <stddef.h>  // size_t
#include <sys/types.h>  // ssize_t

extern "C" {

// libstdc++ / libc++abi / Rust std all emit references to this symbol.
// Upstream lld does not propagate the weak attribute to the verneed entry,
// so loading on glibc < 2.18 fails even when callers use __attribute__((weak)).
// Provide a strong definition; forward to real impl via dlsym when present.
int __wrap___cxa_thread_atexit_impl(void (*dtor)(void*), void* obj,
                                    void* dso_symbol);

// getrandom(2) — glibc 2.25+. Fallback: raw syscall(SYS_getrandom, ...).
// On kernels older than 3.17 the syscall returns -1/ENOSYS; callers that need
// entropy (OpenSSL, c-ares, V8 highway) already fall back to /dev/urandom.
ssize_t __wrap_getrandom(void* buf, size_t buflen, unsigned int flags);

// quick_exit — glibc 2.24+ (C11 std::quick_exit). Fallback: drain our own
// at_quick_exit handler list, then _exit(code).
__attribute__((noreturn)) void __wrap_quick_exit(int code);

// at_quick_exit — glibc 2.24+. Fallback: store handlers in a process-local
// list that __wrap_quick_exit drains in LIFO order per C11 §7.22.4.3.
int __wrap_at_quick_exit(void (*handler)(void));

}  // extern "C"

#endif  // __GLIBC__ && __linux__

#endif  // SOCKETSECURITY_COMPAT_GLIBC_COMPAT_H_
