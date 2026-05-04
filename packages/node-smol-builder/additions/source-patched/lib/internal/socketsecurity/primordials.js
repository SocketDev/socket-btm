'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/primordials.js.md

const { ObjectFreeze } = primordials

// Backed by node:smol-primordials — V8 Fast API typed implementations
// of Math.* + Number.is*. TurboFan inlines these directly into JIT-
// compiled JS, no callback trampoline.
const binding = internalBinding('smol_primordials')

module.exports = ObjectFreeze({
  __proto__: null,
  // Math (unary, double → double)
  mathAbs: binding.mathAbs,
  mathAcos: binding.mathAcos,
  mathAcosh: binding.mathAcosh,
  mathAsin: binding.mathAsin,
  mathAsinh: binding.mathAsinh,
  mathAtan: binding.mathAtan,
  mathAtanh: binding.mathAtanh,
  mathCbrt: binding.mathCbrt,
  mathCeil: binding.mathCeil,
  mathCos: binding.mathCos,
  mathCosh: binding.mathCosh,
  mathExp: binding.mathExp,
  mathExpm1: binding.mathExpm1,
  mathFloor: binding.mathFloor,
  mathFround: binding.mathFround,
  mathLog: binding.mathLog,
  mathLog1p: binding.mathLog1p,
  mathLog2: binding.mathLog2,
  mathLog10: binding.mathLog10,
  mathRound: binding.mathRound,
  mathSign: binding.mathSign,
  mathSin: binding.mathSin,
  mathSinh: binding.mathSinh,
  mathSqrt: binding.mathSqrt,
  mathTan: binding.mathTan,
  mathTanh: binding.mathTanh,
  mathTrunc: binding.mathTrunc,
  // Math (binary)
  mathAtan2: binding.mathAtan2,
  mathHypot: binding.mathHypot,
  mathPow: binding.mathPow,
  // Math (other signatures)
  mathClz32: binding.mathClz32,
  mathImul: binding.mathImul,
  // Number predicates
  numberIsFinite: binding.numberIsFinite,
  numberIsInteger: binding.numberIsInteger,
  numberIsNaN: binding.numberIsNaN,
  numberIsSafeInteger: binding.numberIsSafeInteger,
})
