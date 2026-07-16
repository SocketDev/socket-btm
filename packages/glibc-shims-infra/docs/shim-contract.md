# shim-contract.md

Per-symbol semantics for every shim in `src/socketsecurity/glibc-2-17-compat/shims/`.
Each shim is a function pair: a runtime `dlsym` lookup of the real glibc
symbol + a fallback implementation that runs when the real symbol is
absent (glibc < introduction version).

The shims activate via `-Wl,--wrap=<symbol>` linker flags injected by
`gyp/glibc-shims-infra.gypi`. Without those flags, the dispatcher
functions are dead code.

---

## `__cxa_thread_atexit_impl` — glibc 2.18

**Caller surface.** libstdc++, libc++abi, and Rust std emit references to
this symbol for every `thread_local` object with a non-trivial destructor.
A binary that ever calls `thread_local std::vector<…>` (etc.) will link
this symbol at load time.

**dlsym path.** Forward `(dtor, obj, dso_symbol)` to the real implementation.
glibc tracks DSO refcounts via `dso_symbol` so unloaded shared objects
don't leave dangling thread-local destructor pointers.

**Fallback path.** Per-thread linked list of `(dtor, obj)` pairs guarded by
a `pthread_key_t`. `pthread_setspecific(dtors_key, …)` makes pthreads
invoke `RunDtors()` at thread exit, which drains the list LIFO.

**Limitations of the fallback.**

- `dso_symbol` is ignored. On glibc 2.17 no DSO unload path exists for
  `thread_local` dtors — `dlclose` after thread exit is unsafe. Acceptable
  because the fleet binaries are static-linked + don't `dlclose` C++ DSOs.
- Dtors registered on the **main thread** run at static-destruction time
  (`DtorsManager`'s dtor), not on `pthread_exit`. Matches libc++abi behavior.

**Source.** Adapted from libc++abi 19.1.0 under Apache-2.0 WITH LLVM-exception.
Attribution in repo root `LICENSE`.

---

## `getrandom` — glibc 2.25

**Caller surface.** OpenSSL's RAND_priv_bytes path, c-ares' DNS query ID
generation, V8's highway RNG. Most callers already have a `/dev/urandom`
fallback for systems without `getrandom`, but the dlsym path is the fast
path on glibc 2.41+ via vDSO acceleration.

**dlsym path.** Forward `(buf, buflen, flags)` to the real implementation.

**Fallback path.** Raw `syscall(SYS_getrandom, buf, buflen, flags)`. The
syscall exists in kernel >= 3.17. On older kernels the syscall returns
`-1/ENOSYS`; callers handle that by falling back to `/dev/urandom`.

**Limitations of the fallback.** No vDSO acceleration on glibc < 2.41. The
syscall overhead (~100ns) is acceptable; entropy is consumed in small
batches at startup, not in hot paths.

---

## `quick_exit` — glibc 2.24

**Caller surface.** C11 `<stdlib.h>` and C++11 `<cstdlib>`. Used when a
program wants to bypass `atexit` handlers + buffered stream flushes (i.e.
"exit fast, skip cleanup, don't trust the heap"). Rarely called directly
in this fleet; libstdc++ calls it from `std::quick_exit`.

**dlsym path.** Forward `(code)` to the real implementation. The real glibc
2.24+ implementation is C11-correct (does **not** run `thread_local`
destructors). The pre-2.24 `@GLIBC_2.10` symbol erroneously ran them, see
[glibc#20198](https://sourceware.org/bugzilla/show_bug.cgi?id=20198) — but
that symbol is also absent on glibc 2.17, so we don't reach it.

**Fallback path.**

1. Snapshot the at_quick_exit handler list under a mutex.
2. Drain LIFO per C11 §7.22.4.3.
3. `_exit(code)` to bypass atexit handlers + stream flushes.

**Limitations of the fallback.** None. C11 contract is satisfied.

---

## `at_quick_exit` — glibc 2.24

**Caller surface.** Companion to `quick_exit`. Same callers as above.

**dlsym path.** Forward `(handler)` to the real implementation.

**Fallback path.** Append `handler` to a fixed-size process-local array
(`kMaxHandlers = 32`, the C11-required minimum). Returns `-1` if the
array is full. Sharing the array with `quick_exit.c` is intentional;
the snapshot-then-release pattern in `FallbackQuickExit` avoids
torn-pointer reads under concurrent `at_quick_exit` calls.

**Limitations of the fallback.** Handler count capped at 32. C11 says
implementations MUST support at least 32; this is the minimum-compliant
implementation. If a future caller wants more, bump `kMaxHandlers` (the
array sizing is the only knob).

---

## Adding a new shim

1. New file under `src/socketsecurity/glibc-2-17-compat/shims/<symbol>.c`.
2. Declare `__wrap_<symbol>` in `src/socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h`.
3. Add `--wrap=<symbol>` to `lib/link-flags.mts` AND `gyp/glibc-shims-infra.gypi`.
4. Document the contract in this file (caller surface + dlsym path + fallback
   path + limitations).
5. Add `test/<symbol>.test.mts` that exercises both the dlsym path and the
   fallback path.

Per fleet rule "1 path, 1 reference" — the `--wrap` symbol list MUST be
consistent across `lib/link-flags.mts` and `gyp/glibc-shims-infra.gypi`.
A `node scripts/check-link-flag-parity.mts` script (TODO) will assert that
on commit.
