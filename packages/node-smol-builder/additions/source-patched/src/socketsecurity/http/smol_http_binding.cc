// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// ============================================================================
// smol_http_binding.cc — The bridge between JavaScript and C++
// ============================================================================
//
// WHAT THIS FILE DOES
// This is the single entry point that connects all C++ HTTP utilities to
// JavaScript. When JS code calls `internalBinding('smol_http')`, V8 runs the
// Initialize() function at the bottom of this file, which registers every
// C++ function so JS can call it by name. At runtime, calling e.g.
// `smolHttp.parseUrl('/foo?bar=1')` in JS invokes the C++ ParseUrl()
// function defined here, which does the work and returns a JS object.
//
// WHY IT EXISTS (why C++ instead of JS?)
// Parsing URLs, comparing headers, encoding WebSocket frames, and writing
// HTTP responses are all called thousands of times per second on a busy
// server. Doing this work in C++ avoids V8 garbage collection pauses,
// enables SIMD acceleration, and allows direct OS-level socket writes
// (uv_try_write) that skip Node.js's entire Writable stream pipeline.
//
// HOW JS USES THIS
// JS: `const binding = internalBinding('smol_http');`
//     `binding.parseUrl('/path?q=1')` => { pathname: '/path', query: 'q=1' }
//     `binding.headerEquals('Content-Type', 'content-type')` => true
//     `binding.writeJsonResponse(socket, 200, '{"ok":true}')` => true
//
// KEY V8 CONCEPTS USED IN THIS FILE
//
// Isolate (v8::Isolate*)
//   A single instance of the V8 JavaScript engine. Each Node.js worker
//   thread gets its own Isolate. Think of it as "which JS engine am I
//   talking to?" You need it to create any JS value from C++.
//
// HandleScope (v8::HandleScope)
//   A stack-based guard that tells V8 "I'm creating temporary JS values
//   in this block." When the HandleScope is destroyed (goes out of scope),
//   V8 knows it can garbage-collect any Local<T> handles created inside it.
//   Every function that creates JS values must have one.
//
// Local<T> (v8::Local<T>)
//   A pointer to a JS value on V8's managed heap. "Local" means it only
//   lives as long as the enclosing HandleScope. Think of it as a smart
//   pointer — you never free it manually; the HandleScope does that.
//   Example: Local<String> is a JS string, Local<Object> is a JS object.
//
// FunctionCallbackInfo<Value> (v8::FunctionCallbackInfo<Value>&)
//   The "args" object passed to every C++ function that JS can call.
//   `args[0]`, `args[1]`, etc. are the JS arguments. Use
//   `args.GetReturnValue().Set(...)` to return a value to JS.
//   Think of it as the C++ equivalent of `function(arg0, arg1) { return ... }`.
//
// Context (v8::Context)
//   The JS execution environment (global object, built-ins). Needed when
//   setting properties on objects, because `obj->Set(context, key, value)`
//   could trigger JS getters/setters that need a running context.
//
// Environment (node::Environment*)
//   Node.js's per-Isolate state bag: the event loop, cleanup hooks, binding
//   registry, and more. Not a V8 type — it's Node.js's addition on top of V8.
//
// SetMethod / SetFastMethod
//   Node.js helpers that register a C++ function so JS can call it.
//   `SetMethod(context, exports, "parseUrl", ParseUrl)` makes
//   `binding.parseUrl(...)` available in JS.
//
// V8 Fast API (SetFastMethodNoSideEffect + CFunction)
//   V8 can call specially-annotated C++ functions directly from JIT-compiled
//   JavaScript, bypassing the normal argument marshaling overhead. This is
//   roughly 10-100x faster for simple functions like headerEquals() or
//   matchRoute(). The "Slow" version is the fallback when the fast path
//   cannot be used (e.g., when the function needs to create JS objects).
// ============================================================================

#include "socketsecurity/http/http_binding.h"
#include "socketsecurity/http/fast_304_response.h"
#include "socketsecurity/http/http_fast_response.h"
#include "socketsecurity/http/http_object_pool.h"
#include "socketsecurity/http/iouring_network.h"
#include "socketsecurity/http/mimalloc_allocator.h"
#include "socketsecurity/http/tcp_optimizations.h"
#include "socketsecurity/http/uws_server.h"

#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "node_debug.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "stream_base-inl.h"
#include "util-inl.h"
#include "v8.h"
#include "v8-fast-api-calls.h"

#include <cstdio>
#include <new>
#include <cstring>
#include <unordered_map>
#include <vector>

