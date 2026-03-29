// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// trampoline.cc
// Pre-built V8 CFunction trampolines for common FFI signatures.
//
// Instead of JIT-compiling assembly per signature (like Deno's Turbocall),
// we use a finite set of pre-compiled trampolines covering the most common
// FFI patterns. The active function pointer is stored in thread-local storage
// and looked up at call time — adding ~1ns overhead but avoiding any
// architecture-specific code generation.
//
// This approach is version-resilient: no assembly to maintain across
// architectures, and the CFunction descriptors are generated at compile time.

#include "socketsecurity/ffi/trampoline.h"

#include "node_buffer.h"
#include "node_debug.h"
#include "v8.h"
#include "v8-fast-api-calls.h"

namespace node {
namespace socketsecurity {
namespace ffi {

using v8::CFunction;
using v8::FastApiCallbackOptions;
using v8::HandleScope;
using v8::Local;
using v8::Value;

// Thread-local active function pointer for trampoline dispatch.
thread_local void* FFITrampoline::active_fn_ptr_ = nullptr;

void FFITrampoline::SetActiveTarget(void* fn_ptr) {
  active_fn_ptr_ = fn_ptr;
}

// Check V8 Fast API compatibility.
// If the struct layout changed, we disable fast paths entirely.
bool FFITrampoline::CanUseFastPath() {
  // FastApiCallbackOptions should contain isolate + data.
  // If V8 adds/removes fields, this size check catches it.
  static constexpr size_t kExpectedOptionsSize =
      sizeof(v8::Isolate*) + sizeof(v8::Local<v8::Value>);
  return sizeof(FastApiCallbackOptions) <= kExpectedOptionsSize + 16;
}

// ============================================================================
// Pre-built trampolines
// ============================================================================

// void f(void)
void FFITrampoline::FastVoidNoArgs(
    Local<Value> receiver,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.void_noargs");
  auto fn = reinterpret_cast<void(*)()>(active_fn_ptr_);
  fn();
}

// int32_t f(void)
int32_t FFITrampoline::FastInt32NoArgs(
    Local<Value> receiver,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_noargs");
  auto fn = reinterpret_cast<int32_t(*)()>(active_fn_ptr_);
  return fn();
}

// int32_t f(int32_t)
int32_t FFITrampoline::FastInt32Int32(
    Local<Value> receiver,
    int32_t a0,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_i32");
  auto fn = reinterpret_cast<int32_t(*)(int32_t)>(active_fn_ptr_);
  return fn(a0);
}

// int32_t f(int32_t, int32_t)
int32_t FFITrampoline::FastInt32Int32Int32(
    Local<Value> receiver,
    int32_t a0, int32_t a1,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_i32_i32");
  auto fn = reinterpret_cast<int32_t(*)(int32_t, int32_t)>(active_fn_ptr_);
  return fn(a0, a1);
}

// int32_t f(pointer)
int32_t FFITrampoline::FastInt32Ptr(
    Local<Value> receiver,
    Local<Value> a0,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_ptr");
  HandleScope scope(options.isolate);
  void* ptr = nullptr;
  if (a0->IsArrayBufferView()) {
    ptr = node::Buffer::Data(a0);
  }
  auto fn = reinterpret_cast<int32_t(*)(void*)>(active_fn_ptr_);
  return fn(ptr);
}

// pointer f(void)
void* FFITrampoline::FastPtrNoArgs(
    Local<Value> receiver,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.ptr_noargs");
  auto fn = reinterpret_cast<void*(*)()>(active_fn_ptr_);
  return fn();
}

// pointer f(pointer)
void* FFITrampoline::FastPtrPtr(
    Local<Value> receiver,
    Local<Value> a0,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.ptr_ptr");
  HandleScope scope(options.isolate);
  void* ptr = nullptr;
  if (a0->IsArrayBufferView()) {
    ptr = node::Buffer::Data(a0);
  }
  auto fn = reinterpret_cast<void*(*)(void*)>(active_fn_ptr_);
  return fn(ptr);
}

// double f(void)
double FFITrampoline::FastF64NoArgs(
    Local<Value> receiver,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.f64_noargs");
  auto fn = reinterpret_cast<double(*)()>(active_fn_ptr_);
  return fn();
}

// double f(double)
double FFITrampoline::FastF64F64(
    Local<Value> receiver,
    double a0,
    // NOLINTNEXTLINE(runtime/references)
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.f64_f64");
  auto fn = reinterpret_cast<double(*)(double)>(active_fn_ptr_);
  return fn(a0);
}

// ============================================================================
// Static CFunction descriptors
// ============================================================================

static CFunction cf_void_noargs(CFunction::Make(FFITrampoline::FastVoidNoArgs));
static CFunction cf_i32_noargs(CFunction::Make(FFITrampoline::FastInt32NoArgs));
static CFunction cf_i32_i32(CFunction::Make(FFITrampoline::FastInt32Int32));
static CFunction cf_i32_i32_i32(CFunction::Make(FFITrampoline::FastInt32Int32Int32));
static CFunction cf_i32_ptr(CFunction::Make(FFITrampoline::FastInt32Ptr));
static CFunction cf_ptr_noargs(CFunction::Make(FFITrampoline::FastPtrNoArgs));
static CFunction cf_ptr_ptr(CFunction::Make(FFITrampoline::FastPtrPtr));
static CFunction cf_f64_noargs(CFunction::Make(FFITrampoline::FastF64NoArgs));
static CFunction cf_f64_f64(CFunction::Make(FFITrampoline::FastF64F64));

// ============================================================================
// Signature matching
// ============================================================================

const CFunction* FFITrampoline::GetTrampoline(const FFISignature& sig) {
  if (!CanUseFastPath()) return nullptr;

  // Match against pre-built signatures.
  if (sig.param_count == 0) {
    switch (sig.return_type) {
      case FFIType::kVoid:    return &cf_void_noargs;
      case FFIType::kInt32:
      case FFIType::kBool:    return &cf_i32_noargs;
      case FFIType::kPointer: return &cf_ptr_noargs;
      case FFIType::kFloat64: return &cf_f64_noargs;
      default: break;
    }
  } else if (sig.param_count == 1) {
    if ((sig.return_type == FFIType::kInt32 ||
         sig.return_type == FFIType::kBool) &&
        sig.param_types[0] == FFIType::kInt32) {
      return &cf_i32_i32;
    }
    if ((sig.return_type == FFIType::kInt32 ||
         sig.return_type == FFIType::kBool) &&
        sig.param_types[0] == FFIType::kPointer) {
      return &cf_i32_ptr;
    }
    if (sig.return_type == FFIType::kPointer &&
        sig.param_types[0] == FFIType::kPointer) {
      return &cf_ptr_ptr;
    }
    if (sig.return_type == FFIType::kFloat64 &&
        sig.param_types[0] == FFIType::kFloat64) {
      return &cf_f64_f64;
    }
  } else if (sig.param_count == 2) {
    if ((sig.return_type == FFIType::kInt32 ||
         sig.return_type == FFIType::kBool) &&
        sig.param_types[0] == FFIType::kInt32 &&
        sig.param_types[1] == FFIType::kInt32) {
      return &cf_i32_i32_i32;
    }
  }

  return nullptr;
}

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node
