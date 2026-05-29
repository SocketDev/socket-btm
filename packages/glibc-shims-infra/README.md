# glibc-shims-infra

glibc 2.17 compat layer for fleet Linux binaries. Drop-in for any C/C++ binary
in the fleet that wants to run on Amazon Linux 1, CentOS 7, RHEL 7, or any
distro with glibc >= 2.17.

## What's in scope

Symbols added to glibc between 2.18 and 2.36 that fleet code (or its vendored
deps) reaches for. Each shim:

- Resolves the real glibc symbol via `dlsym(RTLD_NEXT, …)` on systems where
  it exists.
- Falls back to an equivalent implementation (syscall, pthread primitives,
  or an explicit no-op) on systems where it doesn't.

The shims are activated at link time via `-Wl,--wrap=<symbol>` flags — the
linker rewrites every `<symbol>` call to `__wrap_<symbol>`, which lives in
this package. On glibc >= 2.34 the dlsym path runs unchanged; on glibc 2.17
the fallback path runs. Same binary works everywhere.

## Drop-in usage

A consumer (binary target) declares a workspace dep on this package, then
wires the gyp include + ldflags from its own gyp file:

```gyp
{
  'targets': [{
    'target_name': 'my_smol_binary',
    'includes': [ '../../glibc-shims-infra/gyp/glibc-shims-infra.gypi' ],
    'dependencies': [
      '../../glibc-shims-infra/gyp/glibc-shims-infra.gyp:glibc_shims_infra',
    ],
    # ldflags injected by the gypi — no string-typing of --wrap flags
    # per-binary.
  }],
}
```

In TypeScript build glue:

```ts
import { GLIBC_SHIMS_LINK_FLAGS } from 'glibc-shims-infra/lib/link-flags'
// pass as ldflags array entries
```

Per fleet rule **1 path, 1 reference** — every consumer reads the canonical
link-flag list from `lib/link-flags.mts`. No string-typed `-Wl,--wrap=` in
downstream gyp files.

## Symbols shimmed

| Symbol | glibc added | Shim strategy |
| --- | --- | --- |
| `getrandom` | 2.25 | `dlsym(RTLD_NEXT)` → `syscall(SYS_getrandom)` |
| `quick_exit` | 2.24 | `dlsym` → drain `__wrap_at_quick_exit` LIFO + `_exit()` |
| `at_quick_exit` | 2.24 | `dlsym` → static array + `pthread_mutex_t` |
| `__cxa_thread_atexit_impl` | 2.18 | `dlsym` → `pthread_key_t` per-thread dtor list |

Per-symbol detail + fallback semantics: [`docs/shim-contract.md`](docs/shim-contract.md).

## Adding a new shim

1. New file under `src/socketsecurity/glibc-2-17-compat/shims/<symbol>.cc`.
2. Add the `--wrap=<symbol>` entry in `lib/link-flags.mts`.
3. Add the declaration to `src/socketsecurity/glibc-2-17-compat/glibc_2_17_compat.h`.
4. Document the contract in `docs/shim-contract.md`.
5. Add a behavior test under `test/<symbol>.test.mts`.

One shim, one file. Splits scale linearly — adding the 8th shim is as
contained as adding the 1st.

## Consumers

Every Linux build feeding into the smol-Node binary inherits the glibc
floor of its inputs — so the shim layer applies to all of them. Listed
alphabetically:

- `packages/binsuite/` — fleet binsuite Linux artifacts.
- `packages/boringssl-builder/` — prefixed BoringSSL static libs.
- `packages/curl-builder/` — curl CLI Linux binaries.
- `packages/lief-builder/` — LIEF static lib.
- `packages/lsquic-infra/` — lsquic + ls-qpack vendor patches.
- `packages/node-smol-builder/` — smol Node binary (primary consumer).
- `packages/onnxruntime-builder/` — ONNX runtime WASM/native.
- `packages/postgres-builder/` — libpq static lib.
- `packages/stubs-builder/` — fleet stub binaries.
- `packages/yoga-layout-builder/` — yoga layout static lib.

A consumer adopting glibc-shims-infra needs ONLY a `workspace:*` dep + a
gypi include — no source changes to the shim package itself.
