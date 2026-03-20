'use strict';

// Socket Security Fast WebStreams - C++ Enhanced Implementation
//
// C++ fast paths for WebStreams while maintaining:
// 1. WPT (Web Platform Tests) compatibility
// 2. Full WHATWG Streams API compliance
// 3. Delegates to JS fast-webstreams for complex cases

// Load native binding (always available in our build).
const nativeBinding = internalBinding('smol_webstreams');

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

// Export chunk pool utilities (C++).
const chunkPool = {
  acquire: nativeBinding.acquireChunk,
  getStats: nativeBinding.getChunkPoolStats,
  release: nativeBinding.releaseChunk,
  setValue: nativeBinding.setChunkValue,
};

module.exports = {
  FastReadableStream: JSFastReadableStream,
  FastReadableStreamBYOBReader: JSFastReadableStreamBYOBReader,
  FastReadableStreamDefaultReader: JSFastReadableStreamDefaultReader,
  FastTransformStream: JSFastTransformStream,
  FastWritableStream: JSFastWritableStream,
  FastWritableStreamDefaultWriter: JSFastWritableStreamDefaultWriter,
  chunkPool,
  patchGlobalWebStreams: jsPatchGlobalWebStreams,
};
