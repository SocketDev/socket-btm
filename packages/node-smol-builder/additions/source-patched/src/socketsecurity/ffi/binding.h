// ============================================================================
// binding.h -- Declares the C++ class that provides FFI methods to JavaScript
// ============================================================================
//
// This is a HEADER FILE (.h). In C++, code is split into two parts:
//   .h (header): Declares what exists -- like a TypeScript .d.ts file
//   .cc (source): Defines the implementation -- like the .js file
//
// WHAT THIS FILE DOES
// Declares FFIBinding (the class that wires up all the C++ functions that
// JavaScript can call) and FFIState (the per-thread storage that tracks
// which libraries, functions, and callbacks are currently loaded).
//
// WHY IT EXISTS
// Both binding.cc and trampoline.cc need to know the shape of these types.
// Putting declarations in a header lets multiple .cc files share them
// without duplicating code.
//
// HOW JS USES THIS
// JS: internalBinding('smol_ffi') --> methods defined in FFIBinding::Initialize
// User: require('node:smol-ffi') --> lib/smol-ffi.js -->
//       lib/internal/socketsecurity/ffi.js --> this binding
//
// KEY CONCEPTS FOR JS DEVELOPERS
// - `unique_ptr<T>`: Automatic memory cleanup -- C++ has no garbage collector,
//     so unique_ptr auto-deletes the object when the owning variable goes out
//     of scope. In JS terms: like a scoped resource that auto-disposes when
//     its owner (the function or class) is done with it.
// - `unordered_map<K, V>`: Like a JS `Map` -- stores key-value pairs with
//     O(1) lookup. Here we use numeric IDs as keys to find libraries/functions.
// - `static` methods: Like class methods in JS -- called on the class, not on
//     an instance. `FFIBinding::Open(args)` is like `FFIBinding.open(args)`.
// ============================================================================

#ifndef SRC_SOCKETSECURITY_FFI_BINDING_H_
#define SRC_SOCKETSECURITY_FFI_BINDING_H_

#include "env.h"
#include "v8.h"
#include "socketsecurity/ffi/types.h"
#include <memory>
#include <unordered_map>
#include <vector>

namespace node {

class ExternalReferenceRegistry;

namespace socketsecurity {
namespace ffi {

// ============================================================================
// FFIState -- per-thread storage for all FFI resources
// ============================================================================
//
// Each thread (main thread, each Worker) gets its own FFIState so they don't
// interfere with each other. This struct holds three maps tracking everything
// the FFI module has allocated:
//   libraries  -- loaded .so/.dylib/.dll files
//   functions  -- resolved function symbols (like `sqrt`)
//   callbacks  -- JS functions exported as C function pointers
//
// When the thread shuts down, ~FFIState() (the destructor) automatically
// closes all libraries and frees all callback slots.
struct FFIState {
  std::unordered_map<uint32_t, std::unique_ptr<FFILibrary>> libraries;
  std::unordered_map<uint32_t, std::unique_ptr<FFIFunction>> functions;
  std::unordered_map<uint32_t, std::unique_ptr<FFICallback>> callbacks;
  uint32_t next_library_id = 1;
  uint32_t next_function_id = 1;
  uint32_t next_callback_id = 1;

  // Pre-reserve hash buckets to sizes that cover any realistic FFI usage.
  // std::unordered_map insertion can bad_alloc on rehash, which aborts
  // under -fno-exceptions. Reserving once at construction means
  // subsequent insertions from the JS layer never rehash for the
  // bounded number of libraries / functions / callbacks a typical
  // binding touches. Nothrow-friendly: the constructor is called from
  // GetState() via `new (std::nothrow)`, so a reserve OOM aborts the
  // state creation (already handled) rather than a later Load call.
  FFIState() {
    libraries.reserve(64);
    functions.reserve(512);
    callbacks.reserve(64);
  }

