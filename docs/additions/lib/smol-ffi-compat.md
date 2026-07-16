# smol-ffi compatibility layers

`node:smol-ffi` ships three surfaces in the smol Node binary:

1. `node:smol-ffi` — canonical surface. Use this for new code.
2. `node:smol-ffi/node` — drop-in shim for upstream `node:ffi` (Node v26.1.0+).
3. `node:smol-ffi/bun` — drop-in shim for `bun:ffi`.

The compat layers exist so callers can lift snippets from either upstream
verbatim. New code should target `node:smol-ffi`, which has features the
upstreams don't.

## When to use each

| You have                            | Use                             |
| ----------------------------------- | ------------------------------- |
| New FFI code                        | `require('node:smol-ffi')`      |
| Existing code targeting `node:ffi`  | `require('node:smol-ffi/node')` |
| Existing code targeting `bun:ffi`   | `require('node:smol-ffi/bun')`  |
| Mix-and-match (compat + extensions) | both, side-by-side              |

The three layers share the same underlying native binding (`internalBinding('smol_ffi')`), so opening the same library from `node:smol-ffi/bun` and reading its bytes via `node:smol-ffi.read.batch` is supported and cheap — they share the dlopen cache.

## node:smol-ffi/node — upstream node:ffi forwarder

This is a thin re-exporter. `require('node:smol-ffi/node')` calls
`require('node:ffi')` internally and re-exports the result behind a
frozen, null-prototype object.

```js
const ffi = require('node:smol-ffi/node')

// node:ffi v26.1.0 surface, available verbatim:
const { lib } = ffi.dlopen('/usr/lib/libSystem.B.dylib')
const abs = lib.symbol('abs')
// ...
```

On a smol binary built from Node 26.1.0+, `node:ffi` is available
behind `--experimental-ffi`. If the flag isn't set, `require('node:ffi')`
throws, and the forwarder degrades gracefully — it exports an object
with `__notAvailable__: true`:

```js
const ffi = require('node:smol-ffi/node')
if (ffi.__notAvailable__) {
  // Fall back to the canonical surface or surface a user-facing error
}
```

## API parity

Every export from `node:ffi` v26.1.0 is forwarded verbatim:

| node:ffi v26.1.0                 | node:smol-ffi/node      | Notes                                                                                                                          |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `DynamicLibrary`                 | `DynamicLibrary`        | Same reference (re-exported)                                                                                                   |
| `dlopen`                         | `dlopen`                | Same reference                                                                                                                 |
| `dlclose`                        | `dlclose`               | Same reference                                                                                                                 |
| `dlsym`                          | `dlsym`                 | Same reference                                                                                                                 |
| `exportArrayBuffer`              | `exportArrayBuffer`     |                                                                                                                                |
| `exportArrayBufferView`          | `exportArrayBufferView` |                                                                                                                                |
| `exportString`                   | `exportString`          |                                                                                                                                |
| `exportBuffer`                   | `exportBuffer`          |                                                                                                                                |
| `getInt*`/`getUint*`/`getFloat*` | same                    | Aliased exports                                                                                                                |
| `getRawPointer`                  | `getRawPointer`         |                                                                                                                                |
| `setInt*`/`setUint*`/`setFloat*` | same                    |                                                                                                                                |
| `suffix`                         | `suffix`                |                                                                                                                                |
| `toString`                       | `toString`              |                                                                                                                                |
| `toArrayBuffer`                  | `toArrayBuffer`         |                                                                                                                                |
| `toBuffer`                       | `toBuffer`              |                                                                                                                                |
| `types`                          | `types`                 | upstream's type enum (different from `node:smol-ffi.types` — node:smol-ffi uses short names like `i32`; upstream uses `int32`) |

## node:smol-ffi/bun — bun:ffi shim

