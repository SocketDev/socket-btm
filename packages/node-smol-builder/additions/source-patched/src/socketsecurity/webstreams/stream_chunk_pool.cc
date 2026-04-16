// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// ============================================================================
// stream_chunk_pool.cc -- WebStreams chunk object pool implementation
// ============================================================================
//
// WHAT THIS FILE DOES
//   Implements the StreamChunkPool -- a simple object pool that recycles
//   plain JS { value, done } objects used by ReadableStream readers.
//
//   AcquireChunk():
//     - If the pool has a recycled chunk, pop it and return it.
//     - Otherwise, create a new plain JS object with properties
//       `value` (initially undefined) and `done` (initially false).
//
//   ReleaseChunk(chunk):
//     - Reset the chunk's properties to { value: undefined, done: false }.
//     - Push it back into the pool (up to 256 objects max).
//
//   SetChunkValue(chunk, value, done):
//     - Set the chunk's `value` and `done` properties.  This is a static
//       helper called by the accelerator and the JS binding.
//
// WHY IT EXISTS (C++ instead of pure JS)
//   Creating a new { value, done } object for every stream read causes
//   garbage-collection pressure in high-throughput scenarios (e.g.
//   reading a large file chunk-by-chunk).  This pool keeps up to 256
//   objects in a free list, avoiding repeated allocation/deallocation.
//   The pool itself is in C++ because the FastReadableStreamAccelerator
//   (also C++) needs to acquire chunks during ReadSync().
//
// HOW JAVASCRIPT USES THIS
//   Through `internalBinding('smol_webstreams')`:
//     binding.acquireChunk()              => returns a { value, done } obj
//     binding.setChunkValue(chunk, v, d)  => sets chunk.value and chunk.done
//     binding.releaseChunk(chunk)         => returns the chunk to the pool
//     binding.getChunkPoolStats()         => { poolSize: number }
//
// KEY C++ CONCEPTS
//   FIXED_ONE_BYTE_STRING(isolate, "value")
//     -- Creates a V8 string from a compile-time constant.  Faster than
//        String::NewFromUtf8 because the length is known at compile time.
//
//   Global<Object>
//     -- A persistent handle that prevents garbage collection of the
//        pooled chunk objects while they sit in the pool vector.
// ============================================================================

#include "socketsecurity/webstreams/stream_chunk_pool.h"
#include "socketsecurity/simd/simd.h"  // SMOL_LIKELY / SMOL_UNLIKELY
#include "env-inl.h"
#include "node_internals.h"
#include "util-inl.h"

namespace node {
namespace socketsecurity {
namespace webstreams {

using v8::Boolean;
using v8::Context;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Object;
using v8::String;
using v8::Value;

StreamChunkPool::StreamChunkPool(Environment* env) : env_(env) {}

StreamChunkPool::~StreamChunkPool() {
  Clear();
}

Local<Object> StreamChunkPool::AcquireChunk() {
  Isolate* isolate = env_->isolate();
  HandleScope scope(isolate);

  acquired_++;

  // Reuse from pool if available (the overwhelmingly common case).
  if (SMOL_LIKELY(!pool_.empty())) {
    v8::Global<Object> global_chunk = std::move(pool_.back());
    pool_.pop_back();
    return global_chunk.Get(isolate);
  }

  // Pool empty: create new plain object.
  // WPT Compatibility: Must be plain object, not C++ wrapper.
  Local<Object> chunk = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  // Initialize with { value: undefined, done: false }.
  Local<Context> context = env_->context();
  chunk->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "value"),
    v8::Undefined(isolate)).Check();
  chunk->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "done"),
    Boolean::New(isolate, false)).Check();

  return chunk;
}

void StreamChunkPool::ReleaseChunk(Local<Object> chunk) {
  Isolate* isolate = env_->isolate();
  HandleScope scope(isolate);

  released_++;

  // Don't grow pool beyond max size (rare: only under spike load).
  if (SMOL_UNLIKELY(pool_.size() >= kMaxPoolSize)) {
    return;
  }

  // Reset to undefined and return to pool.
  Local<Context> context = env_->context();
  chunk->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "value"),
    v8::Undefined(isolate)).Check();
  chunk->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "done"),
    Boolean::New(isolate, false)).Check();

  pool_.emplace_back(isolate, chunk);
}

void StreamChunkPool::SetChunkValue(
    Environment* env,
    Local<Object> chunk,
    Local<Value> value,
    bool done) {
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();

  // Set { value, done } properties.
  // WPT Compatibility: Standard property names and types.
  chunk->Set(context, FIXED_ONE_BYTE_STRING(isolate, "value"), value).Check();
  chunk->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "done"),
    Boolean::New(isolate, done)).Check();
}

void StreamChunkPool::Clear() {
  pool_.clear();
  acquired_ = 0;
  released_ = 0;
}

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node

#pragma GCC diagnostic pop
