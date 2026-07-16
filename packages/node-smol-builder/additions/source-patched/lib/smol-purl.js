'use strict'

// Documentation: docs/additions/lib/smol-purl.js.md

const { ObjectFreeze } = primordials

const {
  parse,
  tryParse,
  parseBatch,
  build,
  isValid,
  normalize,
  equals,
  cacheStats,
  clearCache,
  types,
  PurlError,
} = require('internal/socketsecurity/purl')

module.exports = ObjectFreeze({
  __proto__: null,
  parse,
  tryParse,
  parseBatch,
  build,
  isValid,
  normalize,
  equals,
  cacheStats,
  clearCache,
  types,
  PurlError,
  default: ObjectFreeze({
    __proto__: null,
    parse,
    tryParse,
    parseBatch,
    build,
    isValid,
    normalize,
    equals,
    cacheStats,
    clearCache,
    types,
  }),
})
