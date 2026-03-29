#ifndef SRC_SOCKETSECURITY_FFI_TRAMPOLINE_H_
#define SRC_SOCKETSECURITY_FFI_TRAMPOLINE_H_

#include "v8.h"
#include "v8-fast-api-calls.h"
#include "socketsecurity/ffi/types.h"
#include <cstdint>

namespace node {
namespace socketsecurity {
namespace ffi {

// Generates V8 CFunction trampolines for FFI functions.
//
// For functions with primitive-only signatures (int, float, pointer, bool),
// we can bypass the slow Call() dispatcher entirely and route through V8's
// JIT-optimized fast call path. This matches Deno's Turbocall approach.
//
// The trampoline works by:
//   1. At sym() time: inspect the FFI signature
//   2. If all params are primitives: generate a CFunction descriptor
//   3. Register it with SetFastMethod on a per-function JS wrapper
//   4. V8's JIT calls the trampoline directly, skipping argument marshaling
//
// Version resilience: If V8 changes the FastApiCallbackOptions layout,
// CanUseFastPath() returns false and all calls fall back to the slow path.
class FFITrampoline {
 public:
  // Check if the V8 Fast API is compatible with our expectations.
  // Returns false if V8 has changed struct layouts since build time.
  static bool CanUseFastPath();

  // Pre-built trampolines for the most common FFI signatures.
  // These cover ~80% of real-world FFI usage.

  // void f(void)
  static void FastVoidNoArgs(v8::Local<v8::Value> receiver,
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

  // int32_t f(pointer)
  static int32_t FastInt32Ptr(v8::Local<v8::Value> receiver,
                              v8::Local<v8::Value> a0,
                              v8::FastApiCallbackOptions& options);

  // pointer f(void)
  static void* FastPtrNoArgs(v8::Local<v8::Value> receiver,
                             v8::FastApiCallbackOptions& options);

  // pointer f(pointer)
  static void* FastPtrPtr(v8::Local<v8::Value> receiver,
                          v8::Local<v8::Value> a0,
                          v8::FastApiCallbackOptions& options);

  // double f(void)
  static double FastF64NoArgs(v8::Local<v8::Value> receiver,
                              v8::FastApiCallbackOptions& options);

  // double f(double)
  static double FastF64F64(v8::Local<v8::Value> receiver,
                           double a0,
                           v8::FastApiCallbackOptions& options);

  // Get the CFunction descriptor for a given trampoline.
  static const v8::CFunction* GetTrampoline(const FFISignature& sig);

  // Set the function pointer that the next trampoline call will invoke.
  // Uses thread-local storage for the active call target.
  static void SetActiveTarget(void* fn_ptr);

 private:
  static thread_local void* active_fn_ptr_;
};

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_FFI_TRAMPOLINE_H_
