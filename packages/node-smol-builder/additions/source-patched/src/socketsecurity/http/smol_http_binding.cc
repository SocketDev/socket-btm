// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// smol_http_binding.cc
// Unified V8 binding for node:smol-http — all native HTTP utilities.
//
// Merges URL parsing, headers, WebSocket, response writers, object pools,
// trie router, TCP optimizations, and feature detection into a single
// `smol_http` internal binding.

#include "http_binding.h"
#include "socketsecurity/http/fast_304_response.h"
#include "socketsecurity/http/http_fast_response.h"
#include "socketsecurity/http/http_object_pool.h"
#include "socketsecurity/http/iouring_network.h"
#include "socketsecurity/http/mimalloc_allocator.h"
#include "socketsecurity/http/tcp_optimizations.h"

#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "stream_base-inl.h"
#include "util-inl.h"
#include "v8.h"

#include <cstdio>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace node {
namespace smol_http {

using v8::Array;
using v8::ArrayBuffer;
using v8::ArrayBufferView;
using v8::Boolean;
using v8::Context;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Global;
using v8::HandleScope;
using v8::Int32;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::NewStringType;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::ObjectTemplate;
using v8::String;
using v8::Uint32;
using v8::Uint8Array;
using v8::Value;

// ============================================================================
// URL Parsing
// ============================================================================

void ParseUrl(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().SetNull();
    return;
  }

  String::Utf8Value url_str(isolate, args[0]);
  if (*url_str == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }

  smol::http::ParsedUrl parsed = smol::http::ParseUrl(*url_str, url_str.length());

  if (!parsed.valid) {
    args.GetReturnValue().SetNull();
    return;
  }

  Local<Object> result = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  result->Set(context,
      String::NewFromUtf8Literal(isolate, "pathname"),
      String::NewFromUtf8(isolate, parsed.pathname.data(),
          NewStringType::kNormal, parsed.pathname.length()).ToLocalChecked()
  ).Check();

  if (!parsed.query.empty()) {
    result->Set(context,
        String::NewFromUtf8Literal(isolate, "query"),
        String::NewFromUtf8(isolate, parsed.query.data(),
            NewStringType::kNormal, parsed.query.length()).ToLocalChecked()
    ).Check();
  }

  if (!parsed.hash.empty()) {
    result->Set(context,
        String::NewFromUtf8Literal(isolate, "hash"),
        String::NewFromUtf8(isolate, parsed.hash.data(),
            NewStringType::kNormal, parsed.hash.length()).ToLocalChecked()
    ).Check();
  }

  args.GetReturnValue().Set(result);
}

void ParseQueryString(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(Object::New(isolate, Null(isolate), nullptr, nullptr, 0));
    return;
  }

  String::Utf8Value qs_str(isolate, args[0]);
  if (*qs_str == nullptr || qs_str.length() == 0) {
    args.GetReturnValue().Set(Object::New(isolate, Null(isolate), nullptr, nullptr, 0));
    return;
  }

  constexpr size_t kMaxPairs = 64;
  std::string_view keys[kMaxPairs];
  std::string_view values[kMaxPairs];

  size_t count = smol::http::ParseQueryString(
      *qs_str, qs_str.length(), keys, values, kMaxPairs);

  Local<Object> result = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  for (size_t i = 0; i < count; ++i) {
    Local<String> key;
    Local<String> value;

    if (smol::http::NeedsDecoding(keys[i].data(), keys[i].length())) {
      // Decoded output is always <= input length
      std::vector<char> decode_buf(keys[i].length() + 1);
      size_t decoded_len = smol::http::DecodeURIComponent(
          keys[i].data(), keys[i].length(), decode_buf.data());
      key = String::NewFromUtf8(isolate, decode_buf.data(),
          NewStringType::kNormal, decoded_len).ToLocalChecked();
    } else {
      key = String::NewFromUtf8(isolate, keys[i].data(),
          NewStringType::kNormal, keys[i].length()).ToLocalChecked();
    }

    if (smol::http::NeedsDecoding(values[i].data(), values[i].length())) {
      std::vector<char> decode_buf(values[i].length() + 1);
      size_t decoded_len = smol::http::DecodeURIComponent(
          values[i].data(), values[i].length(), decode_buf.data());
      value = String::NewFromUtf8(isolate, decode_buf.data(),
          NewStringType::kNormal, decoded_len).ToLocalChecked();
    } else {
      value = String::NewFromUtf8(isolate, values[i].data(),
          NewStringType::kNormal, values[i].length()).ToLocalChecked();
    }

    result->Set(context, key, value).Check();
  }

  args.GetReturnValue().Set(result);
}

