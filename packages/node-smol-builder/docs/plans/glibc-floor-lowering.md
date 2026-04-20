# Lowering the Linux glibc floor — staged plan

**Status**: groundwork only. No behavior change today.

## Goal

Lower our Linux glibc requirement from **2.28** (AlmaLinux 8 / RHEL 8) to **2.17** (CentOS 7 / Amazon Linux 1 / aarch64 baseline). 2.17 is the ultimate aarch64 glibc floor, so going lower on x64 alone has no value.

## Strategy — `--wrap` + `dlsym` + fallback

Adopted from Bun's [oven-sh/bun#29461](https://github.com/oven-sh/bun/pull/29461). Each linker-wrapped symbol is:

1. **Resolved at runtime via `dlsym(RTLD_NEXT, ...)`.** On glibc ≥ the symbol's introduction version, the real implementation is forwarded to — behavior identical to unwrapped.
2. **Falls back to a compatibility implementation** only when `dlsym` returns nullptr (i.e. glibc lacks the symbol).

No behavior change until the build environment moves to a glibc 2.17 image. Until then, every wrap is a dlsym indirection that resolves to the current glibc's symbol.

## Groundwork delivered

**File**: `additions/source-patched/src/socketsecurity/compat/glibc_compat.{h,cc}`
**Patch**: `patches/source-patched/021-glibc-compat-layer.patch`

Wraps one symbol:
- `__cxa_thread_atexit_impl@GLIBC_2.18` — libstdc++ thread_local destructors. V8 alone emits 533+ references. Fallback ported from libc++abi 19.1.0 under Apache-2.0 WITH LLVM-exception. Attribution in repo LICENSE.

The compat layer compiles to an empty TU on musl (`#ifdef __GLIBC__` guard). The `-Wl,--wrap=__cxa_thread_atexit_impl` linker flag is a no-op on musl (symbol unreferenced).

## Remaining work to actually lower the floor

None of this is done yet.

### 1. Enumerate remaining >2.17 symbols (blocking)

Build the current binary, run `objdump -T out/Release/node | grep 'GLIBC_2\.1[89]\|GLIBC_2\.2\|GLIBC_2\.3' | sort -u`. The authoritative target list. Expect additional wraps beyond `__cxa_thread_atexit_impl`:

- `getrandom@2.25` — if unpatched `deps/cares/config/linux/ares_config.h` ends up with `HAVE_GETRANDOM=1`. Cleaner fix: `#undef HAVE_GETRANDOM` when `__GLIBC_PREREQ < 2.25`.
- `quick_exit@2.24`, `at_quick_exit@2.24` — if libstdc++ emits them (depends on whether `--partly-static` is used).
- `fcntl64@2.28` — NOT a code issue; emitted by glibc 2.28+ headers macro-redirecting `fcntl()`. Solved by building on a 2.17 host.

Extend `glibc_compat.cc` with one function per remaining symbol following the same pattern.

### 2. Build-image migration (blocking)

- Current base: `almalinux:8` (glibc 2.28) + GCC Toolset 13.
- Target base: `quay.io/pypa/manylinux2014_x86_64` (CentOS 7 vault, glibc 2.17) + SCL `devtoolset-14` (C++20).
- Alternative: AlmaLinux 7 + devtoolset-14.
- Verify SCL devtoolset-14 still available for CentOS 7 vault before committing to the image.

### 3. CI matrix

- Add `glibc_floor: ['2.17', '2.28']` to node-smol.yml matrix.
- Expand cache keys to include glibc_floor so both variants cache independently.
- Run release on 2.17 base once green.

### 4. Enforcement test

- New `test/integration/glibc-floor.test.mts` modeled on Bun's `symbols.test.ts`.
- Runs `objdump -T` on the built binary. Fails if any `GLIBC_2.x > 2.17` remains.
- Uses integer-tuple comparator (semver libs mishandle `2.17`).

### 5. Runtime smoke test

- CI step: run the built binary in a CentOS 7 container and execute the smoke-test suite.
- Catches `thread_local` destructor issues the link-time check cannot.

## Known limitations of the compat layer

Inherited from the libc++abi-19.1 port:
- `dso_symbol` is ignored (glibc's impl uses it for DSO refcount handling; on 2.17 hosts where the real impl is missing, `dlclose()` of FFI addons may be unsafe).
- Destructors registered on the main thread run at static-destruction time, not thread-exit time.

Both limitations only apply when running on glibc 2.17 (the fallback path). On glibc 2.18+ the dlsym path is taken and semantics are unchanged.

## References

- [Bun PR 29461](https://github.com/oven-sh/bun/pull/29461) — the recipe.
- [libc++abi 19.1.0 `cxa_thread_atexit.cpp`](https://github.com/llvm/llvm-project/blob/llvmorg-19.1.0/libcxxabi/src/cxa_thread_atexit.cpp) — source of the fallback.
- [pypa/manylinux2014](https://github.com/pypa/manylinux) — candidate base image (EOL 2027-05-04).
- [nodejs/node#52223](https://github.com/nodejs/node/issues/52223) — known c-ares/getrandom issue on old glibc.