  // Destructor: called automatically when this FFIState is deleted.
  // Closes all open libraries and frees all callback slots.
  ~FFIState();
};

// ============================================================================
// FFIBinding -- the class that exposes all FFI methods to JavaScript
// ============================================================================
//
// This is the "bridge" between JS and native code. Each static method here
// becomes a function that JavaScript can call via `internalBinding('smol_ffi')`.
//
// FunctionCallbackInfo<Value> is what a C++ function receives when called
// from JS. args[0], args[1]... are the JS arguments. Use
// args.GetReturnValue().Set(...) to return a value to JS (C++ can't
// `return` a JS value directly).
//
// Isolate is one JavaScript runtime -- like one Node.js process. Each Worker
// thread gets its own Isolate.
class FFIBinding {
 public:
  // Called once when Node.js starts up. Registers all the methods below
  // so that `internalBinding('smol_ffi')` returns an object with .open(),
  // .close(), .call(), etc.
  static void Initialize(
    v8::Local<v8::Object> target,
    v8::Local<v8::Value> unused,
    v8::Local<v8::Context> context,
    void* priv);

  // Registers all our C++ function pointers for V8's snapshot system.
  // This enables faster Node.js startup by pre-serializing the binding.
  static void RegisterExternalReferences(ExternalReferenceRegistry* registry);

 private:
  // -- Library lifecycle --
  // JS: binding.open('/path/to/lib.so') -> libraryId (number)
  static void Open(const v8::FunctionCallbackInfo<v8::Value>& args);
  // JS: binding.close(libraryId)
  static void Close(const v8::FunctionCallbackInfo<v8::Value>& args);

  // -- Symbol resolution --
  // JS: binding.sym(libId, 'sqrt', 'f64', ['f64']) -> [functionId, hasFast]
  static void Sym(const v8::FunctionCallbackInfo<v8::Value>& args);
  // JS: binding.dlsym(libId, 'sqrt') -> BigInt (raw address)
  static void Dlsym(const v8::FunctionCallbackInfo<v8::Value>& args);

  // -- Function calling --
  // JS: binding.call(functionId, arg0, arg1, ...) -> returnValue
  static void Call(const v8::FunctionCallbackInfo<v8::Value>& args);
  // Primes the thread-local function pointer for V8 fast-path trampoline.
  static void SetTarget(const v8::FunctionCallbackInfo<v8::Value>& args);

  // -- Pointer / memory helpers --
  // Convert between JS values and raw memory addresses.
  static void PtrToBuffer(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void BufferToPtr(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void PtrToString(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void PtrToArrayBuffer(const v8::FunctionCallbackInfo<v8::Value>& args);

  // -- Raw memory get/set --
  // Read/write typed values at arbitrary memory addresses.
  // JS: binding.getInt32(ptrBigInt, offset) -> number
  // JS: binding.setInt32(ptrBigInt, offset, value)
  static void GetInt8(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetUint8(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetInt16(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetUint16(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetInt32(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetUint32(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetInt64(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetUint64(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetFloat32(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetFloat64(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetInt8(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetUint8(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetInt16(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetUint16(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetInt32(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetUint32(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetInt64(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetUint64(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetFloat32(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SetFloat64(const v8::FunctionCallbackInfo<v8::Value>& args);

  // -- Callbacks (JS -> native function pointer) --
  // JS: binding.registerCallback(libId, 'void', ['i32'], myFn) -> [id, ptr]
  static void RegisterCallback(
      const v8::FunctionCallbackInfo<v8::Value>& args);
  // JS: binding.unregisterCallback(callbackId)
  static void UnregisterCallback(
      const v8::FunctionCallbackInfo<v8::Value>& args);

  // -- Internal helpers --

  // Converts a JS string like 'f64' to the FFIType enum value kFloat64.
  static FFIType ParseTypeString(v8::Isolate* isolate,
                                 v8::Local<v8::Value> val);

  // Gets (or creates) the FFIState for the current thread/environment.
  // Returns nullptr on OOM; callers must check. Prefer GetStateOrThrow
  // when the caller is a binding entrypoint that can surface a JS Error.
  static FFIState* GetState(Environment* env);

  // Same as GetState but throws a JS Error on OOM. Returns nullptr when
  // a throw occurred — caller should early return.
  static FFIState* GetStateOrThrow(Environment* env);

  // Security check: C strings can't contain null bytes mid-string.
  static bool ContainsNullByte(const char* str, size_t len);

  // Template methods for get/set -- C++ generics (like TypeScript generics,
  // but the compiler generates a separate version for each type: int8_t,
  // uint8_t, int16_t, etc.).
  template <typename T>
  static void GetValue(const v8::FunctionCallbackInfo<v8::Value>& args);
  template <typename T>
  static void SetValue(const v8::FunctionCallbackInfo<v8::Value>& args);
};

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_FFI_BINDING_H_
