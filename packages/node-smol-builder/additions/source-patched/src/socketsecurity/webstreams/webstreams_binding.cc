#include "env-inl.h"
#include "fast_readable_stream.h"
#include "node.h"
#include "node_binding.h"
#include "stream_chunk_pool.h"
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
using v8::Object;
using v8::String;
using v8::Value;

// Global chunk pool (one per environment).
static StreamChunkPool* GetChunkPool(Environment* env) {
  static StreamChunkPool* pool = nullptr;
  if (pool == nullptr) {
    pool = new StreamChunkPool(env);
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

  Local<Object> stats = Object::New(isolate);
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
  env->SetMethod(target, "acquireChunk", AcquireChunk);
  env->SetMethod(target, "releaseChunk", ReleaseChunk);
  env->SetMethod(target, "setChunkValue", SetChunkValue);
  env->SetMethod(target, "getChunkPoolStats", GetChunkPoolStats);

  // FastReadableStreamAccelerator constructor.
  Local<v8::FunctionTemplate> accelerator_tmpl =
    env->NewFunctionTemplate(FastReadableStreamAccelerator::New);
  accelerator_tmpl->InstanceTemplate()->SetInternalFieldCount(
    FastReadableStreamAccelerator::kInternalFieldCount);
  accelerator_tmpl->Inherit(AsyncWrap::GetConstructorTemplate(env));

  env->SetProtoMethod(accelerator_tmpl, "readSync",
                     FastReadableStreamAccelerator::ReadSync);
  env->SetProtoMethod(accelerator_tmpl, "enqueue",
                     FastReadableStreamAccelerator::Enqueue);
  env->SetProtoMethod(accelerator_tmpl, "close",
                     FastReadableStreamAccelerator::Close);
  env->SetProtoMethod(accelerator_tmpl, "hasData",
                     FastReadableStreamAccelerator::HasData);

  env->SetConstructorFunction(
    target,
    "FastReadableStreamAccelerator",
    accelerator_tmpl);
}

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
  socketsecurity_webstreams,
  node::socketsecurity::webstreams::Initialize)
