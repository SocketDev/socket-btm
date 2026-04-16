// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// trampoline.cc
// Pre-built V8 CFunction trampolines for common FFI signatures,
// plus a callback trampoline pool for JS->native callbacks without libffi.

#include "socketsecurity/ffi/trampoline.h"

#include "node_buffer.h"
#include "node_debug.h"
#include "v8.h"
#include "v8-fast-api-calls.h"

#include <atomic>
#include <cstring>
#include <mutex>

namespace node {
namespace socketsecurity {
namespace ffi {

using v8::CFunction;
using v8::FastApiCallbackOptions;
using v8::HandleScope;
using v8::Local;
using v8::Value;

// ============================================================================
// V8 Fast API trampolines — active function pointer via TLS
// ============================================================================

thread_local void* FFITrampoline::active_fn_ptr_ = nullptr;

void FFITrampoline::SetActiveTarget(void* fn_ptr) {
  active_fn_ptr_ = fn_ptr;
}

bool FFITrampoline::CanUseFastPath() {
  static constexpr size_t kExpectedOptionsSize =
      sizeof(v8::Isolate*) + sizeof(v8::Local<v8::Value>);
  return sizeof(FastApiCallbackOptions) <= kExpectedOptionsSize + 16;
}

// Helper to extract a pointer from a V8 value (Buffer/TypedArray/BigInt).
static inline void* ExtractPtr(Local<Value> val) {
  if (val->IsArrayBufferView()) {
    return node::Buffer::Data(val);
  }
  return nullptr;
}

// ---- void return ----

void FFITrampoline::FastVoidNoArgs(
    Local<Value> receiver,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.void_noargs");
  reinterpret_cast<void(*)()>(active_fn_ptr_)();
}

void FFITrampoline::FastVoidInt32(
    Local<Value> receiver,
    int32_t a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.void_i32");
  reinterpret_cast<void(*)(int32_t)>(active_fn_ptr_)(a0);
}

void FFITrampoline::FastVoidPtr(
    Local<Value> receiver,
    Local<Value> a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.void_ptr");
  HandleScope scope(options.isolate);
  reinterpret_cast<void(*)(void*)>(active_fn_ptr_)(ExtractPtr(a0));
}

// ---- int32_t return ----

int32_t FFITrampoline::FastInt32NoArgs(
    Local<Value> receiver,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_noargs");
  return reinterpret_cast<int32_t(*)()>(active_fn_ptr_)();
}

int32_t FFITrampoline::FastInt32Int32(
    Local<Value> receiver,
    int32_t a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_i32");
  return reinterpret_cast<int32_t(*)(int32_t)>(active_fn_ptr_)(a0);
}

int32_t FFITrampoline::FastInt32Int32Int32(
    Local<Value> receiver,
    int32_t a0, int32_t a1,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_i32_i32");
  return reinterpret_cast<int32_t(*)(int32_t, int32_t)>(active_fn_ptr_)(
      a0, a1);
}

int32_t FFITrampoline::FastInt32Int32Int32Int32(
    Local<Value> receiver,
    int32_t a0, int32_t a1, int32_t a2,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_i32_i32_i32");
  return reinterpret_cast<int32_t(*)(int32_t, int32_t, int32_t)>(
      active_fn_ptr_)(a0, a1, a2);
}

int32_t FFITrampoline::FastInt32Ptr(
    Local<Value> receiver,
    Local<Value> a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_ptr");
  HandleScope scope(options.isolate);
  return reinterpret_cast<int32_t(*)(void*)>(active_fn_ptr_)(ExtractPtr(a0));
}

int32_t FFITrampoline::FastInt32PtrInt32(
    Local<Value> receiver,
    Local<Value> a0,
    int32_t a1,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_ptr_i32");
  HandleScope scope(options.isolate);
  return reinterpret_cast<int32_t(*)(void*, int32_t)>(active_fn_ptr_)(
      ExtractPtr(a0), a1);
}

int32_t FFITrampoline::FastInt32PtrPtr(
    Local<Value> receiver,
    Local<Value> a0,
    Local<Value> a1,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.i32_ptr_ptr");
  HandleScope scope(options.isolate);
  return reinterpret_cast<int32_t(*)(void*, void*)>(active_fn_ptr_)(
      ExtractPtr(a0), ExtractPtr(a1));
}

// ---- pointer return ----

void* FFITrampoline::FastPtrNoArgs(
    Local<Value> receiver,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.ptr_noargs");
  return reinterpret_cast<void*(*)()>(active_fn_ptr_)();
}

void* FFITrampoline::FastPtrPtr(
    Local<Value> receiver,
    Local<Value> a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.ptr_ptr");
  HandleScope scope(options.isolate);
  return reinterpret_cast<void*(*)(void*)>(active_fn_ptr_)(ExtractPtr(a0));
}

void* FFITrampoline::FastPtrInt32(
    Local<Value> receiver,
    int32_t a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.ptr_i32");
  return reinterpret_cast<void*(*)(int32_t)>(active_fn_ptr_)(a0);
}

// ---- double return ----

double FFITrampoline::FastF64NoArgs(
    Local<Value> receiver,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.f64_noargs");
  return reinterpret_cast<double(*)()>(active_fn_ptr_)();
}

double FFITrampoline::FastF64F64(
    Local<Value> receiver,
    double a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.f64_f64");
  return reinterpret_cast<double(*)(double)>(active_fn_ptr_)(a0);
}

double FFITrampoline::FastF64F64F64(
    Local<Value> receiver,
    double a0, double a1,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.f64_f64_f64");
  return reinterpret_cast<double(*)(double, double)>(active_fn_ptr_)(a0, a1);
}

double FFITrampoline::FastF64Int32(
    Local<Value> receiver,
    int32_t a0,
    FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.call.f64_i32");
  return reinterpret_cast<double(*)(int32_t)>(active_fn_ptr_)(a0);
}

// ============================================================================
// Static CFunction descriptors
// ============================================================================

static CFunction cf_void_noargs(CFunction::Make(FFITrampoline::FastVoidNoArgs));
static CFunction cf_void_i32(CFunction::Make(FFITrampoline::FastVoidInt32));
static CFunction cf_void_ptr(CFunction::Make(FFITrampoline::FastVoidPtr));
static CFunction cf_i32_noargs(CFunction::Make(FFITrampoline::FastInt32NoArgs));
static CFunction cf_i32_i32(CFunction::Make(FFITrampoline::FastInt32Int32));
static CFunction cf_i32_i32_i32(CFunction::Make(
    FFITrampoline::FastInt32Int32Int32));
static CFunction cf_i32_i32_i32_i32(CFunction::Make(
    FFITrampoline::FastInt32Int32Int32Int32));
static CFunction cf_i32_ptr(CFunction::Make(FFITrampoline::FastInt32Ptr));
static CFunction cf_i32_ptr_i32(CFunction::Make(
    FFITrampoline::FastInt32PtrInt32));
static CFunction cf_i32_ptr_ptr(CFunction::Make(
    FFITrampoline::FastInt32PtrPtr));
static CFunction cf_ptr_noargs(CFunction::Make(FFITrampoline::FastPtrNoArgs));
static CFunction cf_ptr_ptr(CFunction::Make(FFITrampoline::FastPtrPtr));
static CFunction cf_ptr_i32(CFunction::Make(FFITrampoline::FastPtrInt32));
static CFunction cf_f64_noargs(CFunction::Make(FFITrampoline::FastF64NoArgs));
static CFunction cf_f64_f64(CFunction::Make(FFITrampoline::FastF64F64));
static CFunction cf_f64_f64_f64(CFunction::Make(FFITrampoline::FastF64F64F64));
static CFunction cf_f64_i32(CFunction::Make(FFITrampoline::FastF64Int32));

// ============================================================================
// Signature matching
// ============================================================================

const CFunction* FFITrampoline::GetTrampoline(const FFISignature& sig) {
  if (!CanUseFastPath()) return nullptr;

  if (sig.param_count == 0) {
    switch (sig.return_type) {
      case FFIType::kVoid:    return &cf_void_noargs;
      case FFIType::kBool:
      case FFIType::kInt32:   return &cf_i32_noargs;
      case FFIType::kPointer: return &cf_ptr_noargs;
      case FFIType::kFloat64: return &cf_f64_noargs;
      default: break;
    }
  } else if (sig.param_count == 1) {
    FFIType p0 = sig.param_types[0];
    switch (sig.return_type) {
      case FFIType::kVoid:
        if (p0 == FFIType::kInt32) return &cf_void_i32;
        if (p0 == FFIType::kPointer) return &cf_void_ptr;
        break;
      case FFIType::kBool:
      case FFIType::kInt32:
        if (p0 == FFIType::kInt32) return &cf_i32_i32;
        if (p0 == FFIType::kPointer) return &cf_i32_ptr;
        break;
      case FFIType::kPointer:
        if (p0 == FFIType::kPointer) return &cf_ptr_ptr;
        if (p0 == FFIType::kInt32) return &cf_ptr_i32;
        break;
      case FFIType::kFloat64:
        if (p0 == FFIType::kFloat64) return &cf_f64_f64;
        if (p0 == FFIType::kInt32) return &cf_f64_i32;
        break;
      default: break;
    }
  } else if (sig.param_count == 2) {
    FFIType p0 = sig.param_types[0];
    FFIType p1 = sig.param_types[1];
    switch (sig.return_type) {
      case FFIType::kBool:
      case FFIType::kInt32:
        if (p0 == FFIType::kInt32 && p1 == FFIType::kInt32)
          return &cf_i32_i32_i32;
        if (p0 == FFIType::kPointer && p1 == FFIType::kInt32)
          return &cf_i32_ptr_i32;
        if (p0 == FFIType::kPointer && p1 == FFIType::kPointer)
          return &cf_i32_ptr_ptr;
        break;
      case FFIType::kFloat64:
        if (p0 == FFIType::kFloat64 && p1 == FFIType::kFloat64)
          return &cf_f64_f64_f64;
        break;
      default: break;
    }
  } else if (sig.param_count == 3) {
    FFIType p0 = sig.param_types[0];
    FFIType p1 = sig.param_types[1];
    FFIType p2 = sig.param_types[2];
    if ((sig.return_type == FFIType::kInt32 ||
         sig.return_type == FFIType::kBool) &&
        p0 == FFIType::kInt32 && p1 == FFIType::kInt32 &&
        p2 == FFIType::kInt32) {
      return &cf_i32_i32_i32_i32;
    }
  }

  return nullptr;
}

// ============================================================================
// Callback trampoline pool
// ============================================================================
//
// Strategy: pre-allocate N static C functions (one per slot). Each slot has a
// unique entry point that the compiler generates. When native code calls
// slot_fn_N(), the trampoline reads slot_data[N] to find the JS function
// reference and signature, then marshals args and calls into V8.
//
// This covers the most common callback patterns:
//   void cb(void), void cb(i32), void cb(ptr), void cb(ptr, i32),
//   i32 cb(ptr), i32 cb(i32), i32 cb(i32, i32), i32 cb(ptr, ptr)
//
// Signatures that don't match these patterns fall back to void(void) and
// discard arguments — the JS function receives no args.

// Definition of the global callback slot array (declared in trampoline.h).
CallbackSlotData g_callback_slots[kMaxCallbackSlots];

static std::once_flag g_callback_pool_init_flag;

void CallbackPoolInit() {
  std::call_once(g_callback_pool_init_flag, []() {
    memset(g_callback_slots, 0, sizeof(g_callback_slots));
  });
}

// Alloc uses a two-phase protocol:
//   1. CAS false→true to "reserve" the slot (prevents double-claim)
//   2. Caller must call CallbackPoolSetData which writes fields then
//      publishes with a release store (readers acquire before field access)
// Between alloc and SetData, the slot is reserved but fields are stale.
// InvokeCallbackSlot checks env/js_fn != nullptr, so stale null fields
// are safe — the slot simply looks uninitialized until SetData publishes.
int32_t CallbackPoolAlloc(bool needs_float) {
  uint32_t start = needs_float ? 48 : 0;
  uint32_t end = needs_float ? kMaxCallbackSlots : 48;
  for (uint32_t i = start; i < end; ++i) {
    bool expected = false;
    if (g_callback_slots[i].allocated.compare_exchange_strong(
            expected, true, std::memory_order_acq_rel)) {
      // Slot reserved. Clear fields before returning so readers
      // see nullptr until CallbackPoolSetData writes real values.
      g_callback_slots[i].env = nullptr;
      g_callback_slots[i].js_fn = nullptr;
      return static_cast<int32_t>(i);
    }
  }
  return -1;
}

void CallbackPoolFree(uint32_t slot) {
  if (slot < kMaxCallbackSlots) {
    g_callback_slots[slot].env = nullptr;
    g_callback_slots[slot].js_fn = nullptr;
    g_callback_slots[slot].allocated.store(false, std::memory_order_release);
  }
}

void CallbackPoolSetData(uint32_t slot, CallbackSlotData* data) {
  if (slot < kMaxCallbackSlots) {
    g_callback_slots[slot].env = data->env;
    g_callback_slots[slot].js_fn = data->js_fn;
    g_callback_slots[slot].signature = data->signature;
    g_callback_slots[slot].thread_id = data->thread_id;
    g_callback_slots[slot].allocated.store(true, std::memory_order_release);
  }
}

// The actual callback dispatch is handled in binding.cc where we have access
// to the V8 and Environment types. Here we just provide the slot lookup.
// The binding.cc InvokeCallback function is the real entry point.

// Forward declarations — implemented in binding.cc.
extern uintptr_t InvokeCallbackSlot(uint32_t slot,
                                    uintptr_t a0,
                                    uintptr_t a1,
                                    uintptr_t a2,
                                    uintptr_t a3);
extern double InvokeCallbackSlotF64(uint32_t slot,
                                    double a0,
                                    double a1,
                                    double a2,
                                    double a3);

// ---- Integer/pointer callback slots (0-47) ----
#define CALLBACK_SLOT_FN(N)                                                    \
  static uintptr_t callback_slot_##N(uintptr_t a0, uintptr_t a1,              \
                                     uintptr_t a2, uintptr_t a3) {            \
    return InvokeCallbackSlot(N, a0, a1, a2, a3);                             \
  }

CALLBACK_SLOT_FN(0)  CALLBACK_SLOT_FN(1)  CALLBACK_SLOT_FN(2)
CALLBACK_SLOT_FN(3)  CALLBACK_SLOT_FN(4)  CALLBACK_SLOT_FN(5)
CALLBACK_SLOT_FN(6)  CALLBACK_SLOT_FN(7)  CALLBACK_SLOT_FN(8)
CALLBACK_SLOT_FN(9)  CALLBACK_SLOT_FN(10) CALLBACK_SLOT_FN(11)
CALLBACK_SLOT_FN(12) CALLBACK_SLOT_FN(13) CALLBACK_SLOT_FN(14)
CALLBACK_SLOT_FN(15) CALLBACK_SLOT_FN(16) CALLBACK_SLOT_FN(17)
CALLBACK_SLOT_FN(18) CALLBACK_SLOT_FN(19) CALLBACK_SLOT_FN(20)
CALLBACK_SLOT_FN(21) CALLBACK_SLOT_FN(22) CALLBACK_SLOT_FN(23)
CALLBACK_SLOT_FN(24) CALLBACK_SLOT_FN(25) CALLBACK_SLOT_FN(26)
CALLBACK_SLOT_FN(27) CALLBACK_SLOT_FN(28) CALLBACK_SLOT_FN(29)
CALLBACK_SLOT_FN(30) CALLBACK_SLOT_FN(31) CALLBACK_SLOT_FN(32)
CALLBACK_SLOT_FN(33) CALLBACK_SLOT_FN(34) CALLBACK_SLOT_FN(35)
CALLBACK_SLOT_FN(36) CALLBACK_SLOT_FN(37) CALLBACK_SLOT_FN(38)
CALLBACK_SLOT_FN(39) CALLBACK_SLOT_FN(40) CALLBACK_SLOT_FN(41)
CALLBACK_SLOT_FN(42) CALLBACK_SLOT_FN(43) CALLBACK_SLOT_FN(44)
CALLBACK_SLOT_FN(45) CALLBACK_SLOT_FN(46) CALLBACK_SLOT_FN(47)
#undef CALLBACK_SLOT_FN

// ---- Float/double callback slots (48-63) ----
// These use double args so the C ABI passes them in FPU registers.
#define CALLBACK_SLOT_F64_FN(N)                                                \
  static double callback_slot_f64_##N(double a0, double a1,                    \
                                      double a2, double a3) {                  \
    return InvokeCallbackSlotF64(N, a0, a1, a2, a3);                          \
  }

CALLBACK_SLOT_F64_FN(48) CALLBACK_SLOT_F64_FN(49)
CALLBACK_SLOT_F64_FN(50) CALLBACK_SLOT_F64_FN(51)
CALLBACK_SLOT_F64_FN(52) CALLBACK_SLOT_F64_FN(53)
CALLBACK_SLOT_F64_FN(54) CALLBACK_SLOT_F64_FN(55)
CALLBACK_SLOT_F64_FN(56) CALLBACK_SLOT_F64_FN(57)
CALLBACK_SLOT_F64_FN(58) CALLBACK_SLOT_F64_FN(59)
CALLBACK_SLOT_F64_FN(60) CALLBACK_SLOT_F64_FN(61)
CALLBACK_SLOT_F64_FN(62) CALLBACK_SLOT_F64_FN(63)
#undef CALLBACK_SLOT_F64_FN

// Integer slot function pointer table.
using SlotFn = uintptr_t(*)(uintptr_t, uintptr_t, uintptr_t, uintptr_t);
static SlotFn g_callback_slot_fns[48] = {
  callback_slot_0,  callback_slot_1,  callback_slot_2,  callback_slot_3,
  callback_slot_4,  callback_slot_5,  callback_slot_6,  callback_slot_7,
  callback_slot_8,  callback_slot_9,  callback_slot_10, callback_slot_11,
  callback_slot_12, callback_slot_13, callback_slot_14, callback_slot_15,
  callback_slot_16, callback_slot_17, callback_slot_18, callback_slot_19,
  callback_slot_20, callback_slot_21, callback_slot_22, callback_slot_23,
  callback_slot_24, callback_slot_25, callback_slot_26, callback_slot_27,
  callback_slot_28, callback_slot_29, callback_slot_30, callback_slot_31,
  callback_slot_32, callback_slot_33, callback_slot_34, callback_slot_35,
  callback_slot_36, callback_slot_37, callback_slot_38, callback_slot_39,
  callback_slot_40, callback_slot_41, callback_slot_42, callback_slot_43,
  callback_slot_44, callback_slot_45, callback_slot_46, callback_slot_47,
};

// Float slot function pointer table.
using SlotF64Fn = double(*)(double, double, double, double);
static SlotF64Fn g_callback_slot_f64_fns[16] = {
  callback_slot_f64_48, callback_slot_f64_49,
  callback_slot_f64_50, callback_slot_f64_51,
  callback_slot_f64_52, callback_slot_f64_53,
  callback_slot_f64_54, callback_slot_f64_55,
  callback_slot_f64_56, callback_slot_f64_57,
  callback_slot_f64_58, callback_slot_f64_59,
  callback_slot_f64_60, callback_slot_f64_61,
  callback_slot_f64_62, callback_slot_f64_63,
};

// Check if a callback signature needs float slots.
static bool SigNeedsFloatSlot(const FFISignature& sig) {
  for (size_t i = 0; i < sig.param_count; ++i) {
    if (FFITypeIsFloat(sig.param_types[i])) return true;
  }
  return false;
}

void* CallbackPoolGetPtr(uint32_t slot, const FFISignature& sig) {
  if (slot >= kMaxCallbackSlots) return nullptr;
  if (SigNeedsFloatSlot(sig) && slot >= 48) {
    return reinterpret_cast<void*>(g_callback_slot_f64_fns[slot - 48]);
  }
  if (slot < 48) {
    return reinterpret_cast<void*>(g_callback_slot_fns[slot]);
  }
  return nullptr;
}

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#pragma GCC diagnostic pop