void DecodeURIComponent(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  String::Utf8Value str(isolate, args[0]);
  if (*str == nullptr) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  if (!smol::http::NeedsDecoding(*str, str.length())) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  std::vector<char> output(str.length() + 1);
  size_t decoded_len = smol::http::DecodeURIComponent(
      *str, str.length(), output.data());

  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, output.data(),
          NewStringType::kNormal, decoded_len).ToLocalChecked());
}

// ============================================================================
// Header Operations
// ============================================================================

void NormalizeHeaderName(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  String::Utf8Value name(isolate, args[0]);
  if (*name == nullptr) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  const char* interned = smol::http::GetInternedHeaderName(*name, name.length());
  if (interned) {
    args.GetReturnValue().Set(
        String::NewFromUtf8(isolate, interned).ToLocalChecked());
    return;
  }

  std::vector<char> buf(*name, *name + name.length());
  smol::http::NormalizeHeaderName(buf.data(), buf.size());

  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, buf.data(),
          NewStringType::kNormal, buf.size()).ToLocalChecked());
}

void HeaderEquals(const FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 2 || !args[0]->IsString() || !args[1]->IsString()) {
    args.GetReturnValue().Set(false);
    return;
  }

  Isolate* isolate = args.GetIsolate();
  String::Utf8Value a(isolate, args[0]);
  if (*a == nullptr) {
    args.GetReturnValue().Set(false);
    return;
  }

  String::Utf8Value b(isolate, args[1]);
  if (*b == nullptr) {
    args.GetReturnValue().Set(false);
    return;
  }

  args.GetReturnValue().Set(
    smol::http::HeaderEquals(*a, a.length(), *b, b.length()));
}

// ============================================================================
// WebSocket Operations
// ============================================================================

void DecodeWebSocketFrame(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsArrayBufferView()) {
    args.GetReturnValue().SetNull();
    return;
  }

  Local<ArrayBufferView> view = args[0].As<ArrayBufferView>();
  size_t len = view->ByteLength();

  std::vector<uint8_t> buffer(len);
  view->CopyContents(buffer.data(), len);

  smol::http::WebSocketFrame frame = smol::http::DecodeWebSocketFrame(buffer.data(), len);

  if (!frame.valid) {
    args.GetReturnValue().SetNull();
    return;
  }

  Local<Object> result = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  result->Set(context,
      String::NewFromUtf8Literal(isolate, "opcode"),
      Integer::New(isolate, frame.opcode)).Check();
  result->Set(context,
      String::NewFromUtf8Literal(isolate, "fin"),
      Boolean::New(isolate, frame.fin)).Check();
  result->Set(context,
      String::NewFromUtf8Literal(isolate, "masked"),
      Boolean::New(isolate, frame.masked)).Check();
  result->Set(context,
      String::NewFromUtf8Literal(isolate, "totalLength"),
      Integer::NewFromUnsigned(isolate, static_cast<uint32_t>(frame.total_len))).Check();

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, frame.payload_len);
  if (frame.payload_len > 0) {
    std::memcpy(ab->Data(), frame.payload, frame.payload_len);
  }
  result->Set(context,
      String::NewFromUtf8Literal(isolate, "payload"),
      Uint8Array::New(ab, 0, frame.payload_len)).Check();

  args.GetReturnValue().Set(result);
}

