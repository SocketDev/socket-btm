// http_v8_binding.cc
// V8 bindings for socketsecurity/http high-performance utilities

#include "http_binding.h"

#include "env-inl.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "util-inl.h"
#include "v8.h"

#include <cstring>

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

// parseUrl(urlString) -> { pathname, query, hash } | null
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

  Local<Object> result = Object::New(isolate);

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

// parseQueryString(queryString) -> { key: value, ... }
void ParseQueryString(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(Object::New(isolate));
    return;
  }

  String::Utf8Value qs_str(isolate, args[0]);
  if (*qs_str == nullptr || qs_str.length() == 0) {
    args.GetReturnValue().Set(Object::New(isolate));
    return;
  }

  // Parse into temporary arrays
  constexpr size_t kMaxPairs = 64;
  std::string_view keys[kMaxPairs];
  std::string_view values[kMaxPairs];

  size_t count = smol::http::ParseQueryString(
      *qs_str, qs_str.length(), keys, values, kMaxPairs);

  Local<Object> result = Object::New(isolate);

  // Decode buffer (reused for all decoding)
  char decode_buf[2048];

  for (size_t i = 0; i < count; ++i) {
    Local<String> key;
    Local<String> value;

    // Decode key if needed
    if (smol::http::NeedsDecoding(keys[i].data(), keys[i].length())) {
      size_t decoded_len = smol::http::DecodeURIComponent(
          keys[i].data(), keys[i].length(), decode_buf);
      key = String::NewFromUtf8(isolate, decode_buf,
          NewStringType::kNormal, decoded_len).ToLocalChecked();
    } else {
      key = String::NewFromUtf8(isolate, keys[i].data(),
          NewStringType::kNormal, keys[i].length()).ToLocalChecked();
    }

    // Decode value if needed
    if (smol::http::NeedsDecoding(values[i].data(), values[i].length())) {
      size_t decoded_len = smol::http::DecodeURIComponent(
          values[i].data(), values[i].length(), decode_buf);
      value = String::NewFromUtf8(isolate, decode_buf,
          NewStringType::kNormal, decoded_len).ToLocalChecked();
    } else {
      value = String::NewFromUtf8(isolate, values[i].data(),
          NewStringType::kNormal, values[i].length()).ToLocalChecked();
    }

    result->Set(context, key, value).Check();
  }

  args.GetReturnValue().Set(result);
}

// decodeURIComponent(str) -> decodedStr
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

  // Quick check if decoding is needed
  if (!smol::http::NeedsDecoding(*str, str.length())) {
    args.GetReturnValue().Set(args[0]);
    return;
  }

  // Decode
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

// normalizeHeaderName(name) -> lowercaseName
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

  // Check for interned header first
  const char* interned = smol::http::GetInternedHeaderName(*name, name.length());
  if (interned) {
    args.GetReturnValue().Set(
        String::NewFromUtf8(isolate, interned).ToLocalChecked());
    return;
  }

  // Normalize in-place (copy to mutable buffer)
  std::vector<char> buf(*name, *name + name.length());
  smol::http::NormalizeHeaderName(buf.data(), buf.size());

  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, buf.data(),
          NewStringType::kNormal, buf.size()).ToLocalChecked());
}

// headerEquals(a, b) -> boolean (case-insensitive comparison)
void HeaderEquals(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 2 || !args[0]->IsString() || !args[1]->IsString()) {
    args.GetReturnValue().Set(false);
    return;
  }

  String::Utf8Value a(isolate, args[0]);
  String::Utf8Value b(isolate, args[1]);

  if (*a == nullptr || *b == nullptr) {
    args.GetReturnValue().Set(false);
    return;
  }

  bool equal = smol::http::HeaderEquals(*a, a.length(), *b, b.length());
  args.GetReturnValue().Set(equal);
}

// ============================================================================
// WebSocket Operations
// ============================================================================

// decodeWebSocketFrame(buffer) -> { opcode, fin, masked, payload, totalLength } | null
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

  Local<Object> result = Object::New(isolate);

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

  // Create payload buffer
  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, frame.payload_len);
  if (frame.payload_len > 0) {
    std::memcpy(ab->Data(), frame.payload, frame.payload_len);
  }
  result->Set(context,
      String::NewFromUtf8Literal(isolate, "payload"),
      Uint8Array::New(ab, 0, frame.payload_len)).Check();

  args.GetReturnValue().Set(result);
}

