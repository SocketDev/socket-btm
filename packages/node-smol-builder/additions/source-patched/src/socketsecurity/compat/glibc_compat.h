// socketsecurity/compat/glibc_compat.h
//
// Groundwork for lowering the Linux glibc floor without yet doing so. Provides
// linker wraps that, on current glibc 2.18+ builds, dlsym() the real glibc
// implementation at runtime — behavior identical to unwrapped. On a future
// glibc 2.17 host, the dlsym lookup returns nullptr and we fall back to a
// libc++abi-19.1-derived implementation.
//
// Each wrap is gated at preprocessor time on `defined(__GLIBC__)`:
//   - glibc: wrap is compiled, dlsym forwards, fallback available.
//   - musl:  file compiles to an empty TU, the -Wl,--wrap flag is a no-op.
//
// Wrapped symbols (planned):
//   - __cxa_thread_atexit_impl  (glibc 2.18) — libstdc++ thread_local dtors
//
// To extend: add a wrap for `getrandom` (2.25) and `quick_exit` (2.24) per
// Bun's oven-sh/bun PR 29461, each with dlsym fallback + syscall/alternate
// path. Do not add wraps for symbols whose fallback cannot be implemented
// without functional regression.

#ifndef SOCKETSECURITY_COMPAT_GLIBC_COMPAT_H_
#define SOCKETSECURITY_COMPAT_GLIBC_COMPAT_H_

#if defined(__GLIBC__) && defined(__linux__)

extern "C" {

// libstdc++ / libc++abi / Rust std all emit references to this symbol.
// Upstream lld does not propagate the weak attribute to the verneed entry,
// so loading on glibc < 2.18 fails even when callers use __attribute__((weak)).
// Provide a strong definition; forward to real impl via dlsym when present.
int __wrap___cxa_thread_atexit_impl(void (*dtor)(void*), void* obj,
                                    void* dso_symbol);

}  // extern "C"

#endif  // __GLIBC__ && __linux__

#endif  // SOCKETSECURITY_COMPAT_GLIBC_COMPAT_H_
