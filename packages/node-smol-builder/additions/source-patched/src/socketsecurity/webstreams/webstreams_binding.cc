// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/webstreams/fast_readable_stream.h"
#include "socketsecurity/webstreams/stream_chunk_pool.h"
#include "async_wrap-inl.h"
#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util-inl.h"
#include "v8.h"

namespace node {
namespace socketsecurity {
namespace webstreams {

using v8::Boolean;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Object;
using v8::String;
using v8::Value;

// Global chunk pool (one per environment).
// Note: Non-static for external linkage (used by fast_readable_stream.cc).
StreamChunkPool* GetChunkPool(Environment* env) {
  static StreamChunkPool* pool = nullptr;
  if (pool == nullptr) {
    pool = new (std::nothrow) StreamChunkPool(env);
  }
  return pool;
}

// Removed IsNativeAvailable - C++ always available in our build.

// Acquire chunk from pool.
static void AcquireChunk(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  StreamChunkPool* pool = GetChunkPool(env);

  Local<Object> chunk = pool->AcquireChunk();
  args.GetReturnValue().Set(chunk);
}

// Release chunk to pool.
static void ReleaseChunk(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return;
  }

  StreamChunkPool* pool = GetChunkPool(env);
  pool->ReleaseChunk(args[0].As<Object>());
}

// Set chunk value (WPT-compatible).
static void SetChunkValue(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 3 || !args[0]->IsObject() || !args[2]->IsBoolean()) {
    return;
  }

  Local<Object> chunk = args[0].As<Object>();
  Local<Value> value = args[1];
  bool done = args[2]->BooleanValue(env->isolate());

  StreamChunkPool::SetChunkValue(env, chunk, value, done);
}

// Get chunk pool stats.
static void GetChunkPoolStats(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  StreamChunkPool* pool = GetChunkPool(env);

  Local<Object> stats = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  Local<Context> context = env->context();

  stats->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "poolSize"),
    v8::Integer::NewFromUnsigned(isolate, pool->GetPoolSize())).Check();

  args.GetReturnValue().Set(stats);
}

static void Initialize(Local<Object> target,
                      Local<Value> unused,
                      Local<Context> context,
                      void* priv) {
  Environment* env = Environment::GetCurrent(context);
  Isolate* isolate = env->isolate();

  // Chunk pool methods.
  SetMethod(context, target, "acquireChunk", AcquireChunk);
  SetMethod(context, target, "releaseChunk", ReleaseChunk);
  SetMethod(context, target, "setChunkValue", SetChunkValue);
  SetMethod(context, target, "getChunkPoolStats", GetChunkPoolStats);

  // FastReadableStreamAccelerator constructor.
  Local<v8::FunctionTemplate> accelerator_tmpl =
    NewFunctionTemplate(isolate, FastReadableStreamAccelerator::New);
  accelerator_tmpl->InstanceTemplate()->SetInternalFieldCount(
    FastReadableStreamAccelerator::kInternalFieldCount);
  accelerator_tmpl->Inherit(AsyncWrap::GetConstructorTemplate(env));

  SetProtoMethod(isolate, accelerator_tmpl, "readSync",
                 FastReadableStreamAccelerator::ReadSync);
  SetProtoMethod(isolate, accelerator_tmpl, "enqueue",
                 FastReadableStreamAccelerator::Enqueue);
  SetProtoMethod(isolate, accelerator_tmpl, "close",
                 FastReadableStreamAccelerator::Close);
  SetProtoMethod(isolate, accelerator_tmpl, "hasData",
                 FastReadableStreamAccelerator::HasData);

  SetConstructorFunction(
    context,
    target,
    "FastReadableStreamAccelerator",
    accelerator_tmpl);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(AcquireChunk);
  registry->Register(ReleaseChunk);
  registry->Register(SetChunkValue);
  registry->Register(GetChunkPoolStats);
  registry->Register(FastReadableStreamAccelerator::New);
  registry->Register(FastReadableStreamAccelerator::ReadSync);
  registry->Register(FastReadableStreamAccelerator::Enqueue);
  registry->Register(FastReadableStreamAccelerator::Close);
  registry->Register(FastReadableStreamAccelerator::HasData);
}

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
  smol_webstreams,
  node::socketsecurity::webstreams::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
  smol_webstreams,
  node::socketsecurity::webstreams::RegisterExternalReferences)

#pragma GCC diagnostic pop
