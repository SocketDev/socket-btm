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

// Per-thread chunk pool. A `static` local was previously shared across
// every worker Environment and permanently bound to the first worker's
// `env`, so later workers would acquire chunks wrapping a dead Environment
// once the first worker tore down. `thread_local` keeps one pool per
// worker thread; the cleanup hook zeros this thread's slot on teardown so
// the next thread to call GetChunkPool lazily re-creates.
// Non-static for external linkage (used by fast_readable_stream.cc).
static thread_local StreamChunkPool* tl_chunk_pool = nullptr;

static void ChunkPoolCleanup(void* data) {
  auto* pool = static_cast<StreamChunkPool*>(data);
  if (tl_chunk_pool == pool) {
    tl_chunk_pool = nullptr;
  }
  delete pool;
}

StreamChunkPool* GetChunkPool(Environment* env) {
  if (tl_chunk_pool == nullptr) {
    // Nothrow + null-check + skip AddCleanupHook on failure so OOM can't
    // silently register a nullptr cleanup callback.
    StreamChunkPool* fresh = new (std::nothrow) StreamChunkPool(env);
    if (fresh == nullptr) {
      return nullptr;
    }
    tl_chunk_pool = fresh;
    env->AddCleanupHook(ChunkPoolCleanup, tl_chunk_pool);
  }
  return tl_chunk_pool;
}

// Throws a JS Error when pool is null, returns true so callers can early
// return. Same pattern as CheckObjectPoolOrThrow in smol_http_binding.cc.
static bool CheckChunkPoolOrThrow(Isolate* isolate,
                                  const StreamChunkPool* pool) {
  if (pool == nullptr) {
    isolate->ThrowException(v8::Exception::Error(
        v8::String::NewFromUtf8Literal(isolate,
            "Out of memory: failed to allocate StreamChunkPool")));
    return true;
  }
  return false;
}

// Removed IsNativeAvailable - C++ always available in our build.

// Acquire chunk from pool.
static void AcquireChunk(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  StreamChunkPool* pool = GetChunkPool(env);
  if (CheckChunkPoolOrThrow(env->isolate(), pool)) return;

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
  if (CheckChunkPoolOrThrow(env->isolate(), pool)) return;
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
  if (CheckChunkPoolOrThrow(isolate, pool)) return;

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
