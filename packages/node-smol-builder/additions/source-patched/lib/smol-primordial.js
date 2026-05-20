'use strict'

// node:smol-primordial — V8 Fast API typed implementations of hot
// primordial helpers.
//
// The functions here are registered with V8's `CFunction` mechanism
// so TurboFan can **inline them directly into JIT-compiled JS**:
// no callback trampoline, no FunctionCallbackInfo allocation,
// no HandleScope. ~30-50% faster on hot benchmark loops than the
// equivalent uncurryThis-wrapped JS form.
//
// Surface (constraint: V8 Fast API arg/return types must be
// primitives, Local<Value/Object/Array>, or FastOneByteString):
//
//   Math (unary):  mathAbs, mathAcos, mathAcosh, mathAsin, mathAsinh,
//                  mathAtan, mathAtanh, mathCbrt, mathCeil, mathCos,
//                  mathCosh, mathExp, mathExpm1, mathFloor, mathFround,
//                  mathLog, mathLog1p, mathLog2, mathLog10, mathRound,
//                  mathSign, mathSin, mathSinh, mathSqrt, mathTan,
//                  mathTanh, mathTrunc
//   Math (binary): mathAtan2, mathHypot (2-arg), mathPow
//   Math (other):  mathClz32 (uint32 -> int32),
//                  mathImul (int32×int32 -> int32)
//   Number preds:  numberIsFinite, numberIsInteger, numberIsNaN,
//                  numberIsSafeInteger
//   Number parse:  numberParseFloat, numberParseInt10
//                  (radix-10 only; ASCII-only fast path via
//                  FastOneByteString — falls back to V8's parser
//                  for two-byte strings)
//   Array static:  arrayIsArray
//   Date static:   dateNow
//   String proto:  stringCharCodeAt (ASCII-only fast path; OOB
//                  returns -1 sentinel — consumers must convert to
//                  NaN to match spec),
//                  stringIsWellFormed (ASCII fast path always returns
//                  true — surrogate range is unreachable in Latin-1
//                  storage; UTF-16 strings hit the slow path scan)
//
// Math.round uses JS half-toward-+∞ semantics (NOT C's away-from-zero).
// Math.sign preserves +0/-0/NaN. Math.imul casts through unsigned for
// defined wrap. Math.clz32 returns 32 for input 0 (C's __builtin_clz
// is UB at 0). Math.fround rounds to the nearest float32 representation.
//
// Backed by a native binding (smol_primordial) implemented in
// src/socketsecurity/primordial/primordial_binding.cc — see that
// file for the design rationale (which methods are real Fast API
// wins vs. which are not).

const { ObjectFreeze } = primordials

const fp = require('internal/socketsecurity/primordial')

module.exports = ObjectFreeze({
  __proto__: null,
  ...fp,
})