This is a pure-JS adapter implementing the bun:ffi public surface
(<https://bun.sh/docs/api/ffi>) atop the canonical smol-ffi internals.

```js
const { dlopen, FFIType, CString } = require('node:smol-ffi/bun')

const lib = dlopen('/usr/lib/libSystem.B.dylib', {
  abs: { args: [FFIType.i32], returns: FFIType.i32 },
  strlen: { args: [FFIType.cstring], returns: FFIType.u64 },
})

console.log(lib.symbols.abs(-5)) // 5
lib.close()
```

## bun:ffi API parity

| bun:ffi              | node:smol-ffi/bun          | Status                                                                                      |
| -------------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| `dlopen(path, defs)` | `dlopen(path, defs)`       | Phase 1                                                                                     |
| `FFIType` enum       | `FFIType` (string-valued)  | Phase 1; values are smol-ffi canonical strings (`'i32'`) rather than bun's numeric ordinals |
| `CString`            | `CString`                  | Phase 1                                                                                     |
| `ptr(typedarray)`    | `ptr(typedarray)`          | Phase 1; alias for `bufferToPtr`                                                            |
| `toArrayBuffer`      | `toArrayBuffer`            | Phase 1; finalizer args ignored                                                             |
| `toBuffer`           | `toBuffer`                 | Phase 1; finalizer args ignored                                                             |
| `read.{i8..f64,ptr}` | `read.{i8..f64,ptr,batch}` | Phase 1; same reference as canonical `read`                                                 |
| `suffix`             | `suffix`                   | Phase 1                                                                                     |
| `JSCallback`         | `JSCallback`               | **Phase 2 deferred** — throws `FFIError(ENOTIMPL)`                                          |
| `CFunction`          | `CFunction`                | **Phase 2 deferred** — throws `FFIError(ENOTIMPL)`                                          |
| `linkSymbols`        | `linkSymbols`              | **Phase 2 deferred** — throws `FFIError(ENOTIMPL)`                                          |

## Phase 2 — callbacks and call-by-pointer

The deferred constructors require additional native plumbing:

- `JSCallback`: the native binding already exposes
  `registerCallback`/`unregisterCallback` (used by smol-ffi's
  `Library.registerCallback`). Phase 2 is mostly a JS-side surface
  adapter: wrap the existing registration API in bun's
  `{ args, returns, threadsafe? }` shape, expose `.ptr` + `.close()`.
  Smol-native defaults `threadsafe: true` (the architecture wins
  there make this the right default for our runtime).
- `CFunction({returns, args, ptr})`: requires a new "call by raw
  pointer" entry in `src/socketsecurity/ffi/binding.cc`. The current
  `sym()` path takes a `libId + name`; CFunction needs to skip the
  library lookup and bind a signature directly against a pointer the
  caller provides.
- `linkSymbols({...})`: trivial once `CFunction` lands — it's a batch
  iteration over `CFunction` calls.

Until Phase 2 lands, each deferred entry point throws an `FFIError`
with `code === 'ENOTIMPL'` so callers fail fast with a structured
error rather than `TypeError: x is not a constructor`. The error
message points back to this doc.

## Type-name aliases

bun:ffi uses several spelling variants for the same type. The shim
normalizes them all to a single canonical smol-ffi type string at
`dlopen` time:

| bun spelling                           | smol-ffi canonical                                          |
| -------------------------------------- | ----------------------------------------------------------- |
| `i32`, `int32_t`, `int`, `FFIType.i32` | `'i32'`                                                     |
| `u32`, `uint32_t`, `uint`              | `'u32'`                                                     |
| `i64`, `int64_t`, `i64_fast`           | `'i64'`                                                     |
| `u64`, `uint64_t`, `u64_fast`          | `'u64'`                                                     |
| `f32`, `float`                         | `'f32'`                                                     |
| `f64`, `double`                        | `'f64'`                                                     |
| `cstring`                              | `'string'`                                                  |
| `ptr`, `pointer`, `void*`, `char*`     | `'pointer'`                                                 |
| `function`, `fn`, `callback`           | `'pointer'`                                                 |
| `bool`                                 | `'bool'`                                                    |
| `char`                                 | `'i8'`                                                      |
| `buffer`                               | `'buffer'`                                                  |
| `napi_env`, `napi_value`               | `'pointer'` (placeholder — N-API integration not supported) |

### Known compat gap: `i64_fast` / `u64_fast`

bun's `i64_fast` / `u64_fast` types return a JS `Number` (potentially
lossy for values > 2^53), specifically as a perf escape hatch. smol-ffi
returns a `BigInt` for all 64-bit integer reads and provides a single
fast path that's faster than bun's slow path; we don't have a separate
"fast i64 → Number" mode. Lifting bun code over and using `i64_fast`
yields a `BigInt`, not a `Number`. Callers that need a Number have to
`Number(bigint)` explicitly (or migrate to `i32`/`u32` if the range
fits).

## Canonical wins — extensions in `node:smol-ffi`

Features available on `node:smol-ffi` that neither node:ffi nor bun:ffi
have:

1. **dlopen cache.** Repeated `open(samePath)` returns the same
   `Library` instance until `.close()` is called. Cuts redundant
   `dlopen` syscalls for libraries opened from multiple call sites.
2. **Structured `FFIError.code`.** Every failure path populates one of
   `EBADLIB` / `ENOSYM` / `EBADARGS` / `EBADTYPE` / `EBADPTR` /
   `ENOTIMPL`. Codes also exported as `FFI_ERROR_CODES`.
3. **`read.batch(ptr, types)`.** Reads a fixed-layout struct in one
   call. Auto-advances offset by type size. Example:
   `read.batch(ptr, ['i32', 'u8', 'f64'])` reads at offsets 0, 4, 5.
4. **`read.{i8..f64, ptr, batch}` namespace.** bun-style accessor
   group; aliases for `get*` plus the batch reader.
5. **`lib.list()`.** Returns the names of symbols previously resolved
   through that library. Useful for diagnostics + auto-doc.
6. **`dlopen.find(name)`.** Probes `lib{name}.{suffix}` and
   `{name}.{suffix}` and returns the first that exists. Cuts
   per-platform suffix scaffolding from caller code.
7. **Extended `types`.** Includes `ARRAY_BUFFER`, `FUNCTION`, `CHAR`
   matching the v26.1.0 names.
