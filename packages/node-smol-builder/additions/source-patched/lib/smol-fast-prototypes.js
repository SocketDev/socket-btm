'use strict'

// node:smol-fast-prototypes — V8 Fast API typed implementations of
// hot primordial helpers (Math.*, Number.is*).
//
// The functions here are registered with V8's `CFunction` mechanism
// so TurboFan can **inline them directly into JIT-compiled JS**:
// no callback trampoline, no FunctionCallbackInfo allocation,
// no HandleScope. ~30-50% faster on hot benchmark loops than the
// equivalent uncurryThis-wrapped JS form.
//
// Surface (all primitive args, all primitive returns — required by
// V8's Fast API type constraints):
//
//   Math:
//     mathAbs(x)              -> double
//     mathCeil(x)             -> double
//     mathClz32(x)            -> int32
//     mathFloor(x)            -> double
//     mathImul(x, y)          -> int32
//     mathRound(x)            -> double  (JS half-toward-+∞ semantics)
//     mathSign(x)             -> double  (preserves +0/-0/NaN)
//     mathSqrt(x)             -> double
//     mathTrunc(x)            -> double
//
//   Number predicates:
//     numberIsFinite(x)       -> bool
//     numberIsInteger(x)      -> bool
//     numberIsNaN(x)          -> bool
//     numberIsSafeInteger(x)  -> bool
//
// Backed by a native binding (smol_fast_prototypes) implemented in
// src/socketsecurity/fast_prototypes/. See that source file for the
// architecture rationale + a forward-pointer to extending the
// surface (string predicates, array predicates).

const { ObjectFreeze } = primordials

const fp = require('internal/socketsecurity/fast-prototypes')

module.exports = ObjectFreeze({
  __proto__: null,
  ...fp,
})