void EncodeWebSocketFrame(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1) {
    args.GetReturnValue().SetNull();
    return;
  }

  const uint8_t* payload = nullptr;
  size_t payload_len = 0;
  std::vector<uint8_t> str_buffer;

  if (args[0]->IsString()) {
    String::Utf8Value str(isolate, args[0]);
    if (*str == nullptr) {
      args.GetReturnValue().SetNull();
      return;
    }
    payload_len = str.length();
    str_buffer.assign(*str, *str + payload_len);
    payload = str_buffer.data();
  } else if (args[0]->IsArrayBufferView()) {
    Local<ArrayBufferView> view = args[0].As<ArrayBufferView>();
    payload_len = view->ByteLength();
    str_buffer.resize(payload_len);
    view->CopyContents(str_buffer.data(), payload_len);
    payload = str_buffer.data();
  } else {
    args.GetReturnValue().SetNull();
    return;
  }

  uint8_t opcode = 0x01;
  if (args.Length() > 1 && args[1]->IsInt32()) {
    opcode = static_cast<uint8_t>(args[1].As<Int32>()->Value());
  }

  bool fin = true;
  if (args.Length() > 2 && args[2]->IsBoolean()) {
    fin = args[2].As<Boolean>()->Value();
  }

  size_t max_output_len = payload_len + 14;
  std::vector<uint8_t> output(max_output_len);

  size_t frame_len = smol::http::EncodeWebSocketFrame(
      output.data(), output.size(), payload, payload_len, opcode, fin);

  if (frame_len == 0) {
    args.GetReturnValue().SetNull();
    return;
  }

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, frame_len);
  std::memcpy(ab->Data(), output.data(), frame_len);
  args.GetReturnValue().Set(Uint8Array::New(ab, 0, frame_len));
}

void UnmaskWebSocketPayload(const FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 2 || !args[0]->IsArrayBufferView() || !args[1]->IsUint32()) {
    return;
  }

  Local<ArrayBufferView> view = args[0].As<ArrayBufferView>();
  uint32_t mask_key = args[1].As<Uint32>()->Value();

  void* data = view->Buffer()->Data();
  size_t offset = view->ByteOffset();
  size_t len = view->ByteLength();

  uint8_t* payload = static_cast<uint8_t*>(data) + offset;
  smol::http::UnmaskPayload(payload, len, mask_key);
}

// ============================================================================
// Response Building (buffer-based — returns buffer for JS to write)
// ============================================================================

void BuildJsonResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3 || !args[1]->IsInt32()) {
    args.GetReturnValue().Set(false);
    return;
  }

  int status = args[1].As<Int32>()->Value();

  String::Utf8Value json(isolate, args[2]);
  if (*json == nullptr) {
    args.GetReturnValue().Set(false);
    return;
  }

  size_t json_len = json.length();
  size_t buffer_size = json_len + 256;
  std::vector<uint8_t> buffer(buffer_size);

  smol::http::ResponseBuilder builder(buffer.data(), buffer_size);
  bool ok = builder.WriteJsonResponse(status, *json, json_len);

  if (!ok) {
    args.GetReturnValue().Set(false);
    return;
  }

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, builder.length);
  std::memcpy(ab->Data(), buffer.data(), builder.length);
  args.GetReturnValue().Set(Uint8Array::New(ab, 0, builder.length));
}

void BuildTextResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3) {
    args.GetReturnValue().Set(false);
    return;
  }

  int status = args[1].As<Int32>()->Value();

  String::Utf8Value text(isolate, args[2]);
  if (*text == nullptr) {
    args.GetReturnValue().Set(false);
    return;
  }

  size_t text_len = text.length();
  size_t buffer_size = text_len + 256;
  std::vector<uint8_t> buffer(buffer_size);

  smol::http::ResponseBuilder builder(buffer.data(), buffer_size);
  bool ok = builder.WriteTextResponse(status, *text, text_len);

  if (!ok) {
    args.GetReturnValue().Set(false);
    return;
  }

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, builder.length);
  std::memcpy(ab->Data(), buffer.data(), builder.length);
  args.GetReturnValue().Set(Uint8Array::New(ab, 0, builder.length));
}

void BuildBinaryResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3) {
    args.GetReturnValue().Set(false);
    return;
  }

  int status = args[1].As<Int32>()->Value();

  if (!args[2]->IsArrayBufferView()) {
    args.GetReturnValue().Set(false);
    return;
  }

  Local<ArrayBufferView> data_view = args[2].As<ArrayBufferView>();
  size_t data_len = data_view->ByteLength();
  std::vector<uint8_t> data(data_len);
  data_view->CopyContents(data.data(), data_len);

  const char* content_type = "application/octet-stream";
  size_t content_type_len = 24;  // strlen("application/octet-stream")
  std::string content_type_storage;

  if (args.Length() > 3 && args[3]->IsString()) {
    String::Utf8Value ct_str(isolate, args[3]);
    if (*ct_str != nullptr) {
      content_type_storage.assign(*ct_str, ct_str.length());
      content_type = content_type_storage.c_str();
      content_type_len = content_type_storage.length();
    }
  }

  size_t buffer_size = data_len + 256 + content_type_len;
  std::vector<uint8_t> buffer(buffer_size);

  smol::http::ResponseBuilder builder(buffer.data(), buffer_size);
  bool ok = builder.WriteBinaryResponse(status, data.data(), data_len, content_type);

  if (!ok) {
    args.GetReturnValue().Set(false);
    return;
  }

  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, builder.length);
  std::memcpy(ab->Data(), buffer.data(), builder.length);
  args.GetReturnValue().Set(Uint8Array::New(ab, 0, builder.length));
}

// ============================================================================
// Type Checking
// ============================================================================

void IsHeaders(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    args.GetReturnValue().Set(false);
    return;
  }

  Local<Object> obj = args[0].As<Object>();
  Local<String> class_name = obj->GetConstructorName();
  String::Utf8Value name(isolate, class_name);

  if (*name != nullptr && std::strcmp(*name, "Headers") == 0) {
    args.GetReturnValue().Set(true);
    return;
  }

  args.GetReturnValue().Set(false);
}

// ============================================================================
// Router (Native Trie)
// ============================================================================

// Per-thread router storage.
// Each thread (main or worker) gets its own router instance.
// Cleanup hooks free the router when the Environment is destroyed,
// and reset the thread_local to nullptr to prevent dangling access.
static thread_local smol::http::TrieRouter* tl_router = nullptr;

static void RouterCleanup(void* data) {
  auto* router = static_cast<smol::http::TrieRouter*>(data);
  if (tl_router == router) {
    tl_router = nullptr;
  }
  delete router;
}

void CreateRouter(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  // Remove old router and its cleanup hook to prevent double-free.
  if (tl_router != nullptr) {
    env->RemoveCleanupHook(RouterCleanup, tl_router);
    delete tl_router;
    tl_router = nullptr;
  }

  auto* router = new smol::http::TrieRouter();
  tl_router = router;
  env->AddCleanupHook(RouterCleanup, router);
}

void AddRoute(const FunctionCallbackInfo<Value>& args) {
  auto* router = tl_router;
  if (router == nullptr || args.Length() < 2) {
    return;
  }

  Isolate* isolate = args.GetIsolate();
  String::Utf8Value pattern(isolate, args[0]);
  uint32_t handler_id = args[1].As<Uint32>()->Value();

  if (*pattern != nullptr) {
    router->Insert(*pattern, pattern.length(), handler_id);
  }
}

