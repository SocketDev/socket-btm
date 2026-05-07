#ifndef SRC_SOCKETSECURITY_FFI_TRAMPOLINE_H_
#define SRC_SOCKETSECURITY_FFI_TRAMPOLINE_H_

#include "v8.h"
#include "v8-fast-api-calls.h"
#include "socketsecurity/ffi/types.h"
#include <atomic>
#include <cstdint>
#include <thread>

namespace node {
namespace socketsecurity {
namespace ffi {

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
class FFITrampoline {
 public:
  // Check if the V8 Fast API is compatible with our expectations.
  static bool CanUseFastPath();

  // Pre-built trampolines for the most common FFI signatures.

  // void f(void)
  static void FastVoidNoArgs(v8::Local<v8::Value> receiver,
                             v8::FastApiCallbackOptions& options);
  // void f(int32_t)
  static void FastVoidInt32(v8::Local<v8::Value> receiver,
                            int32_t a0,
                            v8::FastApiCallbackOptions& options);
  // void f(pointer)
  static void FastVoidPtr(v8::Local<v8::Value> receiver,
                          v8::Local<v8::Value> a0,
                          v8::FastApiCallbackOptions& options);

  // int32_t f(void)
  static int32_t FastInt32NoArgs(v8::Local<v8::Value> receiver,
                                 v8::FastApiCallbackOptions& options);
  // int32_t f(int32_t)
  static int32_t FastInt32Int32(v8::Local<v8::Value> receiver,
                                int32_t a0,
                                v8::FastApiCallbackOptions& options);
  // int32_t f(int32_t, int32_t)
  static int32_t FastInt32Int32Int32(v8::Local<v8::Value> receiver,
                                     int32_t a0, int32_t a1,
                                     v8::FastApiCallbackOptions& options);
  // int32_t f(int32_t, int32_t, int32_t)
  static int32_t FastInt32Int32Int32Int32(v8::Local<v8::Value> receiver,
                                          int32_t a0, int32_t a1, int32_t a2,
                                          v8::FastApiCallbackOptions& options);
  // int32_t f(pointer)
  static int32_t FastInt32Ptr(v8::Local<v8::Value> receiver,
                              v8::Local<v8::Value> a0,
                              v8::FastApiCallbackOptions& options);
  // int32_t f(pointer, int32_t)
  static int32_t FastInt32PtrInt32(v8::Local<v8::Value> receiver,
                                   v8::Local<v8::Value> a0,
                                   int32_t a1,
                                   v8::FastApiCallbackOptions& options);
  // int32_t f(pointer, pointer)
  static int32_t FastInt32PtrPtr(v8::Local<v8::Value> receiver,
                                  v8::Local<v8::Value> a0,
                                  v8::Local<v8::Value> a1,
                                  v8::FastApiCallbackOptions& options);

  // pointer f(void)
  static void* FastPtrNoArgs(v8::Local<v8::Value> receiver,
                             v8::FastApiCallbackOptions& options);
  // pointer f(pointer)
  static void* FastPtrPtr(v8::Local<v8::Value> receiver,
                          v8::Local<v8::Value> a0,
                          v8::FastApiCallbackOptions& options);
  // pointer f(int32_t)
  static void* FastPtrInt32(v8::Local<v8::Value> receiver,
                            int32_t a0,
                            v8::FastApiCallbackOptions& options);

  // double f(void)
  static double FastF64NoArgs(v8::Local<v8::Value> receiver,
                              v8::FastApiCallbackOptions& options);
  // double f(double)
  static double FastF64F64(v8::Local<v8::Value> receiver,
                           double a0,
                           v8::FastApiCallbackOptions& options);
  // double f(double, double)
  static double FastF64F64F64(v8::Local<v8::Value> receiver,
                              double a0, double a1,
                              v8::FastApiCallbackOptions& options);
  // double f(int32_t)
  static double FastF64Int32(v8::Local<v8::Value> receiver,
                             int32_t a0,
                             v8::FastApiCallbackOptions& options);

  // Get the CFunction descriptor for a given FFI signature.
  // Returns nullptr if no pre-built trampoline matches.
  static const v8::CFunction* GetTrampoline(const FFISignature& sig);

  // Set the function pointer that the next trampoline call will invoke.
  static void SetActiveTarget(void* fn_ptr);

 private:
  static thread_local void* active_fn_ptr_;
};

// ============================================================================
// Callback trampoline pool — allows JS functions to be called from C.
//
// Pre-allocates a fixed pool of N unique C function entry points at compile
// time. Each slot stores a JS function reference + signature. When native code
// calls slot[i], the trampoline looks up the JS function and invokes it.
//
// This approach covers the 90% case (scalar args, up to 4 params) without
// libffi closures, JIT, or per-arch assembly.
// ============================================================================

// Per-slot data for the callback trampoline pool.
struct CallbackSlotData {
  void* env;               // Environment* (opaque to avoid header dep)
  void* js_fn;             // v8::Global<v8::Function>* (opaque)
  FFISignature signature;
  std::thread::id thread_id;  // Owning thread — callbacks must fire here
  std::atomic<bool> allocated;
};

// Global callback slot array — shared between trampoline.cc and binding.cc.
extern CallbackSlotData g_callback_slots[kMaxCallbackSlots];

// Initialize the callback pool (called once per process).
void CallbackPoolInit();

// Allocate a slot, returning its index. Returns -1 if pool exhausted.
// needs_float: true to allocate from float slots (48-63), false for int (0-47).
int32_t CallbackPoolAlloc(bool needs_float);

// Free a slot back to the pool.
void CallbackPoolFree(uint32_t slot);

// Set the JS callback data for a slot.
void CallbackPoolSetData(uint32_t slot, CallbackSlotData* data);

// Get the native function pointer for a slot (to hand to C code).
void* CallbackPoolGetPtr(uint32_t slot, const FFISignature& sig);

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_FFI_TRAMPOLINE_H_