// encodeWebSocketFrame(data, opcode, fin) -> Buffer
void EncodeWebSocketFrame(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1) {
    args.GetReturnValue().SetNull();
    return;
  }

  // Get payload
  const uint8_t* payload = nullptr;
  size_t payload_len = 0;
  std::vector<uint8_t> str_buffer;

  if (args[0]->IsString()) {
    String::Utf8Value str(isolate, args[0]);
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

  // Get opcode (default: 0x01 = text)
  uint8_t opcode = 0x01;
  if (args.Length() > 1 && args[1]->IsInt32()) {
    opcode = static_cast<uint8_t>(args[1].As<Int32>()->Value());
  }

  // Get fin flag (default: true)
  bool fin = true;
  if (args.Length() > 2 && args[2]->IsBoolean()) {
    fin = args[2].As<Boolean>()->Value();
  }

  // Encode frame
  size_t max_output_len = payload_len + 14;  // Max header size
  std::vector<uint8_t> output(max_output_len);

  size_t frame_len = smol::http::EncodeWebSocketFrame(
      output.data(), output.size(), payload, payload_len, opcode, fin);

  if (frame_len == 0) {
    args.GetReturnValue().SetNull();
    return;
  }

  // Return as Buffer
  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, frame_len);
  std::memcpy(ab->Data(), output.data(), frame_len);
  args.GetReturnValue().Set(Uint8Array::New(ab, 0, frame_len));
}

// unmaskWebSocketPayload(buffer, maskKey) -> void (modifies buffer in-place)
void UnmaskWebSocketPayload(const FunctionCallbackInfo<Value>& args) {
  if (args.Length() < 2 || !args[0]->IsArrayBufferView() || !args[1]->IsUint32()) {
    return;
  }

  Local<ArrayBufferView> view = args[0].As<ArrayBufferView>();
  uint32_t mask_key = args[1].As<Uint32>()->Value();

  // Get direct pointer to buffer data
  void* data = view->Buffer()->Data();
  size_t offset = view->ByteOffset();
  size_t len = view->ByteLength();

  uint8_t* payload = static_cast<uint8_t*>(data) + offset;
  smol::http::UnmaskPayload(payload, len, mask_key);
}

// ============================================================================
// HTTP Response Building
// ============================================================================

// writeJsonResponse(socket, statusCode, jsonString) -> boolean
void WriteJsonResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();

  if (args.Length() < 3) {
    args.GetReturnValue().Set(false);
    return;
  }

  // Get socket's write handle
  Local<Object> socket = args[0].As<Object>();
  if (socket.IsEmpty()) {
    args.GetReturnValue().Set(false);
    return;
  }

  int status = args[1].As<Int32>()->Value();

  String::Utf8Value json(isolate, args[2]);
  if (*json == nullptr) {
    args.GetReturnValue().Set(false);
    return;
  }

  // Build response
  size_t json_len = json.length();
  size_t buffer_size = json_len + 256;  // Headers + body
  std::vector<uint8_t> buffer(buffer_size);

  smol::http::ResponseBuilder builder(buffer.data(), buffer_size);
  bool ok = builder.WriteJsonResponse(status, *json, json_len);

  if (!ok) {
    args.GetReturnValue().Set(false);
    return;
  }

  // Write to socket using internal API
  // This needs to interface with libuv/socket directly
  // For now, return the buffer and let JS handle the write
  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, builder.length);
  std::memcpy(ab->Data(), buffer.data(), builder.length);
  args.GetReturnValue().Set(Uint8Array::New(ab, 0, builder.length));
}