void MatchRoute(const FunctionCallbackInfo<Value>& args) {
  auto* router = tl_router;
  if (router == nullptr || args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().SetNull();
    return;
  }

  Isolate* isolate = args.GetIsolate();
  String::Utf8Value pathname(isolate, args[0]);
  if (*pathname == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }

  auto result = router->Match(*pathname, pathname.length());

  if (!result.matched) {
    args.GetReturnValue().SetNull();
    return;
  }

  Local<Context> context = isolate->GetCurrentContext();
  Local<Object> obj = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "handlerId"),
      Uint32::New(isolate, result.handler_id)).Check();

  Local<Object> params = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  for (size_t i = 0; i < result.param_count; ++i) {
    const auto& p = result.params[i];
    Local<String> key = String::NewFromUtf8(isolate, p.name,
        NewStringType::kNormal, p.name_len).ToLocalChecked();
    Local<String> value = String::NewFromUtf8(isolate,
        *pathname + p.value_start,
        NewStringType::kNormal, p.value_len).ToLocalChecked();
    params->Set(context, key, value).Check();
  }

  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "params"),
      params).Check();

  args.GetReturnValue().Set(obj);
}

// ============================================================================
// Fast Response Writers (UV stream — writes directly to socket)
// ============================================================================

using socketsecurity::http_perf::FastResponse;
using socketsecurity::http_perf::Fast304Response;
using socketsecurity::http_perf::HttpObjectPool;
using socketsecurity::http_perf::IoUringNetwork;
using socketsecurity::http_perf::MimallocArrayBufferAllocator;

// writeJsonDirect(socket, statusCode, jsonString) -> boolean
void WriteJsonDirect(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3 || !args[0]->IsObject() || !args[1]->IsInt32()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  int status_code = args[1].As<Int32>()->Value();

  Local<String> json_str;
  if (args[2]->IsString()) {
    json_str = args[2].As<String>();
  } else {
    return;
  }

  v8::String::Utf8Value json_utf8(isolate, json_str);
  if (*json_utf8 == nullptr) {
    return;
  }

  bool success = FastResponse::WriteJson(
    env, socket, status_code, *json_utf8, json_utf8.length());

  args.GetReturnValue().Set(success);
}

// writeBinaryDirect(socket, statusCode, buffer, contentType) -> boolean
void WriteBinaryDirect(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 4 || !args[0]->IsObject() || !args[1]->IsInt32() ||
      !args[2]->IsUint8Array() || !args[3]->IsString()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  int status_code = args[1].As<Int32>()->Value();

  Local<Uint8Array> buffer = args[2].As<Uint8Array>();
  const uint8_t* data = static_cast<const uint8_t*>(
    buffer->Buffer()->GetBackingStore()->Data()) + buffer->ByteOffset();
  size_t length = buffer->ByteLength();

  v8::String::Utf8Value content_type(env->isolate(), args[3]);
  if (*content_type == nullptr) {
    return;
  }

  bool success = FastResponse::WriteBinary(
    env, socket, status_code, data, length, *content_type);

  args.GetReturnValue().Set(success);
}

// writeNotModified(socket) -> boolean
void WriteNotModified(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  bool success = FastResponse::WriteNotModified(env, socket);
  args.GetReturnValue().Set(success);
}

// writeTextDirect(socket, statusCode, text) -> boolean
// Writes a text/plain response directly to the UV stream.
void WriteTextDirect(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3 || !args[0]->IsObject() || !args[1]->IsInt32()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  int status_code = args[1].As<Int32>()->Value();

  if (!args[2]->IsString()) {
    return;
  }

  String::Utf8Value text(isolate, args[2]);
  if (*text == nullptr) {
    return;
  }

  // Reuse WriteBinary with text/plain content type — same UV stream write path.
  bool success = FastResponse::WriteBinary(
    env, socket, status_code,
    reinterpret_cast<const uint8_t*>(*text), text.length(),
    "text/plain");

  args.GetReturnValue().Set(success);
}

// ============================================================================
// Pre-formatted Headers
// ============================================================================

void GetStatusLine(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (!args[0]->IsInt32()) {
    return;
  }

  int32_t status_code = args[0].As<Int32>()->Value();
  const char* status_line = nullptr;

  switch (status_code) {
    case 200: status_line = "HTTP/1.1 200 OK\r\n"; break;
    case 304: status_line = "HTTP/1.1 304 Not Modified\r\n"; break;
    case 404: status_line = "HTTP/1.1 404 Not Found\r\n"; break;
    case 500: status_line = "HTTP/1.1 500 Internal Server Error\r\n"; break;
    default: return;
  }

  args.GetReturnValue().Set(
    String::NewFromUtf8(isolate, status_line).ToLocalChecked());
}

