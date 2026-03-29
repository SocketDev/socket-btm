'use strict';

// node:smol-ffi - Cross-platform Foreign Function Interface
// Call native C functions from JavaScript without compiling addons.
//
// Usage:
//   import ffi from 'node:smol-ffi';
//
//   const lib = ffi.open('libm.so.6');
//   const sqrt = lib.func('sqrt', 'f64', ['f64']);
//   console.log(sqrt(16)); // 4
//   lib.close();

const {
  ObjectFreeze,
} = primordials;

const {
  open,
  ptrToBuffer,
  bufferToPtr,
  Library,
  FFIError,
} = require('internal/socketsecurity/ffi');

module.exports = ObjectFreeze({
  __proto__: null,
  open,
  ptrToBuffer,
  bufferToPtr,
  Library,
  FFIError,
  default: open,
});
