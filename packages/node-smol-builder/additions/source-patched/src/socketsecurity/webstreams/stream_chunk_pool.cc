#include "socketsecurity/webstreams/stream_chunk_pool.h"
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

  // Reuse from pool if available.
  if (!pool_.empty()) {
    v8::Global<Object> global_chunk = std::move(pool_.back());
    pool_.pop_back();
    return global_chunk.Get(isolate);
  }

  // Pool empty: create new plain object.
  // WPT Compatibility: Must be plain object, not C++ wrapper.
  Local<Object> chunk = Object::New(isolate);

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

  // Don't grow pool beyond max size.
  if (pool_.size() >= kMaxPoolSize) {
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
