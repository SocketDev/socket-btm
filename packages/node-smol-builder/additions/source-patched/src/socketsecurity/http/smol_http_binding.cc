// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// ============================================================================
// smol_http_binding.cc — The bridge between JavaScript and C++
// ============================================================================
//
// WHAT THIS FILE DOES
// This is the single entry point that connects the C++ HTTP runtime to
// JavaScript. When JS code calls `internalBinding('smol_http')`, V8 runs the
// Initialize() function at the bottom of this file, which registers every
// C++ function so JS can call it by name.
//
// WHAT LIVES HERE
//   * Fast response writers — write JSON/text/binary/304/precomputed bodies
//     straight to the UV stream, skipping Node's Writable pipeline.
//   * HTTP object pool — reusable request/response objects with stable
//     hidden classes so V8 can inline property accesses.
//   * Feature detection — isIoUringAvailable / isMimallocAvailable, both
//     exposed via the V8 Fast API so JIT callers pay zero marshaling cost.
//   * uWebSockets-backed server — createUwsServer / uwsServerAddRoute /
//     uwsServerListen / uwsServerStop.
//
// KEY V8 CONCEPTS USED IN THIS FILE
//
// Isolate (v8::Isolate*)
//   A single instance of the V8 JavaScript engine. Each Node.js worker
//   thread gets its own Isolate. Think of it as "which JS engine am I
//   talking to?" You need it to create any JS value from C++.
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
//
// V8 Fast API (SetFastMethodNoSideEffect + CFunction)
//   V8 can call specially-annotated C++ functions directly from JIT-compiled
//   JavaScript, bypassing argument marshaling. ~10-100x faster for hot
//   paths. The "Slow" version is the fallback when the fast path cannot
//   be used (e.g., when the function needs to create JS objects).
// ============================================================================

#include "socketsecurity/http/http_fast_response.h"
#include "socketsecurity/http/http_object_pool.h"
#include "socketsecurity/http/iouring_network.h"
#include "socketsecurity/http/mimalloc_allocator.h"
#include "socketsecurity/http/uws_server.h"

#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "node_debug.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "v8.h"
#include "v8-fast-api-calls.h"

#include <new>

namespace node {
namespace smol_http {

// -- V8 type aliases --
// These `using` statements let us write `Local<String>` instead of
// `v8::Local<v8::String>` throughout the file. Pure convenience.
using v8::CFunction;         // Wraps a C++ function pointer for V8 Fast API
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Int32;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Object;
using v8::String;
using v8::Value;             // Base type — every JS value is a Value

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
    // Nothrow + null-check so OOM doesn't get silently registered as a
    // nullptr cleanup hook. Callers are responsible for surfacing the
    // nullptr to JS; here we just report the failure state.
    tl_object_pool = new (std::nothrow) HttpObjectPool(env);
    if (tl_object_pool != nullptr) {
      env->AddCleanupHook(ObjectPoolCleanup, tl_object_pool);
    }
  }
  return tl_object_pool;
}

// Throws a JS Error and returns true when GetObjectPool's allocation
// failed. Callers should early-return when this returns true. Keeps the
// repeated Acquire/Release binding bodies terse.
static bool CheckObjectPoolOrThrow(
    v8::Isolate* isolate, const HttpObjectPool* pool) {
  if (pool == nullptr) {
    isolate->ThrowException(v8::Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate,
            "Out of memory: failed to allocate HTTP object pool")));
    return true;
  }
  return false;
}

void AcquireRequest(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  HttpObjectPool* pool = GetObjectPool(env);
  if (CheckObjectPoolOrThrow(env->isolate(), pool)) return;
  Local<Object> req = pool->AcquireRequest();
  args.GetReturnValue().Set(req);
}

void ReleaseRequest(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  if (args.Length() < 1 || !args[0]->IsObject()) return;
  HttpObjectPool* pool = GetObjectPool(env);
  if (CheckObjectPoolOrThrow(env->isolate(), pool)) return;
  pool->ReleaseRequest(args[0].As<Object>());
}

void AcquireResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  HttpObjectPool* pool = GetObjectPool(env);
  if (CheckObjectPoolOrThrow(env->isolate(), pool)) return;
  Local<Object> res = pool->AcquireResponse();
  args.GetReturnValue().Set(res);
}

void ReleaseResponse(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  if (args.Length() < 1 || !args[0]->IsObject()) return;
  HttpObjectPool* pool = GetObjectPool(env);
  if (CheckObjectPoolOrThrow(env->isolate(), pool)) return;
  pool->ReleaseResponse(args[0].As<Object>());
}

void GetObjectPoolStats(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  HttpObjectPool* pool = GetObjectPool(env);
  if (CheckObjectPoolOrThrow(isolate, pool)) return;

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
//
// Detects platform capabilities (io_uring on Linux, mimalloc). Exposed to
// JS via V8 Fast API paths because these are called once at startup and
// return a simple boolean.
// ============================================================================

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
  // Response writers — slow-path only because FastResponse::Write*() calls
  // Object::Get() on the socket to extract the UV stream handle, which
  // triggers JS heap access and violates the V8 fast call contract.
  SetMethod(context, exports, "writeJsonResponse", SlowWriteJsonDirect);
  SetMethod(context, exports, "writeTextResponse", SlowWriteTextDirect);
  SetMethod(context, exports, "writeBinaryResponse", SlowWriteBinaryDirect);
  SetMethod(context, exports, "writeNotModifiedResponse", SlowWriteNotModified);
  SetMethod(context, exports, "writePrecomputed", SlowWritePrecomputed);

  // HISTORY: WHY V8 FAST API (SetFastMethod)
  // V8's Fast API Calls were introduced in V8 v8.7 (Chrome 87, ~2020).
  // Normal JS-to-C++ calls go through a generic callback that boxes/unboxes
  // arguments. Fast API calls let V8's JIT compiler call C++ directly with
  // native types, skipping the boxing overhead — ~10-100x faster for hot paths.
  // Fast API functions must not trigger GC, JS execution, or arbitrary V8
  // reentry. "NoSideEffect" marks the callback as safe for V8's side-effect-
  // checking debug evaluation (the throwOnSideEffect debugger contract).
  // Lying about side effects breaks DevTools inspect behavior.

  // Object pool
  SetMethod(context, exports, "acquireRequest", AcquireRequest);
  SetMethod(context, exports, "releaseRequest", ReleaseRequest);
  SetMethod(context, exports, "acquireResponse", AcquireResponse);
  SetMethod(context, exports, "releaseResponse", ReleaseResponse);
  SetMethod(context, exports, "getObjectPoolStats", GetObjectPoolStats);

  // Feature detection
  SetFastMethodNoSideEffect(context, exports, "isIoUringAvailable",
                            SlowIsIoUringAvailable,
                            &fast_is_io_uring_available);
  SetFastMethodNoSideEffect(context, exports, "isMimallocAvailable",
                            SlowIsMimallocAvailable,
                            &fast_is_mimalloc_available);

  // uWebSockets-backed server
  SetMethod(context, exports, "createUwsServer", CreateUwsServer);
  SetMethod(context, exports, "uwsServerAddRoute", UwsServerAddRoute);
  SetMethod(context, exports, "uwsServerListen", UwsServerListen);
  SetMethod(context, exports, "uwsServerStop", UwsServerStop);
}

void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  // Response writers (slow-path only — FastResponse accesses JS heap)
  registry->Register(SlowWriteJsonDirect);
  registry->Register(SlowWriteTextDirect);
  registry->Register(SlowWriteBinaryDirect);
  registry->Register(SlowWriteNotModified);
  registry->Register(SlowWritePrecomputed);

  // Object pool
  registry->Register(AcquireRequest);
  registry->Register(ReleaseRequest);
  registry->Register(AcquireResponse);
  registry->Register(ReleaseResponse);
  registry->Register(GetObjectPoolStats);

  // Feature detection (slow + fast paths)
  registry->Register(SlowIsIoUringAvailable);
  registry->Register(fast_is_io_uring_available);
  registry->Register(SlowIsMimallocAvailable);
  registry->Register(fast_is_mimalloc_available);

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
