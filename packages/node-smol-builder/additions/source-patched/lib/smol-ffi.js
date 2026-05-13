'use strict'

// Documentation: docs/additions/lib/smol-ffi.js.md

const { ObjectFreeze } = primordials

const {
  open,
  dlopen,
  ptrToBuffer,
  bufferToPtr,
  ptrToString,
  ptrToArrayBuffer,
  Library,
  FFIError,
  FFI_ERROR_CODES,
  suffix,
  types,
  getInt8,
  getUint8,
  getInt16,
  getUint16,
  getInt32,
  getUint32,
  getInt64,
  getUint64,
  getFloat32,
  getFloat64,
  setInt8,
  setUint8,
  setInt16,
  setUint16,
  setInt32,
  setUint32,
  setInt64,
  setUint64,
  setFloat32,
  setFloat64,
  read,
  readBatch,
  readPtr,
} = require('internal/socketsecurity/ffi')

// Library-free FFI surface (JSCallback, CFunction, linkSymbols) lives
// in a sibling internal module so the main ffi.js stays under the
// 1000-line hard cap. Promoting these to the canonical surface (not
// just bun-compat) is intentional — JSCallback wraps the same native
// registerCallback the Library.registerCallback method uses, and
// CFunction / linkSymbols are general primitives, not bun-specific.
const {
  boundedToNumber,
  CFunction,
  JSCallback,
  linkSymbols,
} = require('internal/socketsecurity/ffi-callable')

// HISTORY: WHY FREEZE MODULE EXPORTS
// Node.js freezes some internal export objects to prevent prototype mutation
// attacks. If a shared module's exports object is mutable, any consumer can
// modify it, and later consumers see the tampered version. This was addressed
// in PR #44007 / Node.js v18.8.0 ("module: protect against prototype
// mutation"). Freezing + null prototype ensures the export surface is
// immutable and has no inherited properties to exploit.
module.exports = ObjectFreeze({
  __proto__: null,
  open,
  dlopen,
  ptrToBuffer,
  bufferToPtr,
  ptrToString,
  ptrToArrayBuffer,
  Library,
  FFIError,
  // Structured error codes surfaced on FFIError.code. Branchable
  // alternative to message-string matching for callers that need to
  // recover from specific failure modes (missing library vs missing
  // symbol vs invalid type, etc).
  FFI_ERROR_CODES,
  suffix,
  types,
  getInt8,
  getUint8,
  getInt16,
  getUint16,
  getInt32,
  getUint32,
  getInt64,
  getUint64,
  getFloat32,
  getFloat64,
  setInt8,
  setUint8,
  setInt16,
  setUint16,
  setInt32,
  setUint32,
  setInt64,
  setUint64,
  setFloat32,
  setFloat64,
  // bun-style read namespace: read.i32(ptr), read.batch(ptr, types), etc.
  // Aliases for the get* accessors; advance-aware batch read on top.
  read,
  readBatch,
  readPtr,
  // Library-free FFI surface from internal/socketsecurity/ffi-callable.
  // JSCallback wraps the native registerCallback for callbacks that
  // don't belong to a Library. CFunction wraps registerFunction for
  // call-by-raw-pointer (e.g. function pointers handed in from native
  // code or from another callback). linkSymbols batches CFunction.
  // boundedToNumber is the BigInt -> Number downcast for bun's
  // i64_fast / u64_fast types.
  CFunction,
  JSCallback,
  boundedToNumber,
  linkSymbols,
  default: open,
})
