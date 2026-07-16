'use strict'

// Documentation: docs/additions/lib/smol-ffi-compat.md
//
// node:smol-ffi/node — drop-in compatibility shim for node:ffi v26.1.0.
//
// On the smol Node binary (built from Node 26.1.0+ source) `node:ffi`
// is available as an experimental builtin behind --experimental-ffi.
// This module re-exports the upstream surface verbatim so callers can
// `require('node:smol-ffi/node')` instead of `require('node:ffi')` and
// get the same API, then mix in smol-ffi extensions from
// `require('node:smol-ffi')` without re-resolving the loader chain.
//
// On runtimes that don't ship node:ffi (older Node, system Node when
// running tests in CI), require('node:ffi') throws MODULE_NOT_FOUND.
// We catch that and export a frozen sentinel object with
// __notAvailable__: true so callers can feature-detect without paying
// the cost of try/catch in their own code:
//
//   const ffiNode = require('node:smol-ffi/node')
//   if (ffiNode.__notAvailable__) {
//     // fall back to node:smol-ffi canonical surface
//   } else {
//     ffiNode.dlopen(...)
//   }

const { ObjectFreeze } = primordials

let nodeFfi
try {
  nodeFfi = require('node:ffi')
} catch {
  // node:ffi not built into this runtime — leave nodeFfi as undefined
  // and emit a sentinel below. We intentionally swallow the error
  // (rather than rethrow) so the require itself doesn't reject; the
  // caller decides whether absence is fatal via the __notAvailable__
  // sentinel.
  nodeFfi = undefined
}

module.exports =
  nodeFfi === undefined
    ? ObjectFreeze({ __proto__: null, __notAvailable__: true })
    : ObjectFreeze({ __proto__: null, ...nodeFfi, __notAvailable__: false })
