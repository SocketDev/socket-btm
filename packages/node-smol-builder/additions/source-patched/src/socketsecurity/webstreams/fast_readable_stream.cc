#include "fast_readable_stream.h"
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
  : AsyncWrap(env, object, PROVIDER_READABLESTREAM),
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

  new FastReadableStreamAccelerator(env, args.This());
}

void FastReadableStreamAccelerator::ReadSync(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.Holder());

  Environment* env = self->env();
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  // Fast path: return buffered data synchronously.
  if (!self->buffer_.empty()) {
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
  ASSIGN_OR_RETURN_UNWRAP(&self, args.Holder());

  if (args.Length() < 1) {
    return;
  }

  if (self->closed_ || self->errored_) {
    return;
  }

  Isolate* isolate = self->env()->isolate();
  HandleScope scope(isolate);

  // Buffer the value for future reads.
  Local<Value> value = args[0];
  self->buffer_.emplace(isolate, value);
}

void FastReadableStreamAccelerator::Close(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.Holder());

  self->closed_ = true;
}

void FastReadableStreamAccelerator::HasData(
    const FunctionCallbackInfo<Value>& args) {
  FastReadableStreamAccelerator* self;
  ASSIGN_OR_RETURN_UNWRAP(&self, args.Holder());

  Isolate* isolate = self->env()->isolate();
  args.GetReturnValue().Set(Boolean::New(isolate, !self->buffer_.empty()));
}

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node
