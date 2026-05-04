'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/fast-prototypes.js.md

const { ObjectFreeze } = primordials

// Backed by node:smol-fast-prototypes — V8 Fast API typed
// implementations of Math.* + Number.is*. TurboFan inlines these
// directly into JIT-compiled JS, no callback trampoline.
const binding = internalBinding('smol_fast_prototypes')

module.exports = ObjectFreeze({
  __proto__: null,
  // Math
  mathAbs: binding.mathAbs,
  mathCeil: binding.mathCeil,
  mathClz32: binding.mathClz32,
  mathFloor: binding.mathFloor,
  mathImul: binding.mathImul,
  mathRound: binding.mathRound,
  mathSign: binding.mathSign,
  mathSqrt: binding.mathSqrt,
  mathTrunc: binding.mathTrunc,
  // Number predicates
  numberIsFinite: binding.numberIsFinite,
  numberIsInteger: binding.numberIsInteger,
  numberIsNaN: binding.numberIsNaN,
  numberIsSafeInteger: binding.numberIsSafeInteger,
})