void GetContentLengthHeader(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (!args[0]->IsInt32()) {
    return;
  }

  int32_t length = args[0].As<Int32>()->Value();
  char buf[64];
  int len = snprintf(buf, sizeof(buf), "Content-Length: %d\r\n", length);
  args.GetReturnValue().Set(
    String::NewFromUtf8(isolate, buf, NewStringType::kNormal, len)
      .ToLocalChecked());
}

// ============================================================================
// Object Pool
// ============================================================================

static thread_local HttpObjectPool* tl_object_pool = nullptr;

static void ObjectPoolCleanup(void* data) {
  auto* pool = static_cast<HttpObjectPool*>(data);
  if (tl_object_pool == pool) {
    tl_object_pool = nullptr;
  }
  delete pool;
}

static HttpObjectPool* GetObjectPool(Environment* env) {
  if (tl_object_pool == nullptr) {
    tl_object_pool = new HttpObjectPool(env);
    env->AddCleanupHook(ObjectPoolCleanup, tl_object_pool);
  }
  return tl_object_pool;
}

void AcquireRequest(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  HttpObjectPool* pool = GetObjectPool(env);
  Local<Object> req = pool->AcquireRequest();
  args.GetReturnValue().Set(req);
}

void ReleaseRequest(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  if (args.Length() < 1 || !args[0]->IsObject()) return;
  HttpObjectPool* pool = GetObjectPool(env);
  pool->ReleaseRequest(args[0].As<Object>());
}

void AcquireResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  HttpObjectPool* pool = GetObjectPool(env);
  Local<Object> res = pool->AcquireResponse();
  args.GetReturnValue().Set(res);
}

void ReleaseResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  if (args.Length() < 1 || !args[0]->IsObject()) return;
  HttpObjectPool* pool = GetObjectPool(env);
  pool->ReleaseResponse(args[0].As<Object>());
}

void GetObjectPoolStats(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  HttpObjectPool* pool = GetObjectPool(env);

  Local<Object> stats = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  Local<Context> context = env->context();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "requestPoolSize"),
    v8::Integer::NewFromUnsigned(isolate, pool->GetRequestPoolSize())).Check();
  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "responsePoolSize"),
    v8::Integer::NewFromUnsigned(isolate, pool->GetResponsePoolSize())).Check();

  args.GetReturnValue().Set(stats);
}

// ============================================================================
// Feature Detection
// ============================================================================

// Apply TCP listen socket optimizations directly via setsockopt on an fd.
// Called from JS: smolHttpBinding.applyTcpListenOpts(fd)
void ApplyTcpListenOpts(const FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 1 || !args[0]->IsInt32()) {
    args.GetReturnValue().Set(false);
    return;
  }

  int fd = args[0].As<v8::Int32>()->Value();
  if (fd < 0) {
    args.GetReturnValue().Set(false);
    return;
  }

  bool any_ok = false;

#ifndef _WIN32
  // TCP_FASTOPEN — reduce connection latency by 1 RTT
#ifdef __linux__
  int tfo_qlen = 100;
  if (setsockopt(fd, SOL_TCP, TCP_FASTOPEN, &tfo_qlen, sizeof(tfo_qlen)) == 0) {
    any_ok = true;
  }
#elif defined(__APPLE__)
  int tfo_enable = 1;
  if (setsockopt(fd, IPPROTO_TCP, TCP_FASTOPEN, &tfo_enable, sizeof(tfo_enable)) == 0) {
    any_ok = true;
  }
#endif

  // TCP_DEFER_ACCEPT — delay accept() until data arrives (Linux only)
#ifdef TCP_DEFER_ACCEPT
  int defer_secs = 30;
  if (setsockopt(fd, IPPROTO_TCP, TCP_DEFER_ACCEPT, &defer_secs, sizeof(defer_secs)) == 0) {
    any_ok = true;
  }
