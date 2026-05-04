'use strict'

// node:smol-primordials — V8 Fast API typed implementations of hot
// primordial helpers (Math.*, Number.is*).
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
//   Math (unary):  mathAbs, mathAcos, mathAcosh, mathAsin, mathAsinh,
//                  mathAtan, mathAtanh, mathCbrt, mathCeil, mathCos,
//                  mathCosh, mathExp, mathExpm1, mathFloor, mathFround,
//                  mathLog, mathLog1p, mathLog2, mathLog10, mathRound,
//                  mathSign, mathSin, mathSinh, mathSqrt, mathTan,
//                  mathTanh, mathTrunc
//   Math (binary): mathAtan2, mathHypot (2-arg), mathPow
//   Math (other):  mathClz32 (uint32 -> int32), mathImul (int32×int32 -> int32)
//   Number:        numberIsFinite, numberIsInteger, numberIsNaN,
//                  numberIsSafeInteger
//
// Math.round uses JS half-toward-+∞ semantics (NOT C's away-from-zero).
// Math.sign preserves +0/-0/NaN. Math.imul casts through unsigned for
// defined wrap. Math.clz32 returns 32 for input 0 (C's __builtin_clz
// is UB at 0). Math.fround rounds to the nearest float32 representation.
//
// Backed by a native binding (smol_primordials) implemented in
// src/socketsecurity/primordials/. See that source file for the
// architecture rationale + a forward-pointer to extending the
// surface (string predicates, array predicates).

const { ObjectFreeze } = primordials

const fp = require('internal/socketsecurity/primordials')

module.exports = ObjectFreeze({
  __proto__: null,
  ...fp,
})
