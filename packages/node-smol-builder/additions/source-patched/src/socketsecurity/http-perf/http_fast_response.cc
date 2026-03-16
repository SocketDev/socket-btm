#include "http_fast_response.h"
#include "node_buffer.h"
#include "node_internals.h"
#include "response_template.h"
#include "stream_base-inl.h"
#include "util-inl.h"
#include <cstdio>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Uint8Array;
using v8::Value;

// Pre-formatted status lines for instant response.
static const char* GetStatusLine(int status_code) {
  switch (status_code) {
    case 200:
      return "HTTP/1.1 200 OK\r\n";
    case 304:
      return "HTTP/1.1 304 Not Modified\r\n";
    case 404:
      return "HTTP/1.1 404 Not Found\r\n";
    case 500:
      return "HTTP/1.1 500 Internal Server Error\r\n";
    default:
      return nullptr;
  }
}

bool FastResponse::BuildResponse(
    char* buffer,
    size_t buffer_size,
    size_t* out_length,
    int status_code,
    const char* content_type,
    size_t content_length) {
  // Try template-based fast path first.
  const ResponseTemplate* tmpl = nullptr;

  if (strcmp(content_type, "application/json") == 0) {
    tmpl = ResponseTemplate::GetJsonTemplate(status_code);
  } else {
    tmpl = ResponseTemplate::GetBinaryTemplate(status_code);
  }

  if (tmpl != nullptr) {
    // Use template for zero string concatenation.
    std::vector<std::string> values;

    if (strcmp(content_type, "application/json") == 0) {
      // JSON template: {0} = content_length
      values.push_back(std::to_string(content_length));
    } else {
      // Binary template: {0} = content_type, {1} = content_length
      values.push_back(content_type);
      values.push_back(std::to_string(content_length));
    }

    std::string result = tmpl->Fill(values);
    if (result.size() < buffer_size) {
      memcpy(buffer, result.data(), result.size());
      *out_length = result.size();
      return true;
    }
  }

  // Fallback: manual snprintf.
  const char* status_line = GetStatusLine(status_code);
  if (status_line == nullptr) {
    return false;
  }

  int written = snprintf(
    buffer,
    buffer_size,
    "%sContent-Type: %s\r\n"
    "Content-Length: %zu\r\n"
    "\r\n",
    status_line,
    content_type,
    content_length);

  if (written < 0 || static_cast<size_t>(written) >= buffer_size) {
    return false;
  }

  *out_length = static_cast<size_t>(written);
  return true;
}

bool FastResponse::WriteJson(
    Environment* env,
    Local<Object> socket,
    int status_code,
    const char* json_data,
    size_t json_length) {
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  // Build response headers.
  char header_buffer[512];
  size_t header_length = 0;

  if (!BuildResponse(
        header_buffer,
        sizeof(header_buffer),
        &header_length,
        status_code,
        "application/json",
        json_length)) {
    return false;
  }

  // Get socket write function.
  Local<Value> write_fn_val;
  if (!socket->Get(env->context(), env->write_string()).ToLocal(&write_fn_val) ||
      !write_fn_val->IsFunction()) {
    return false;
  }

  // Write headers + body in corked batch.
  // Cork socket.
  Local<Value> cork_fn_val;
  if (socket->Get(env->context(), FIXED_ONE_BYTE_STRING(isolate, "cork"))
        .ToLocal(&cork_fn_val) &&
      cork_fn_val->IsFunction()) {
    Local<v8::Function> cork_fn = cork_fn_val.As<v8::Function>();
    USE(cork_fn->Call(env->context(), socket, 0, nullptr));
  }

  // Write headers.
  Local<Value> header_args[] = {
    Buffer::Copy(isolate, header_buffer, header_length).ToLocalChecked(),
    FIXED_ONE_BYTE_STRING(isolate, "latin1")
  };

  Local<v8::Function> write_fn = write_fn_val.As<v8::Function>();
  USE(write_fn->Call(env->context(), socket, 2, header_args));

  // Write body.
  Local<Value> body_args[] = {
    Buffer::Copy(isolate, json_data, json_length).ToLocalChecked(),
    FIXED_ONE_BYTE_STRING(isolate, "utf8")
  };

  USE(write_fn->Call(env->context(), socket, 2, body_args));

  // Uncork socket.
  Local<Value> uncork_fn_val;
  if (socket->Get(env->context(), FIXED_ONE_BYTE_STRING(isolate, "uncork"))
        .ToLocal(&uncork_fn_val) &&
      uncork_fn_val->IsFunction()) {
    Local<v8::Function> uncork_fn = uncork_fn_val.As<v8::Function>();
    USE(uncork_fn->Call(env->context(), socket, 0, nullptr));
  }

  return true;
}

bool FastResponse::WriteBinary(
    Environment* env,
    Local<Object> socket,
    int status_code,
    const uint8_t* data,
    size_t length,
    const char* content_type) {
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  // Build response headers.
  char header_buffer[512];
  size_t header_length = 0;

  if (!BuildResponse(
        header_buffer,
        sizeof(header_buffer),
        &header_length,
        status_code,
        content_type,
        length)) {
    return false;
  }

  // Get socket write function.
  Local<Value> write_fn_val;
  if (!socket->Get(env->context(), env->write_string()).ToLocal(&write_fn_val) ||
      !write_fn_val->IsFunction()) {
    return false;
  }

  // Cork socket.
  Local<Value> cork_fn_val;
  if (socket->Get(env->context(), FIXED_ONE_BYTE_STRING(isolate, "cork"))
        .ToLocal(&cork_fn_val) &&
      cork_fn_val->IsFunction()) {
    Local<v8::Function> cork_fn = cork_fn_val.As<v8::Function>();
    USE(cork_fn->Call(env->context(), socket, 0, nullptr));
  }

  // Write headers.
  Local<Value> header_args[] = {
    Buffer::Copy(isolate, header_buffer, header_length).ToLocalChecked(),
    FIXED_ONE_BYTE_STRING(isolate, "latin1")
  };

  Local<v8::Function> write_fn = write_fn_val.As<v8::Function>();
  USE(write_fn->Call(env->context(), socket, 2, header_args));

  // Write body.
  Local<Value> body_args[] = {
    Buffer::Copy(isolate, reinterpret_cast<const char*>(data), length)
      .ToLocalChecked()
  };

  USE(write_fn->Call(env->context(), socket, 1, body_args));

  // Uncork socket.
  Local<Value> uncork_fn_val;
  if (socket->Get(env->context(), FIXED_ONE_BYTE_STRING(isolate, "uncork"))
        .ToLocal(&uncork_fn_val) &&
      uncork_fn_val->IsFunction()) {
    Local<v8::Function> uncork_fn = uncork_fn_val.As<v8::Function>();
    USE(uncork_fn->Call(env->context(), socket, 0, nullptr));
  }

  return true;
}

bool FastResponse::WriteNotModified(
    Environment* env,
    Local<Object> socket) {
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  const char* response = "HTTP/1.1 304 Not Modified\r\n\r\n";
  size_t length = strlen(response);

  // Get socket write function.
  Local<Value> write_fn_val;
  if (!socket->Get(env->context(), env->write_string()).ToLocal(&write_fn_val) ||
      !write_fn_val->IsFunction()) {
    return false;
  }

  // Write response.
  Local<Value> args[] = {
    Buffer::Copy(isolate, response, length).ToLocalChecked(),
    FIXED_ONE_BYTE_STRING(isolate, "latin1")
  };

  Local<v8::Function> write_fn = write_fn_val.As<v8::Function>();
  USE(write_fn->Call(env->context(), socket, 2, args));

  return true;
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
