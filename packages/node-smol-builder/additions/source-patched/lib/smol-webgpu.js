'use strict'

// node:smol-webgpu — WebGPU (W3C draft) for socket-built node. STUB.
//
// The C++ binding currently throws on every entry except isAvailable().
// Use `isAvailable()` to detect whether the underlying Dawn integration
// is wired before calling the rest of the API. This module is shipped
// now so userland code can write WebGPU code that resolves the import
// path even when running against a smol binary built before Dawn lands.
//
// Surface mirrors the W3C WebGPU IDL (https://www.w3.org/TR/webgpu/):
//
//   isAvailable() -> boolean
//     Synchronous detection. Returns false in the current stub;
//     returns true once Dawn is wired.
//
//   createInstance() -> WGPUInstance
//   requestAdapter(options?) -> Promise<GPUAdapter | null>
//   requestDevice(options?) -> Promise<GPUDevice>
//   getPreferredCanvasFormat() -> GPUTextureFormat
//
// All entries except isAvailable() throw a structured error pointing
// at the design doc. Wrap calls in a feature-detection check:
//
//   const webgpu = require('node:smol-webgpu')
//   if (!webgpu.isAvailable()) {
//     return fallback()
//   }
//   const adapter = await webgpu.requestAdapter()
//   const device = await adapter.requestDevice()
//
// Design rationale + Dawn integration path:
//   .claude/plans/opentui-smol-tui-completion.md (Phase C)
//
// Once Dawn ships, this module will gain the full GPUAdapter /
// GPUDevice / GPUCommandEncoder / GPURenderPassEncoder / etc. surface
// behind the same import. Code written against the stub today (with
// proper isAvailable() guards) will work unchanged.

const { ObjectFreeze } = primordials

const {
  createInstance,
  getPreferredCanvasFormat,
  isAvailable,
  requestAdapter,
  requestDevice,
} = internalBinding('smol_webgpu')

module.exports = ObjectFreeze({
  __proto__: null,
  createInstance,
  getPreferredCanvasFormat,
  isAvailable,
  requestAdapter,
  requestDevice,
})
