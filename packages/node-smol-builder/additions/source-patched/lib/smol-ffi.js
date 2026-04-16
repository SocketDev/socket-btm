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
} = require('internal/socketsecurity/ffi')

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
  default: open,
})
