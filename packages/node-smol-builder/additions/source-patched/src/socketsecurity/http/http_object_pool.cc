// Suppress V8-internal deprecation warning for Object::GetIsolate()
// called from v8-object.h static method (not our code).
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/http/http_object_pool.h"
#include "env-inl.h"
#include "node_internals.h"
#include "util-inl.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::Context;
using v8::EscapableHandleScope;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Object;
using v8::String;
using v8::Value;

HttpObjectPool::HttpObjectPool(Environment* env) : env_(env) {}

HttpObjectPool::~HttpObjectPool() {
  Clear();
}

Local<Object> HttpObjectPool::AcquireRequest() {
  Isolate* isolate = env_->isolate();
  // EscapableHandleScope: this function returns a Local<Object> out of the
  // scope, so we must Escape() it before the scope destructor reclaims its
  // handle slot. A plain HandleScope would leave the caller with a dangling
  // handle pointing at a reused slot.
  EscapableHandleScope scope(isolate);

  requests_acquired_++;

  // Reuse from pool if available.
  if (!request_pool_.empty()) {
    v8::Global<Object> global_obj = std::move(request_pool_.back());
    request_pool_.pop_back();

    Local<Object> obj = global_obj.Get(isolate);
    ResetRequest(env_, obj);
    return scope.Escape(obj);
  }

  // Pool empty: create new object.
  Local<Object> req = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  // HISTORY: WHY FIXED_ONE_BYTE_STRING
  // V8 has two internal string encodings: one-byte (Latin-1, covers code
  // points 0-255, 1 byte per char) and two-byte (UTF-16, 2 bytes per char).
  // FIXED_ONE_BYTE_STRING creates one-byte strings for ASCII/Latin-1
  // constants, avoiding the 2x memory cost of UTF-16 and enabling faster
  // comparison. For property names created thousands of times per second
  // (like "value", "done", "status"), this matters.

  // Initialize with null properties (will be set by HTTP layer).
  Local<Context> context = env_->context();
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "method"),
    v8::Null(isolate)).Check();
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "url"),
    v8::Null(isolate)).Check();
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "headers"),
    v8::Null(isolate)).Check();

  return scope.Escape(req);
}

Local<Object> HttpObjectPool::AcquireResponse() {
  Isolate* isolate = env_->isolate();
  // EscapableHandleScope: see AcquireRequest for rationale. Returning a
  // Local<Object> out of a plain HandleScope leaves the caller holding a
  // dangling handle.
  EscapableHandleScope scope(isolate);

  responses_acquired_++;

  // Reuse from pool if available.
  if (!response_pool_.empty()) {
    v8::Global<Object> global_obj = std::move(response_pool_.back());
    response_pool_.pop_back();

    Local<Object> obj = global_obj.Get(isolate);
    ResetResponse(env_, obj);
    return scope.Escape(obj);
  }

  // Pool empty: create new object.
  Local<Object> res = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  // Initialize with null properties.
  Local<Context> context = env_->context();
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "statusCode"),
    v8::Integer::New(isolate, 200)).Check();
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "statusMessage"),
    v8::Null(isolate)).Check();
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "headers"),
    v8::Null(isolate)).Check();

  return scope.Escape(res);
}

void HttpObjectPool::ReleaseRequest(Local<Object> req) {
  Isolate* isolate = env_->isolate();
  HandleScope scope(isolate);

  requests_released_++;

  // Don't grow pool beyond max size.
  if (request_pool_.size() >= kMaxRequestPoolSize) {
    return;
  }

  // Reset and return to pool.
  ResetRequest(env_, req);
  request_pool_.emplace_back(isolate, req);
}

void HttpObjectPool::ReleaseResponse(Local<Object> res) {
  Isolate* isolate = env_->isolate();
  HandleScope scope(isolate);

  responses_released_++;

  // Don't grow pool beyond max size.
  if (response_pool_.size() >= kMaxResponsePoolSize) {
    return;
  }

  // Reset and return to pool.
  ResetResponse(env_, res);
  response_pool_.emplace_back(isolate, res);
}

void HttpObjectPool::Clear() {
  request_pool_.clear();
  response_pool_.clear();
}

void HttpObjectPool::ResetRequest(Environment* env, Local<Object> req) {
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();

  // Reset all properties to null/default.
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "method"),
    v8::Null(isolate)).Check();
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "url"),
    v8::Null(isolate)).Check();
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "headers"),
    v8::Null(isolate)).Check();
  req->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "body"),
    v8::Null(isolate)).Check();
}

void HttpObjectPool::ResetResponse(Environment* env, Local<Object> res) {
  Isolate* isolate = env->isolate();
  Local<Context> context = env->context();

  // Reset all properties to null/default.
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "statusCode"),
    v8::Integer::New(isolate, 200)).Check();
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "statusMessage"),
    v8::Null(isolate)).Check();
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "headers"),
    v8::Null(isolate)).Check();
  res->Set(
    context,
    FIXED_ONE_BYTE_STRING(isolate, "finished"),
    v8::Boolean::New(isolate, false)).Check();
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#pragma GCC diagnostic pop
