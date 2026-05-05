# smol-primordial.js -- Public API for V8 Fast API typed primordials (node:smol-primordial)

## What This File Does

This is the entry point for `require('node:smol-primordial')`. It
re-exports a curated set of C++-backed `v8::CFunction` entries that
TurboFan can **inline directly into JIT-compiled JS callers** -- no
callback trampoline, no FunctionCallbackInfo allocation, no
HandleScope. ~30-50% faster than equivalent uncurryThis-wrapped JS
forms on hot benchmark loops.

## How It Fits Together

```
require('node:smol-primordial') -> this file (smol-primordial.js)
  -> require('internal/socketsecurity/primordial') (frozen barrel)
    -> internalBinding('smol_primordial') (C++ Fast API binding)
```

The native binding lives at
`additions/source-patched/src/socketsecurity/primordial/primordial_binding.cc`.
It registers each entry via `SetFastMethodNoSideEffect` with paired
slow + fast paths -- the slow path is a normal
`FunctionCallbackInfo<Value>` callback, the fast path is a typed
`(double) -> double` (or similar) function that V8 inlines into the
JIT'd caller when arg types are monomorphic.

## Public API

All entries (alphabetized):

```ts
// Array
arrayIsArray(v: unknown): v is unknown[]

// Date
dateNow(): number

// Math (unary, double -> double)
mathAbs   mathAcos   mathAcosh   mathAsin    mathAsinh
mathAtan  mathAtanh  mathCbrt    mathCeil    mathCos
mathCosh  mathExp    mathExpm1   mathFloor   mathFround
mathLog   mathLog1p  mathLog2    mathLog10   mathRound
mathSign  mathSin    mathSinh    mathSqrt    mathTan
mathTanh  mathTrunc

// Math (binary, double × double -> double)
mathAtan2(a: number, b: number): number
mathHypot(a: number, b: number): number
mathPow(a: number, b: number): number

// Math (other signatures)
mathClz32(v: number): number       // uint32 -> int32
mathImul(a: number, b: number): number  // int32 × int32 -> int32

// Number predicates (double -> bool)
numberIsFinite       numberIsInteger
numberIsNaN          numberIsSafeInteger

// Number static parsers (FastOneByteString fast path; falls back to
// V8's slow path for two-byte / non-ASCII strings)
numberParseFloat(s: string): number
numberParseInt10(s: string): number  // radix 10 only

// String prototype (FastOneByteString fast path; -1 sentinel for OOB
// indices, callers must convert to NaN to match
// String.prototype.charCodeAt spec)
stringCharCodeAt(s: string, i: number): number
```

## Design Choices

### Why these particular methods?

V8's Fast API has a hard constraint: arg + return types are limited
to primitives, `Local<Value/Object/Array>`, or the special
`FastOneByteString` (a `(char*, length)` view of an ASCII-only V8
string). It cannot return a new object.

Beyond that, the *interesting* design question is **which signatures
actually beat the JS form**:

- **WIN**: The work itself benefits from inlining (Math.abs is one
  instruction; eliminating the call frame halves the cost). Typed
  parsers like `numberParseInt10` skip V8's encoding-dispatch step
  for ASCII numeric strings.

- **LOSS**: Methods where V8's own builtin is already TurboFan-inlined
  as an IC stub (Map.has, Set.has, Array.includes,
  String.startsWith/endsWith/includes/indexOf). Adding a Fast API
  binding would be a wash or small regression. These stay on the
  smol-util `uncurryThis` tier, which kills the BoundFunction adapter
  overhead -- the actual bottleneck for those.

### Spec semantics

- `Math.round` uses JS half-toward-+inf (NOT C's away-from-zero)
- `Math.sign` preserves +0/-0/NaN
- `Math.imul` casts through unsigned for defined wrap
- `Math.clz32` returns 32 for input 0 (C's __builtin_clz is UB at 0)
- `Math.fround` rounds to nearest float32 representation
- `Number.parseInt` is radix 10 only -- other radices fall through to
  stock Number.parseInt
- `String.prototype.charCodeAt` returns -1 sentinel on OOB; the JS
  wrapper in socket-lib's primordials.ts converts -1 back to NaN

## Where the Real Work Happens

The native binding's doc comment lays out the two-rule framework
(work itself benefits from inlining, V8's own builtin must NOT be
optimal) and walks through every macro. New entries should explain
both rules in their section -- the binding is intentionally
conservative about what gets added.
