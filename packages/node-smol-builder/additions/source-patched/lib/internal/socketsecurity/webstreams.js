'use strict';

// Socket Security Fast WebStreams - C++ Enhanced Implementation
//
// C++ fast paths for WebStreams while maintaining:
// 1. WPT (Web Platform Tests) compatibility
// 2. Full WHATWG Streams API compliance
// 3. Delegates to JS fast-webstreams for complex cases

// Lazy-load native binding — this module is loaded during V8 snapshot
// generation where the binding may not be fully initialized.
let _binding;
function _getBinding() {
  if (!_binding) {
    _binding = internalBinding('smol_webstreams');
  }
  return _binding;
}

// Chunk pool wrapper — lazy-initialized C++ { value, done } object pool.
const chunkPool = {
  __proto__: null,
  acquire() { return _getBinding().acquireChunk(); },
  release(chunk) { return _getBinding().releaseChunk(chunk); },
  setValue(chunk, value, done) { return _getBinding().setChunkValue(chunk, value, done); },
  stats() { return _getBinding().getChunkPoolStats(); },
};

// Lazy accessor for FastReadableStreamAccelerator constructor.
let _FastReadableStreamAccelerator;
function getFastReadableStreamAccelerator() {
  if (!_FastReadableStreamAccelerator) {
    _FastReadableStreamAccelerator = _getBinding().FastReadableStreamAccelerator;
  }
  return _FastReadableStreamAccelerator;
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
} = require('internal/deps/fast-webstreams/index');

module.exports = {
  chunkPool,
  get FastReadableStreamAccelerator() { return getFastReadableStreamAccelerator(); },
  FastReadableStream: JSFastReadableStream,
  FastReadableStreamBYOBReader: JSFastReadableStreamBYOBReader,
  FastReadableStreamDefaultReader: JSFastReadableStreamDefaultReader,
  FastTransformStream: JSFastTransformStream,
  FastWritableStream: JSFastWritableStream,
  FastWritableStreamDefaultWriter: JSFastWritableStreamDefaultWriter,
  patchGlobalWebStreams: jsPatchGlobalWebStreams,
};