#endif

  // Socket buffer sizes — 256KB for high throughput
  int buf_size = 262144;
  if (setsockopt(fd, SOL_SOCKET, SO_SNDBUF, &buf_size, sizeof(buf_size)) == 0) {
    any_ok = true;
  }
  if (setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &buf_size, sizeof(buf_size)) == 0) {
    any_ok = true;
  }
#endif  // _WIN32

  args.GetReturnValue().Set(any_ok);
}

void IsIoUringAvailable(const FunctionCallbackInfo<Value>& args) {
  bool available = IoUringNetwork::IsAvailable();
  args.GetReturnValue().Set(available);
}

void IsMimallocAvailable(const FunctionCallbackInfo<Value>& args) {
  bool available = MimallocArrayBufferAllocator::IsMimallocAvailable();
  args.GetReturnValue().Set(available);
}

// ============================================================================
// Module Initialization
// ============================================================================

void Initialize(Local<Object> exports,
                Local<Value> module,
                Local<Context> context,
                void* priv) {
  // URL parsing
  SetMethod(context, exports, "parseUrl", ParseUrl);
  SetMethod(context, exports, "parseQueryString", ParseQueryString);

  // WebSocket operations
  SetMethod(context, exports, "decodeWebSocketFrame", DecodeWebSocketFrame);
  SetMethod(context, exports, "encodeWebSocketFrame", EncodeWebSocketFrame);

  // Fast response writers (write directly to UV stream)
  SetMethod(context, exports, "writeJsonResponse", WriteJsonDirect);
  SetMethod(context, exports, "writeTextResponse", WriteTextDirect);
  SetMethod(context, exports, "writeBinaryResponse", WriteBinaryDirect);
  SetMethod(context, exports, "writeNotModifiedResponse", WriteNotModified);

  // Type checking
  SetMethod(context, exports, "isHeaders", IsHeaders);

  // Router
  SetMethod(context, exports, "createRouter", CreateRouter);
  SetMethod(context, exports, "addRoute", AddRoute);
  SetMethod(context, exports, "matchRoute", MatchRoute);

  // Object pool
  SetMethod(context, exports, "acquireRequest", AcquireRequest);
  SetMethod(context, exports, "releaseRequest", ReleaseRequest);
  SetMethod(context, exports, "acquireResponse", AcquireResponse);
  SetMethod(context, exports, "releaseResponse", ReleaseResponse);
  SetMethod(context, exports, "getObjectPoolStats", GetObjectPoolStats);

  // Feature detection and TCP optimizations
  SetMethod(context, exports, "isIoUringAvailable", IsIoUringAvailable);
  SetMethod(context, exports, "isMimallocAvailable", IsMimallocAvailable);
  SetMethod(context, exports, "applyTcpListenOpts", ApplyTcpListenOpts);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  // URL parsing
  registry->Register(ParseUrl);
  registry->Register(ParseQueryString);

  // WebSocket operations
  registry->Register(DecodeWebSocketFrame);
  registry->Register(EncodeWebSocketFrame);

  // Fast response writers
  registry->Register(WriteJsonDirect);
  registry->Register(WriteTextDirect);
  registry->Register(WriteBinaryDirect);
  registry->Register(WriteNotModified);

  // Type checking
  registry->Register(IsHeaders);

  // Router
  registry->Register(CreateRouter);
  registry->Register(AddRoute);
  registry->Register(MatchRoute);

  // Object pool
  registry->Register(AcquireRequest);
  registry->Register(ReleaseRequest);
  registry->Register(AcquireResponse);
  registry->Register(ReleaseResponse);
  registry->Register(GetObjectPoolStats);

  // Feature detection and TCP optimizations
  registry->Register(IsIoUringAvailable);
  registry->Register(IsMimallocAvailable);
  registry->Register(ApplyTcpListenOpts);
}

}  // namespace smol_http
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_http, node::smol_http::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(smol_http, node::smol_http::RegisterExternalReferences)
