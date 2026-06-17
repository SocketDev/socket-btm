'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/primordial.js.md

const { ObjectFreeze } = primordials

// Backed by node:smol-primordial — V8 Fast API typed implementations
// of Math.* + Number.is*. TurboFan inlines these directly into JIT-
// compiled JS, no callback trampoline.
const binding = internalBinding('smol_primordial')

// Intl constructor captures — hoisted here (not in Node's own
// primordials object) so consumers get tamper-proof references.
const IntlCollator = Intl.Collator
const IntlListFormat = Intl.ListFormat
const IntlPluralRules = Intl.PluralRules
const IntlSegmenter = Intl.Segmenter

module.exports = ObjectFreeze({
  __proto__: null,
  arrayIsArray: binding.arrayIsArray,
  dateNow: binding.dateNow,
  mathAbs: binding.mathAbs,
  mathAcos: binding.mathAcos,
  mathAcosh: binding.mathAcosh,
  mathAsin: binding.mathAsin,
  mathAsinh: binding.mathAsinh,
  mathAtan: binding.mathAtan,
  mathAtan2: binding.mathAtan2,
  mathAtanh: binding.mathAtanh,
  mathCbrt: binding.mathCbrt,
  mathCeil: binding.mathCeil,
  mathClz32: binding.mathClz32,
  mathCos: binding.mathCos,
  mathCosh: binding.mathCosh,
  mathExp: binding.mathExp,
  mathExpm1: binding.mathExpm1,
  mathFloor: binding.mathFloor,
  mathFround: binding.mathFround,
  mathHypot: binding.mathHypot,
  mathImul: binding.mathImul,
  mathLog: binding.mathLog,
  mathLog1p: binding.mathLog1p,
  mathLog2: binding.mathLog2,
  mathLog10: binding.mathLog10,
  mathPow: binding.mathPow,
  mathRound: binding.mathRound,
  mathSign: binding.mathSign,
  mathSin: binding.mathSin,
  mathSinh: binding.mathSinh,
  mathSqrt: binding.mathSqrt,
  mathTan: binding.mathTan,
  mathTanh: binding.mathTanh,
  mathTrunc: binding.mathTrunc,
  numberIsFinite: binding.numberIsFinite,
  numberIsInteger: binding.numberIsInteger,
  numberIsNaN: binding.numberIsNaN,
  numberIsSafeInteger: binding.numberIsSafeInteger,
  numberParseFloat: binding.numberParseFloat,
  numberParseInt10: binding.numberParseInt10,
  // Returns -1 sentinel for OOB; consumers (e.g. socket-lib's
  // primordials.ts) wrap this and convert -1 back to NaN to match
  // String.prototype.charCodeAt spec.
  stringCharCodeAt: binding.stringCharCodeAt,
  IntlCollator,
  IntlListFormat,
  IntlPluralRules,
  IntlSegmenter,
})
