#include "env-inl.h"
#include "socketsecurity/http-perf/fast_304_response.h"
#include "socketsecurity/http-perf/http_fast_response.h"
#include "socketsecurity/http-perf/http_object_pool.h"
#include "socketsecurity/http-perf/iouring_network.h"
#include "socketsecurity/http-perf/mimalloc_allocator.h"
#include "node.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "socketsecurity/http-perf/tcp_optimizations.h"
#include "util-inl.h"
#include "v8.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Uint8Array;
using v8::Value;

// Pre-format common HTTP status lines for instant responses.
static void GetStatusLine(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (!args[0]->IsInt32()) {
    return;
  }

  int32_t status_code = args[0].As<v8::Int32>()->Value();
  const char* status_line = nullptr;

  // Most common status codes in registry workloads.
  switch (status_code) {
    case 200:
      status_line = "HTTP/1.1 200 OK\r\n";
      break;
    case 304:
      status_line = "HTTP/1.1 304 Not Modified\r\n";
      break;
    case 404:
      status_line = "HTTP/1.1 404 Not Found\r\n";
      break;
    case 500:
      status_line = "HTTP/1.1 500 Internal Server Error\r\n";
      break;
    default:
      return;
  }

  args.GetReturnValue().Set(
    FIXED_ONE_BYTE_STRING(isolate, status_line));
}

// Pre-format Content-Length header for common sizes.
static void GetContentLengthHeader(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (!args[0]->IsInt32()) {
    return;
  }

  int32_t length = args[0].As<v8::Int32>()->Value();

  // Fast path for common small sizes (< 10KB).
  if (length < 10240) {
    char buf[64];
    int len = snprintf(buf, sizeof(buf), "Content-Length: %d\r\n", length);
    args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, buf, v8::NewStringType::kNormal, len)
        .ToLocalChecked());
    return;
  }
}

// Fast path: write complete JSON response.
static void WriteJsonResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3 || !args[0]->IsObject() || !args[1]->IsInt32()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  int status_code = args[1].As<v8::Int32>()->Value();

  // Get JSON string.
  Local<String> json_str;
  if (args[2]->IsString()) {
    json_str = args[2].As<String>();
  } else {
    return;
  }

  // Convert to UTF-8.
  v8::String::Utf8Value json_utf8(isolate, json_str);
  if (*json_utf8 == nullptr) {
    return;
  }

  bool success = FastResponse::WriteJson(
    env,
    socket,
    status_code,
    *json_utf8,
    json_utf8.length());

  args.GetReturnValue().Set(success);
}

// Fast path: write complete binary response.
static void WriteBinaryResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 4 || !args[0]->IsObject() || !args[1]->IsInt32() ||
      !args[3]->IsString()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  int status_code = args[1].As<v8::Int32>()->Value();

  // Get buffer data.
  if (!args[2]->IsUint8Array()) {
    return;
  }

  Local<Uint8Array> buffer = args[2].As<Uint8Array>();
  const uint8_t* data = static_cast<const uint8_t*>(
    buffer->Buffer()->GetBackingStore()->Data());
  size_t length = buffer->ByteLength();

  // Get content type.
  v8::String::Utf8Value content_type(env->isolate(), args[3]);
  if (*content_type == nullptr) {
    return;
  }

  bool success = FastResponse::WriteBinary(
    env,
    socket,
    status_code,
    data,
    length,
    *content_type);

  args.GetReturnValue().Set(success);
}

// Fast path: write 304 Not Modified.
static void WriteNotModifiedResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();

  bool success = FastResponse::WriteNotModified(env, socket);

  args.GetReturnValue().Set(success);
}

// HTTP object pool (global per environment).
static HttpObjectPool* GetObjectPool(Environment* env) {
  static HttpObjectPool* pool = nullptr;
  if (pool == nullptr) {
    pool = new HttpObjectPool(env);
  }
  return pool;
}

// Acquire request object from pool.
static void AcquireRequest(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  HttpObjectPool* pool = GetObjectPool(env);

  Local<Object> req = pool->AcquireRequest();
  args.GetReturnValue().Set(req);
}

// Release request object to pool.
static void ReleaseRequest(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return;
  }

  HttpObjectPool* pool = GetObjectPool(env);
  pool->ReleaseRequest(args[0].As<Object>());
}

// Acquire response object from pool.
static void AcquireResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  HttpObjectPool* pool = GetObjectPool(env);

  Local<Object> res = pool->AcquireResponse();
  args.GetReturnValue().Set(res);
}

// Release response object to pool.
static void ReleaseResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return;
  }

  HttpObjectPool* pool = GetObjectPool(env);
  pool->ReleaseResponse(args[0].As<Object>());
}

// Get object pool stats.
static void GetObjectPoolStats(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  HttpObjectPool* pool = GetObjectPool(env);

  Local<Object> stats = Object::New(isolate);
  Local<Context> context = env->context();

  stats->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "requestPoolSize"),
    v8::Integer::NewFromUnsigned(isolate, pool->GetRequestPoolSize())).Check();
  stats->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "responsePoolSize"),
    v8::Integer::NewFromUnsigned(isolate, pool->GetResponsePoolSize())).Check();

  args.GetReturnValue().Set(stats);
}

// Check if TCP optimizations are available.
static void IsTcpOptAvailable(const FunctionCallbackInfo<Value>& args) {
  bool available = true;  // TCP opts are always attempted.
  args.GetReturnValue().Set(available);
}

// Check if io_uring is available.
static void IsIoUringAvailable(const FunctionCallbackInfo<Value>& args) {
  bool available = IoUringNetwork::IsAvailable();
  args.GetReturnValue().Set(available);
}

// Check if mimalloc is available.
static void IsMimallocAvailable(const FunctionCallbackInfo<Value>& args) {
  bool available = MimallocArrayBufferAllocator::IsMimallocAvailable();
  args.GetReturnValue().Set(available);
}

static void Initialize(Local<Object> target,
                      Local<Value> unused,
                      Local<Context> context,
                      void* priv) {
  Environment* env = Environment::GetCurrent(context);
  Isolate* isolate = env->isolate();

  // Existing HTTP perf methods.
  env->SetMethod(target, "getStatusLine", GetStatusLine);
  env->SetMethod(target, "getContentLengthHeader", GetContentLengthHeader);
  env->SetMethod(target, "writeJsonResponse", WriteJsonResponse);
  env->SetMethod(target, "writeBinaryResponse", WriteBinaryResponse);
  env->SetMethod(target, "writeNotModifiedResponse", WriteNotModifiedResponse);
  env->SetMethod(target, "acquireRequest", AcquireRequest);
  env->SetMethod(target, "releaseRequest", ReleaseRequest);
  env->SetMethod(target, "acquireResponse", AcquireResponse);
  env->SetMethod(target, "releaseResponse", ReleaseResponse);
  env->SetMethod(target, "getObjectPoolStats", GetObjectPoolStats);

  // New advanced optimization methods.
  env->SetMethod(target, "isTcpOptAvailable", IsTcpOptAvailable);
  env->SetMethod(target, "isIoUringAvailable", IsIoUringAvailable);
  env->SetMethod(target, "isMimallocAvailable", IsMimallocAvailable);
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(socketsecurity_http_perf,
                                     node::socketsecurity::http_perf::Initialize)
