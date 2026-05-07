// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// ============================================================================
// fast_readable_stream.cc -- ReadableStream C++ accelerator implementation
// ============================================================================
//
// WHAT THIS FILE DOES
//   Implements the FastReadableStreamAccelerator methods:
//     New()      -- constructor, called when JS does `new (std::nothrow) Accelerator()`
//     Enqueue()  -- pushes a JS value into the C++ buffer
//     ReadSync() -- pops a value from the buffer (fast path), or returns
//                   undefined if the buffer is empty (signals JS to do an
//                   async read)
//     Close()    -- marks the stream as ended
//     HasData()  -- returns true if the buffer has data ready
//
// WHY IT EXISTS (C++ instead of pure JS)
//   In a pure-JS ReadableStream, every read() creates a Promise, which
//   involves microtask scheduling even when data is already available.
//   This accelerator provides a synchronous fast path: if data is
//   buffered, ReadSync() returns it immediately as a pooled chunk object.
//   Only when the buffer is empty does the JS layer fall back to the
//   normal async Promise-based read.
//
// HOW JAVASCRIPT USES THIS
//   The JS FastReadableStream (in fast-webstreams) creates an accelerator
//   and calls:
//     accelerator.enqueue(chunk)  -- from the underlying source's push
//     const result = accelerator.readSync()  -- from the reader
//     if (result === undefined) { /* do async read */ }
//
// KEY V8/C++ CONCEPTS
//   ASSIGN_OR_RETURN_UNWRAP(&self, args.This())
//     -- Extracts the C++ FastReadableStreamAccelerator* from the JS
//        `this` object.  Every C++ class exposed to JS stores a pointer
//        in an "internal field" on the JS wrapper object.
//
//   v8::Global<Value>
//     -- A persistent reference to a V8 value.  Unlike Local<> handles,
//        Globals survive across function calls and HandleScopes.  Used
//        here to keep buffered chunks alive until they are read.
//
//   std::queue<v8::Global<Value>> buffer_
//     -- A FIFO queue.  Enqueue() pushes to the back, ReadSync() pops
//        from the front.
// ============================================================================

#include "socketsecurity/webstreams/fast_readable_stream.h"
#include "socketsecurity/simd/simd.h"  // SMOL_LIKELY / SMOL_UNLIKELY
#include "env-inl.h"
#include "node_internals.h"
#include "util-inl.h"

namespace node {
namespace socketsecurity {
namespace webstreams {

using v8::Boolean;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Undefined;
using v8::Value;

// Global chunk pool reference.
extern StreamChunkPool* GetChunkPool(Environment* env);

FastReadableStreamAccelerator::FastReadableStreamAccelerator(
    Environment* env,
    Local<Object> object)
  : AsyncWrap(env, object, AsyncWrap::PROVIDER_STREAMPIPE),
    chunk_pool_(GetChunkPool(env)) {}

FastReadableStreamAccelerator::~FastReadableStreamAccelerator() {
  // Clear buffered chunks.
  while (!buffer_.empty()) {
    buffer_.pop();
  }
}

void FastReadableStreamAccelerator::New(
    const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (!args.IsConstructCall()) {
    return;
  }

  v8::Isolate* isolate = env->isolate();

  // Touch the chunk pool BEFORE allocating the accelerator so we fail fast
  // and never construct an instance whose chunk_pool_ member is nullptr.
  // GetChunkPool returns nullptr on OOM (thread_local + nothrow in
  // webstreams_binding.cc); the constructor initializer list would
  // otherwise store that nullptr unchecked and later ReadSync would
  // dereference it.
  if (GetChunkPool(env) == nullptr) {
    isolate->ThrowException(v8::Exception::Error(
        v8::String::NewFromUtf8Literal(isolate,
            "Out of memory: failed to allocate StreamChunkPool")));
    return;
  }

  // nothrow + null-check: on OOM, surface a JS Error instead of leaving
  // the caller with a zombie JS object whose native wrapper was never
  // attached (every later method would silently return via
  // ASSIGN_OR_RETURN_UNWRAP).
  auto* accel = new (std::nothrow)
      FastReadableStreamAccelerator(env, args.This());
  if (accel == nullptr) {
    isolate->ThrowException(v8::Exception::Error(
        v8::String::NewFromUtf8Literal(isolate,
            "Out of memory: failed to allocate FastReadableStreamAccelerator")));
    return;
  }
}

void FastReadableStreamAccelerator::ReadSync(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.This());

  Environment* env = self->env();
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  // Defensive: New() already rejects construction when the pool is null,
  // so under normal lifecycle this is unreachable. The check guards
  // against a theoretical thread_local teardown between construction and
  // first use, which would otherwise SIGSEGV on AcquireChunk.
  if (SMOL_UNLIKELY(self->chunk_pool_ == nullptr)) {
    isolate->ThrowException(v8::Exception::Error(
        v8::String::NewFromUtf8Literal(isolate,
            "StreamChunkPool unavailable (environment shutting down)")));
    return;
  }

  // Fast path: return buffered data synchronously.
  if (SMOL_LIKELY(!self->buffer_.empty())) {
    v8::Global<Value> global_value = std::move(self->buffer_.front());
    self->buffer_.pop();

    Local<Value> value = global_value.Get(isolate);

    // Get chunk from pool and set value.
    Local<Object> chunk = self->chunk_pool_->AcquireChunk();
    StreamChunkPool::SetChunkValue(env, chunk, value, false);

    args.GetReturnValue().Set(chunk);
    return;
  }

  // No buffered data: return close chunk if closed.
  if (self->closed_) {
    Local<Object> chunk = self->chunk_pool_->AcquireChunk();
    StreamChunkPool::SetChunkValue(env, chunk, Undefined(isolate), true);
    args.GetReturnValue().Set(chunk);
    return;
  }

  // Need async read: return undefined to signal JS layer.
  args.GetReturnValue().Set(Undefined(isolate));
}

void FastReadableStreamAccelerator::Enqueue(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.This());

  if (args.Length() < 1) {
    return;
  }

  if (self->closed_ || self->errored_) {
    return;
  }

  Isolate* isolate = self->env()->isolate();
  HandleScope scope(isolate);

  // Backpressure: refuse to enqueue when the internal queue is already
  // large. Without a cap a misbehaving JS producer that never reads
  // could grow this queue until a std::deque node allocation bad_allocs
  // → std::terminate under -fno-exceptions (process death). 8192 Globals
  // is well above any real-world pipelining need and well below the
  // allocation cliff even on constrained systems.
  constexpr size_t kMaxQueuedChunks = 8192;
  if (self->buffer_.size() >= kMaxQueuedChunks) {
    isolate->ThrowException(v8::Exception::RangeError(
        v8::String::NewFromUtf8Literal(isolate,
            "FastReadableStream queue overflow (limit: 8192 chunks)")));
    return;
  }

  // Buffer the value for future reads.
  Local<Value> value = args[0];
  self->buffer_.emplace(isolate, value);
}

void FastReadableStreamAccelerator::Close(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.This());

  self->closed_ = true;
}

void FastReadableStreamAccelerator::HasData(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.This());

  Isolate* isolate = self->env()->isolate();
  args.GetReturnValue().Set(Boolean::New(isolate, !self->buffer_.empty()));
}

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node

#pragma GCC diagnostic pop
