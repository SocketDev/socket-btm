# node:smol-path plan

## Goal

Native path normalize / relative / dirname / basename / extname /
isAbsolute / join, exposed as `node:smol-path`. Replaces JS-level
character-by-character iteration in socket-lib's hot path-handling
code with C++ that V8 can call via the Fast API for ASCII paths.

## Why this is worth doing

socket-lib's `src/paths/normalize.ts` is 1270 lines, called millions
of times during `socket scan`. The hot path is char-code-by-char
iteration with separator and drive-letter branches. JS profiles show
this is the #1 self-time function in the CLI. The shape — bounded
ASCII input, tight branch-dense loops, no I/O — is exactly what a
`FastOneByteString` Fast API entry accelerates.

**Rough estimate**: 5-10x on the hot loop. Measurable end-to-end in
`socket scan` because path normalization is on the per-file path.

## Surface

| Native                | JS equivalent       | Why hot                  |
| --------------------- | ------------------- | ------------------------ |
| `normalize(p)`        | `path.normalize`    | every file path          |
| `isAbsolute(p)`       | `path.isAbsolute`   | branch in normalize      |
| `dirname(p)`          | `path.dirname`      | parent-dir walks         |
| `basename(p)`         | `path.basename`     | display + cmp            |
| `extname(p)`          | `path.extname`      | extension routing        |
| `join(...parts)`      | `path.join`         | path composition         |
| `relative(from, to)`  | `path.relative`     | display in errors        |

Each entry has POSIX and Windows variants — registered as
`posix.normalize` / `win32.normalize` / etc., mirroring Node's own
`path` module.

## Why we don't replace the whole `path` module

Node's `path` is already C++ for the hot calls — but it's invoked
through a JS-level dispatch that goes through the `path` namespace
object lookup on every call. The win is twofold:

1. **`FastOneByteString` Fast API** gives TurboFan a direct inline
   entry point that takes a `(char*, length)` view of the input
   string. No HandleScope, no string materialization, no V8-side
   encoding dispatch.
2. **Specialized one-byte byte-walk** — Node's `path.normalize`
   handles UTF-16 paths as a side effect of the general case. The
   smol-path fast path skips that branch entirely for ASCII.

For two-byte (non-ASCII) paths, V8 routes to the slow path which is
just `path.<op>`-equivalent C++ — so two-byte callers see no change.

## C++ shape

Standard 4-patch shape:

- `039-smol-path-binding.patch` — `smol_path` binding registration.
  Source: `src/socketsecurity/path/path_binding.cc`.
- `040-smol-path-realm.patch` — schemelessBlockList entry.
- `041-smol-path-external-refs.patch` — external-references.
- `042-smol-path-node-gyp.patch` — `node.gyp` + public-shim
  `lib/smol-path.js`.

Each operation has a slow path (general string, UTF-16-aware) and a
fast path (`FastOneByteString` typed). The fast path's body is a
direct byte loop:

```cpp
// Fast path for normalize: ASCII byte walk.
static int32_t FastNormalize(Local<Value> recv,
                             const v8::FastOneByteString& s,
                             FastApiCallbackOptions& opts) {
  // ... single-pass byte loop, no allocations on the happy path ...
}
```

The result string is built in a stack buffer (up to 4KB — covers all
realistic paths) and only spills to heap for pathological inputs.
Returns `Local<String>` materialized once at the end.

## Parity is the hard part

The biggest risk is matching Node's `path.normalize` byte-for-byte
across:

- POSIX vs Windows separator semantics
- Drive letters (`C:\`, `c:\`, `c:`) — Windows only
- UNC paths (`\\?\`, `\\.\`, `\\server\share`)
- MSYS / Cygwin paths (`/c/foo` → `C:/foo`) — socket-cli already has
  this conversion in `paths/normalize.ts:msysDriveToNative`
- Trailing separator handling (`/foo/` → `/foo`)
- `..` and `.` segments
- Empty segments (`//foo` → `/foo`)

The mitigation is exhaustive parity testing against Node's `path`:
generate paths from a corpus, run both, assert byte-equal output.
~5000 cases minimum, drawn from socket-lib's own test fixtures plus
Node's `test/parallel/test-path-*.js` corpus.

## Test strategy

1. **Spec corpus** — adapt every input from Node's
   `test-path-normalize.js`, `test-path-relative.js`, etc.
2. **Cross-checked parity** — for ~5000 generated paths, assert
   `smol_path.normalize(p) === path.normalize(p)`.
3. **Fuzz** — random byte strings (only ASCII for fast path) for
   robustness; assert no crashes, no infinite loops, output never
   longer than input + a small constant.

## socket-lib wiring

`src/smol/path.ts` — lazy-loader + `SmolPathBinding` interface.
`src/paths/normalize.ts` — replace the 5 internal helpers
(`normalize`, `relative`, `isAbsolute`, `dirname`, `basename`,
`extname`) with `_smolPath?.X(...) ?? jsX(...)` shims. The 1270 lines
become a thin ~100-line wrapper file.

## Rollout

Phase 1: POSIX-only `normalize` + `isAbsolute` + `dirname` + `extname`.
Phase 2: Windows variants + UNC + MSYS conversion.
Phase 3: `relative` + `join` (slightly more complex string assembly).

Each phase ships independently; consumers see consistent behavior at
every step because the JS fallback is always in place.

## Risk

Path semantics are notoriously easy to get subtly wrong. The Cygwin /
MSYS bridge in particular has caused incidents in the past. Phase 1
ships behind a feature-detect AND a Boolean env var (`SOCKET_SMOL_PATH=0`
disables) so a regression can be hot-rolled-back without a redeploy.

## Estimated effort

Phase 1: ~400 lines of C++ + ~150 lines of TypeScript wiring +
~600 lines of parity tests. About a day of focused work.
Phase 2 + 3: similar or larger because of edge cases.
