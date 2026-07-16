'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/webstreams.js.md

let _binding
function _getBinding() {
  if (!_binding) {
    _binding = internalBinding('smol_webstreams')
  }
  return _binding
}

// Chunk pool wrapper — lazy-initialized C++ { value, done } object pool.
const chunkPool = {
  __proto__: null,
  acquire() {
    return _getBinding().acquireChunk()
  },
  release(chunk) {
    return _getBinding().releaseChunk(chunk)
  },
  setValue(chunk, value, done) {
    return _getBinding().setChunkValue(chunk, value, done)
  },
  stats() {
    return _getBinding().getChunkPoolStats()
  },
}

// Lazy accessor for FastReadableStreamAccelerator constructor.
let _FastReadableStreamAccelerator
function getFastReadableStreamAccelerator() {
  if (!_FastReadableStreamAccelerator) {
    _FastReadableStreamAccelerator = _getBinding().FastReadableStreamAccelerator
  }
  return _FastReadableStreamAccelerator
}

// Load JS fast-webstreams (provides base implementation).
const {
  FastReadableStream: JSFastReadableStream,
  FastReadableStreamBYOBReader: JSFastReadableStreamBYOBReader,
  FastReadableStreamDefaultReader: JSFastReadableStreamDefaultReader,
  FastTransformStream: JSFastTransformStream,
  FastWritableStream: JSFastWritableStream,
  FastWritableStreamDefaultWriter: JSFastWritableStreamDefaultWriter,
  patchGlobalWebStreams: jsPatchGlobalWebStreams,
} = require('internal/deps/fast-webstreams/index')

module.exports = {
  __proto__: null,
  chunkPool,
  get FastReadableStreamAccelerator() {
    return getFastReadableStreamAccelerator()
  },
  FastReadableStream: JSFastReadableStream,
  FastReadableStreamBYOBReader: JSFastReadableStreamBYOBReader,
  FastReadableStreamDefaultReader: JSFastReadableStreamDefaultReader,
  FastTransformStream: JSFastTransformStream,
  FastWritableStream: JSFastWritableStream,
  FastWritableStreamDefaultWriter: JSFastWritableStreamDefaultWriter,
  patchGlobalWebStreams: jsPatchGlobalWebStreams,
}
