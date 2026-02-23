/**
 * Socket Security: Fast WebStreams Polyfill
 *
 * Patches global ReadableStream, WritableStream, and TransformStream with
 * fast alternatives that back WHATWG streams with Node.js streams internally.
 *
 * WHY THIS EXISTS:
 * - Native WHATWG WebStreams use JS promise chains (~2 promises per chunk per hop)
 * - Vercel's fast-webstreams backs them with Node.js streams for ~10x faster throughput
 * - Enables pipeline() instead of promise chains for stream processing
 * - Critical for SSR performance (e.g., Next.js renderToReadableStream)
 *
 * WHAT IT PATCHES:
 * - globalThis.ReadableStream → FastReadableStream (or native wrapper for byte streams)
 * - globalThis.WritableStream → FastWritableStream
 * - globalThis.TransformStream → FastTransformStream
 * - globalThis.ReadableStreamDefaultReader → FastReadableStreamDefaultReader
 * - globalThis.WritableStreamDefaultWriter → FastWritableStreamDefaultWriter
 * - globalThis.ReadableStreamBYOBReader → FastReadableStreamBYOBReader
 * - Response.prototype.body → Returns FastReadableStream wrapper
 * - NativeReadableStream.prototype.pipeThrough/pipeTo → Fast path for Fast targets
 * - Symbol.hasInstance on native constructors → Accepts Fast instances
 *
 * WHEN IT ACTIVATES:
 * - Import this file early in bootstrap, after WebStreams are available
 * - Call patchGlobalWebStreams() to replace global constructors
 *
 * LIMITATIONS:
 * - Byte streams with pull callbacks delegate to native (undici/fetch WebIDL checks)
 * - May have circular dependency warnings (non-blocking, functional)
 * - Requires CommonJS conversion (original is ES modules)
 *
 * @see https://vercel.com/blog/we-ralph-wiggumed-webstreams-to-make-them-10x-faster
 */

'use strict'

const {
  FastReadableStream,
  FastReadableStreamBYOBReader,
  FastReadableStreamDefaultReader,
  FastTransformStream,
  FastWritableStream,
  FastWritableStreamDefaultWriter,
  patchGlobalWebStreams,
} = require('internal/deps/fast-webstreams/index')

// Patch global web streams with fast alternatives.
patchGlobalWebStreams()

// Fix .constructor checks: WPT tests do `rs.constructor === ReadableStream`.
// FastReadableStream.prototype.constructor points to FastReadableStream, not the global.
// After patching, make .constructor point to the patched global so tests pass.
FastReadableStream.prototype.constructor = globalThis.ReadableStream
FastWritableStream.prototype.constructor = globalThis.WritableStream
FastTransformStream.prototype.constructor = globalThis.TransformStream

// Also patch reader/writer constructors so direct construction works with FastReadableStream.
// Native ReadableStreamDefaultReader uses C++ internal slot checks that reject FastReadableStream.
globalThis.ReadableStreamDefaultReader = FastReadableStreamDefaultReader
globalThis.WritableStreamDefaultWriter = FastWritableStreamDefaultWriter
globalThis.ReadableStreamBYOBReader = FastReadableStreamBYOBReader
