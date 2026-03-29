// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/http/http_header_pool.h"
#include "env-inl.h"
#include "node_internals.h"
#include "util-inl.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::Isolate;
using v8::Local;
using v8::String;

HttpHeaderPool::HttpHeaderPool(Environment* env) : env_(env) {}

HttpHeaderPool::~HttpHeaderPool() {}

void HttpHeaderPool::Initialize() {
  Isolate* isolate = env_->isolate();

  // Pre-allocate common header names.
  content_type_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "content-type"));
  content_length_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "content-length"));
  connection_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "connection"));
  date_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "date"));
  server_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "server"));
  cache_control_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "cache-control"));
  etag_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "etag"));
  last_modified_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "last-modified"));
  transfer_encoding_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "transfer-encoding"));
  vary_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "vary"));

  // Pre-allocate common header values.
  application_json_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "application/json"));
  text_plain_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "text/plain"));
  keep_alive_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "keep-alive"));
  close_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "close"));
  chunked_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "chunked"));
  no_cache_.Set(isolate, FIXED_ONE_BYTE_STRING(isolate, "no-cache"));
}

Local<String> HttpHeaderPool::GetHeaderName(const char* name) const {
  Isolate* isolate = env_->isolate();

  // Fast path: check common headers.
  if (strcmp(name, "content-type") == 0) {
    return content_type_.Get(isolate);
  }
  if (strcmp(name, "content-length") == 0) {
    return content_length_.Get(isolate);
  }
  if (strcmp(name, "connection") == 0) {
    return connection_.Get(isolate);
  }
  if (strcmp(name, "date") == 0) {
    return date_.Get(isolate);
  }
  if (strcmp(name, "server") == 0) {
    return server_.Get(isolate);
  }
  if (strcmp(name, "cache-control") == 0) {
    return cache_control_.Get(isolate);
  }
  if (strcmp(name, "etag") == 0) {
    return etag_.Get(isolate);
  }
  if (strcmp(name, "last-modified") == 0) {
    return last_modified_.Get(isolate);
  }
  if (strcmp(name, "transfer-encoding") == 0) {
    return transfer_encoding_.Get(isolate);
  }
  if (strcmp(name, "vary") == 0) {
    return vary_.Get(isolate);
  }

  // Not in pool.
  return Local<String>();
}

Local<String> HttpHeaderPool::GetHeaderValue(const char* value) const {
  Isolate* isolate = env_->isolate();

  // Fast path: check common values.
  if (strcmp(value, "application/json") == 0) {
    return application_json_.Get(isolate);
  }
  if (strcmp(value, "text/plain") == 0) {
    return text_plain_.Get(isolate);
  }
  if (strcmp(value, "keep-alive") == 0) {
    return keep_alive_.Get(isolate);
  }
  if (strcmp(value, "close") == 0) {
    return close_.Get(isolate);
  }
  if (strcmp(value, "chunked") == 0) {
    return chunked_.Get(isolate);
  }
  if (strcmp(value, "no-cache") == 0) {
    return no_cache_.Get(isolate);
  }

  // Not in pool.
  return Local<String>();
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