// writeTextResponse(socket, statusCode, text) -> Buffer
void WriteTextResponse(const FunctionCallbackInfo<Value>& args) {
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

// writeBinaryResponse(socket, statusCode, buffer, contentType) -> Buffer
void WriteBinaryResponse(const FunctionCallbackInfo<Value>& args) {
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
  String::Utf8Value ct_str(isolate, args[3]);
  if (*ct_str != nullptr) {
    content_type = *ct_str;
  }

  size_t buffer_size = data_len + 256;
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

// isHeaders(obj) -> boolean
// Check if object is a Headers instance using internal brand check
void IsHeaders(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    args.GetReturnValue().Set(false);
    return;
  }

  Local<Object> obj = args[0].As<Object>();

  // Check for Headers brand using internal class name
  // This is faster than duck-typing
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

// Persistent router storage per isolate
static std::unordered_map<Isolate*, smol::http::TrieRouter*> routers;

// createRouter() -> routerId
void CreateRouter(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  auto* router = new smol::http::TrieRouter();
  routers[isolate] = router;

  args.GetReturnValue().Set(Integer::New(isolate, 1));
}

// addRoute(pattern, handlerId) -> void
void AddRoute(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  auto it = routers.find(isolate);
  if (it == routers.end() || args.Length() < 2) {
    return;
  }

  String::Utf8Value pattern(isolate, args[0]);
  uint32_t handler_id = args[1].As<Uint32>()->Value();

  if (*pattern != nullptr) {
    it->second->Insert(*pattern, pattern.length(), handler_id);
  }
}

// matchRoute(pathname) -> { handlerId, params } | null
void MatchRoute(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  auto it = routers.find(isolate);
  if (it == routers.end() || args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().SetNull();
    return;
  }

  String::Utf8Value pathname(isolate, args[0]);
  if (*pathname == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }

  auto result = it->second->Match(*pathname, pathname.length());

  if (!result.matched) {
    args.GetReturnValue().SetNull();
    return;
  }

  Local<Object> obj = Object::New(isolate);

  obj->Set(context,
      String::NewFromUtf8Literal(isolate, "handlerId"),
      Uint32::New(isolate, result.handler_id)).Check();

  // Build params object
  Local<Object> params = Object::New(isolate);
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
// Module Initialization
// ============================================================================

void Initialize(Local<Object> exports,
                Local<Value> module,
                Local<Context> context,
                void* priv) {
  Environment* env = Environment::GetCurrent(context);
  Isolate* isolate = env->isolate();

  // URL parsing
  env->SetMethod(exports, "parseUrl", ParseUrl);
  env->SetMethod(exports, "parseQueryString", ParseQueryString);
  env->SetMethod(exports, "decodeURIComponent", DecodeURIComponent);

  // Header operations
  env->SetMethod(exports, "normalizeHeaderName", NormalizeHeaderName);
  env->SetMethod(exports, "headerEquals", HeaderEquals);

  // WebSocket operations
  env->SetMethod(exports, "decodeWebSocketFrame", DecodeWebSocketFrame);
  env->SetMethod(exports, "encodeWebSocketFrame", EncodeWebSocketFrame);
  env->SetMethod(exports, "unmaskWebSocketPayload", UnmaskWebSocketPayload);

  // HTTP response building
  env->SetMethod(exports, "writeJsonResponse", WriteJsonResponse);
  env->SetMethod(exports, "writeTextResponse", WriteTextResponse);
  env->SetMethod(exports, "writeBinaryResponse", WriteBinaryResponse);

  // Type checking
  env->SetMethod(exports, "isHeaders", IsHeaders);

  // Router
  env->SetMethod(exports, "createRouter", CreateRouter);
  env->SetMethod(exports, "addRoute", AddRoute);
  env->SetMethod(exports, "matchRoute", MatchRoute);
}

}  // namespace smol_http
}  // namespace node

// External reference registration for snapshot support
NODE_BINDING_EXTERNAL_REFERENCE(smol_http, node::smol_http::RegisterExternalReferences)

void node::smol_http::RegisterExternalReferences(
    ExternalReferenceRegistry* registry) {
  registry->Register(ParseUrl);
  registry->Register(ParseQueryString);
  registry->Register(DecodeURIComponent);
  registry->Register(NormalizeHeaderName);
  registry->Register(HeaderEquals);
  registry->Register(DecodeWebSocketFrame);
  registry->Register(EncodeWebSocketFrame);
  registry->Register(UnmaskWebSocketPayload);
  registry->Register(WriteJsonResponse);
  registry->Register(WriteTextResponse);
  registry->Register(WriteBinaryResponse);
  registry->Register(IsHeaders);
  registry->Register(CreateRouter);
  registry->Register(AddRoute);
  registry->Register(MatchRoute);
}

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_http, node::smol_http::Initialize)