namespace node {
namespace smol_http {

// -- V8 type aliases --
// These `using` statements let us write `Local<String>` instead of
// `v8::Local<v8::String>` throughout the file. Pure convenience.
using v8::Array;
using v8::ArrayBuffer;
using v8::ArrayBufferView;
using v8::Boolean;
using v8::Context;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Global;            // A persistent handle that survives across HandleScopes
using v8::HandleScope;
using v8::Int32;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;        // Like Local<T> but can be empty (the "Maybe" pattern)
using v8::NewStringType;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::ObjectTemplate;
using v8::String;
using v8::Uint32;
using v8::Uint8Array;
using v8::Value;             // Base type — every JS value is a Value
using v8::CFunction;         // Wraps a C++ function pointer for V8 Fast API
using v8::FastApiCallbackOptions;  // Options struct passed to fast-path functions
using v8::FastOneByteString; // A string that V8 guarantees is ASCII (latin1)

// ============================================================================
// URL Parsing
//
// JS calls: binding.parseUrl('/path?query=1#hash')
// Returns:  { pathname: '/path', query: 'query=1', hash: 'hash' }
//
// Why C++? URL parsing happens on every single HTTP request. The C++
// implementation uses zero-allocation string_view slicing instead of
// creating new JS strings for intermediate results.
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
//
// HTTP headers are case-insensitive ("Content-Type" == "content-type").
// These functions normalize and compare header names efficiently.
//
// headerEquals() has both a "slow" path (normal V8 call) and a "fast" path
// (V8 Fast API). V8 automatically picks the fast path when it can, which
// avoids all the argument unpacking overhead.
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

void SlowHeaderEquals(const FunctionCallbackInfo<Value>& args) {
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

bool FastHeaderEquals(Local<Value> receiver,
                      const FastOneByteString& a,
                      const FastOneByteString& b,
                      // NOLINTNEXTLINE(runtime/references)
                      FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_http.headerEquals");
  return smol::http::HeaderEquals(a.data, a.length, b.data, b.length);
}

static CFunction fast_header_equals(CFunction::Make(FastHeaderEquals));

// ============================================================================
// WebSocket Operations
//
// WebSocket frames have a binary format: a 2-14 byte header followed by
// payload data. Client-to-server frames are "masked" (XORed with a 4-byte
// key) for security. These functions encode/decode that binary format.
//
// JS calls: binding.decodeWebSocketFrame(buffer)
// Returns:  { opcode, fin, masked, totalLength, payload }
//
// JS calls: binding.encodeWebSocketFrame(data, opcode, fin)
// Returns:  Uint8Array containing the complete frame
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
// Response Building (buffer-based -- returns buffer for JS to write)
//
// These functions assemble a complete HTTP response (status line + headers +
// body) into a single Uint8Array buffer. JS can then write that buffer to
// the socket in one call, which is much faster than writing status, headers,
// and body separately (each write = 1 syscall).
//
// JS calls: binding.buildJsonResponse(socket, 200, '{"ok":true}')
// Returns:  Uint8Array containing "HTTP/1.1 200 OK\r\nContent-Type: ..."
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
//
// A trie router is a tree data structure for fast URL matching. Instead of
// checking every registered route pattern one by one (O(n) where n = number
// of routes), the trie walks the URL path segments character by character
// (O(path length), independent of how many routes exist).
//
// Example: routes /users, /users/:id, /posts/*
//   root -> "users" -> (handler)
//                   -> :param -> (handler)  -- matches /users/42
//        -> "posts" -> *wildcard -> (handler)  -- matches /posts/anything/here
//
// The router uses thread_local storage so each Node.js worker thread gets
// its own independent router instance. A cleanup hook frees the router
// when the Environment (worker) is destroyed.
//
// matchRoute() has a V8 Fast API path: for static routes (no :params),
// it returns just the handler ID as a uint32, avoiding JS object creation.
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

void SlowMatchRoute(const FunctionCallbackInfo<Value>& args) {
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

  // Fast path: paramless routes (/, /json, /health) return just the
  // integer handler ID. This avoids creating a JS object + params object
  // on every request for static routes. The JS side checks:
  //   typeof routeMatch === 'number' -> fast path (no params)
  //   typeof routeMatch === 'object' -> has params
  if (result.param_count == 0) {
    args.GetReturnValue().Set(Uint32::New(isolate, result.handler_id));
    return;
  }

  // Slow path: parameterized routes (/user/:id) return full object.
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

// V8 Fast API path for matchRoute — handles paramless routes only.
// Returns handler_id directly as uint32_t. Falls back to slow path for:
//   - no router configured
//   - no match
//   - route has parameters (needs JS object construction)
uint32_t FastMatchRoute(Local<Value> receiver,
                        const FastOneByteString& pathname,
                        // NOLINTNEXTLINE(runtime/references)
                        FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_http.matchRoute");
  auto* router = tl_router;
  if (router == nullptr) {
    return 0;
  }

  auto result = router->Match(pathname.data, pathname.length);

  if (!result.matched || result.param_count > 0) {
    // No match or parameterized route — return 0 (no handler).
    // JS caller must handle 0 the same as slow path's null.
    return 0;
  }

  return result.handler_id;
}

static CFunction fast_match_route(CFunction::Make(FastMatchRoute));

// ============================================================================
// Fast Response Writers (UV stream -- writes directly to socket)
//
// These are the fastest possible response path. Instead of going through
// Node.js's JavaScript HTTP response pipeline (cork -> write headers ->
// write body -> uncork -> flush), they:
//   1. Build the entire HTTP response in a C stack buffer (no heap allocation)
//   2. Get the raw OS socket handle from the JS socket object
//   3. Call uv_try_write() -- a single synchronous system call
//
// "UV stream" = libuv's abstraction for a network socket. libuv is the C
// library that Node.js uses for all async I/O. A uv_stream_t* is like a
// Writable stream but at the OS level -- it wraps a file descriptor (fd).
//
// JS calls: binding.writeJsonResponse(socket, 200, '{"ok":true}')
// Returns:  true if the write succeeded, false if JS fallback is needed
// ============================================================================

using socketsecurity::http_perf::FastResponse;
using socketsecurity::http_perf::Fast304Response;
using socketsecurity::http_perf::HttpObjectPool;
using socketsecurity::http_perf::IoUringNetwork;
using socketsecurity::http_perf::MimallocArrayBufferAllocator;

// writeJsonDirect(socket, statusCode, jsonString) -> boolean
void SlowWriteJsonDirect(const FunctionCallbackInfo<Value>& args) {
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
void SlowWriteBinaryDirect(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 4 || !args[0]->IsObject() || !args[1]->IsInt32() ||
      !args[2]->IsUint8Array() || !args[3]->IsString()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  int status_code = args[1].As<Int32>()->Value();

  // Use Buffer::Data directly — avoids shared_ptr overhead of GetBackingStore().
  const uint8_t* data = reinterpret_cast<const uint8_t*>(
    Buffer::Data(args[2]));
  size_t length = Buffer::Length(args[2]);

  v8::String::Utf8Value content_type(env->isolate(), args[3]);
  if (*content_type == nullptr) {
    return;
  }

  bool success = FastResponse::WriteBinary(
    env, socket, status_code, data, length, *content_type);

  args.GetReturnValue().Set(success);
}

// writeNotModified(socket) -> boolean
void SlowWriteNotModified(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 1 || !args[0]->IsObject()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();
  bool success = FastResponse::WriteNotModified(env, socket);
  args.GetReturnValue().Set(success);
}

// writeTextDirect(socket, statusCode, text) -> boolean
void SlowWriteTextDirect(const FunctionCallbackInfo<Value>& args) {
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

  bool success = FastResponse::WriteText(
    env, socket, status_code, *text, text.length());

  args.GetReturnValue().Set(success);
}

// writePrecomputed(socket, buffer) -> boolean
// Writes a pre-computed Buffer directly to the UV stream.
// Used for HTTP_200_EMPTY, HTTP_404, HTTP_500, etc.
void SlowWritePrecomputed(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);

  if (args.Length() < 2 || !args[0]->IsObject()) {
    return;
  }

  Local<Object> socket = args[0].As<Object>();

  // Accept Buffer or Uint8Array
  if (!args[1]->IsUint8Array() && !Buffer::HasInstance(args[1])) {
    return;
  }

  const char* data = Buffer::Data(args[1]);
  size_t length = Buffer::Length(args[1]);

  bool success = FastResponse::WritePrecomputed(env, socket, data, length);
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
//
// An object pool pre-allocates objects and reuses them instead of creating
// new ones for each request. This reduces garbage collection (GC) pressure
// because V8 doesn't have to constantly allocate and free request/response
// objects. Think of it like a library book checkout system -- books are
// returned and re-lent rather than printed and shredded for each reader.
//
// The pool is backed by C++ (HttpObjectPool) so the V8 objects maintain
// stable "hidden classes" (V8's internal optimization for object shapes).
// When every request object has the same properties in the same order,
// V8 can generate much faster machine code for accessing those properties.
//
// JS calls: binding.acquireRequest()  -> pooled request object
//           binding.releaseRequest(req)  -> returns it to the pool
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
    tl_object_pool = new (std::nothrow) HttpObjectPool(env);
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
// Feature Detection & TCP Optimizations
//
// These functions detect platform capabilities (io_uring on Linux, mimalloc)
// and apply low-level TCP socket options that improve server performance:
//
// - TCP_FASTOPEN: Sends data in the SYN packet, saving 1 round-trip
// - TCP_DEFER_ACCEPT: Delays accept() until the client sends data
// - SO_SNDBUF/SO_RCVBUF: Enlarges socket buffers for high throughput
//
// applyTcpListenOpts() has a V8 Fast API path because it's called once
// per server socket and the fd (file descriptor) is a simple integer.
// ============================================================================

// Apply TCP listen socket optimizations directly via setsockopt on an fd.
// Called from JS: smolHttpBinding.applyTcpListenOpts(fd)
static bool ApplyTcpListenOptsImpl(int fd) {
  if (fd < 0) return false;
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

  return any_ok;
}

void SlowApplyTcpListenOpts(const FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 1 || !args[0]->IsInt32()) {
    args.GetReturnValue().Set(false);
    return;
  }
  int fd = args[0].As<v8::Int32>()->Value();
  args.GetReturnValue().Set(ApplyTcpListenOptsImpl(fd));
}

bool FastApplyTcpListenOpts(Local<Value> receiver,
                            int32_t fd,
                            // NOLINTNEXTLINE(runtime/references)
                            FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_http.applyTcpListenOpts");
  return ApplyTcpListenOptsImpl(fd);
}

static CFunction fast_apply_tcp_listen_opts(
    CFunction::Make(FastApplyTcpListenOpts));

void SlowIsIoUringAvailable(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(IoUringNetwork::IsAvailable());
}

bool FastIsIoUringAvailable(Local<Value> receiver) {
  TRACK_V8_FAST_API_CALL("smol_http.isIoUringAvailable");
  return IoUringNetwork::IsAvailable();
}

static CFunction fast_is_io_uring_available(
    CFunction::Make(FastIsIoUringAvailable));

void SlowIsMimallocAvailable(const FunctionCallbackInfo<Value>& args) {
  args.GetReturnValue().Set(
      MimallocArrayBufferAllocator::IsMimallocAvailable());
}

bool FastIsMimallocAvailable(Local<Value> receiver) {
  TRACK_V8_FAST_API_CALL("smol_http.isMimallocAvailable");
  return MimallocArrayBufferAllocator::IsMimallocAvailable();
}

static CFunction fast_is_mimalloc_available(
    CFunction::Make(FastIsMimallocAvailable));

// ============================================================================
// Module Initialization -- this is where JS meets C++
//
// When JavaScript calls `internalBinding('smol_http')`, V8 invokes
// Initialize() exactly once. This function registers every C++ function
// onto the `exports` object, making them callable from JS.
//
// SetMethod(context, exports, "name", CppFunction)
//   Registers CppFunction so JS can call `binding.name(...)`.
//   Every call goes through V8's normal argument marshaling.
//
// SetFastMethodNoSideEffect(context, exports, "name", SlowFn, &fastFn)
//   Registers BOTH a slow path and a fast path. V8's JIT compiler can
//   call the fast C++ function directly from generated machine code,
//   skipping all the FunctionCallbackInfo overhead. The "NoSideEffect"
//   means V8 knows this function is pure (no writes to JS heap), so it
//   can be called speculatively during optimization.
//
// RegisterExternalReferences() is called during V8 snapshot creation
// (for faster Node.js startup). It tells the snapshot builder about
// every C++ function pointer that might appear in the snapshot.
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

  // Response writers — slow-path only because FastResponse::Write*() calls
  // Object::Get() on the socket to extract the UV stream handle, which
  // triggers JS heap access and violates the V8 fast call contract.
  SetMethod(context, exports, "writeJsonResponse", SlowWriteJsonDirect);
  SetMethod(context, exports, "writeTextResponse", SlowWriteTextDirect);
  SetMethod(context, exports, "writeBinaryResponse", SlowWriteBinaryDirect);
  SetMethod(context, exports, "writeNotModifiedResponse", SlowWriteNotModified);
  SetMethod(context, exports, "writePrecomputed", SlowWritePrecomputed);

  // Type checking
  SetMethod(context, exports, "isHeaders", IsHeaders);

  // HISTORY: WHY V8 FAST API (SetFastMethod)
  // V8's Fast API Calls were introduced in V8 v8.7 (Chrome 87, ~2020).
  // Normal JS-to-C++ calls go through a generic callback that boxes/unboxes
  // arguments. Fast API calls let V8's JIT compiler call C++ directly with
  // native types, skipping the boxing overhead — ~10-100x faster for hot paths.
  // Fast API functions must not trigger GC, JS execution, or arbitrary V8
  // reentry. "NoSideEffect" marks the callback as safe for V8's side-effect-
  // checking debug evaluation (the throwOnSideEffect debugger contract).
  // Lying about side effects breaks DevTools inspect behavior.

  // Header comparison
  SetFastMethodNoSideEffect(context, exports, "headerEquals",
                            SlowHeaderEquals, &fast_header_equals);

  // Router
  SetMethod(context, exports, "createRouter", CreateRouter);
  SetMethod(context, exports, "addRoute", AddRoute);
  SetFastMethodNoSideEffect(context, exports, "matchRoute",
                            SlowMatchRoute, &fast_match_route);

  // Object pool
  SetMethod(context, exports, "acquireRequest", AcquireRequest);
  SetMethod(context, exports, "releaseRequest", ReleaseRequest);
  SetMethod(context, exports, "acquireResponse", AcquireResponse);
  SetMethod(context, exports, "releaseResponse", ReleaseResponse);
  SetMethod(context, exports, "getObjectPoolStats", GetObjectPoolStats);

  // Feature detection and TCP optimizations
  SetFastMethodNoSideEffect(context, exports, "isIoUringAvailable",
                            SlowIsIoUringAvailable,
                            &fast_is_io_uring_available);
  SetFastMethodNoSideEffect(context, exports, "isMimallocAvailable",
                            SlowIsMimallocAvailable,
                            &fast_is_mimalloc_available);
  SetFastMethod(context, exports, "applyTcpListenOpts",
                SlowApplyTcpListenOpts, &fast_apply_tcp_listen_opts);

  // uWebSockets-backed server
  SetMethod(context, exports, "createUwsServer", CreateUwsServer);
  SetMethod(context, exports, "uwsServerAddRoute", UwsServerAddRoute);
  SetMethod(context, exports, "uwsServerListen", UwsServerListen);
  SetMethod(context, exports, "uwsServerStop", UwsServerStop);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  // URL parsing
  registry->Register(ParseUrl);
  registry->Register(ParseQueryString);

  // WebSocket operations
  registry->Register(DecodeWebSocketFrame);
  registry->Register(EncodeWebSocketFrame);

  // Response writers (slow-path only — FastResponse accesses JS heap)
  registry->Register(SlowWriteJsonDirect);
  registry->Register(SlowWriteTextDirect);
  registry->Register(SlowWriteBinaryDirect);
  registry->Register(SlowWriteNotModified);
  registry->Register(SlowWritePrecomputed);

  // Type checking
  registry->Register(IsHeaders);

  // Header comparison (slow + fast paths)
  registry->Register(SlowHeaderEquals);
  registry->Register(fast_header_equals);

  // Router
  registry->Register(CreateRouter);
  registry->Register(AddRoute);
  registry->Register(SlowMatchRoute);
  registry->Register(fast_match_route);

  // Object pool
  registry->Register(AcquireRequest);
  registry->Register(ReleaseRequest);
  registry->Register(AcquireResponse);
  registry->Register(ReleaseResponse);
  registry->Register(GetObjectPoolStats);

  // Feature detection and TCP optimizations (slow + fast paths)
  registry->Register(SlowIsIoUringAvailable);
  registry->Register(fast_is_io_uring_available);
  registry->Register(SlowIsMimallocAvailable);
  registry->Register(fast_is_mimalloc_available);
  registry->Register(SlowApplyTcpListenOpts);
  registry->Register(fast_apply_tcp_listen_opts);

  // uWebSockets-backed server
  registry->Register(CreateUwsServer);
  registry->Register(UwsServerAddRoute);
  registry->Register(UwsServerListen);
  registry->Register(UwsServerStop);
}

}  // namespace smol_http
}  // namespace node

// These two macros register this file as a Node.js internal binding.
// NODE_BINDING_CONTEXT_AWARE_INTERNAL: tells Node.js "when JS calls
//   internalBinding('smol_http'), call our Initialize() function."
// NODE_BINDING_EXTERNAL_REFERENCE: tells the V8 snapshot builder about
//   our C++ function pointers so they survive serialization.
NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_http, node::smol_http::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(smol_http, node::smol_http::RegisterExternalReferences)

#pragma GCC diagnostic pop
