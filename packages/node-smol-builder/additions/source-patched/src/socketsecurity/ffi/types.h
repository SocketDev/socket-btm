// ============================================================================
// types.h -- Data type definitions for the FFI module
// ============================================================================
//
// This is a HEADER FILE (.h). In C++, code is split into two parts:
//   .h (header): Declares what exists -- like a TypeScript .d.ts file
//   .cc (source): Defines the implementation -- like the .js file
//
// WHAT THIS FILE DOES
// Defines the data structures and type constants that the entire FFI module
// shares. Every .cc file in the FFI module includes this header so they all
// agree on what an "FFIType" or "FFISignature" looks like.
//
// WHY IT EXISTS
// When you write `lib.func('sqrt', 'f64', ['f64'])` in JavaScript, the
// strings 'f64', 'i32', 'pointer', etc. need to be mapped to actual C types
// so the CPU knows how many bytes each argument uses and which register to
// put it in. This file defines that mapping.
//
// KEY CONCEPTS FOR JS DEVELOPERS
// - `enum class`: Like a frozen object with named numeric constants.
//     In JS terms: const FFIType = { kVoid: 0, kBool: 1, kInt8: 2, ... }
// - `struct`: Like a plain JS object with fixed, typed fields.
//     In JS terms: { return_type: FFIType, param_types: FFIType[], ... }
// - `constexpr`: A value computed at compile time, not at runtime.
//     In JS terms: like a `const` that the bundler inlines everywhere.
// - `inline`: Tells the compiler to copy the function body into each call
//     site instead of making a function call. Faster for tiny functions.
// ============================================================================

#ifndef SRC_SOCKETSECURITY_FFI_TYPES_H_
#define SRC_SOCKETSECURITY_FFI_TYPES_H_

#include <cstddef>
#include <cstdint>

namespace node {
namespace socketsecurity {
namespace ffi {

// ============================================================================
// FFI type enum -- maps JS type strings to numeric IDs
// ============================================================================
//
// When you call `lib.func('sqrt', 'f64', ['f64'])`, the string 'f64' is
// converted to `FFIType::kFloat64` (value 14). This numeric ID is used
// everywhere internally to decide how to pass arguments to native functions.
//
// `enum class` is like a frozen JS object of named constants:
//   In JS terms: const FFIType = Object.freeze({ kVoid: 0, kBool: 1, ... })
// The `: uint8_t` means each value fits in a single byte (0-255).
enum class FFIType : uint8_t {
  kVoid = 0,
  kBool,
  kInt8,
  kUint8,
  kInt16,
  kUint16,
  kInt32,
  kUint32,
  kInt64,
  kUint64,
  kFloat32,
  kFloat64,
  kPointer,
  kString,    // const char* — null-terminated
  kBuffer,    // uint8_t* from Buffer/ArrayBuffer/TypedArray
};

// ============================================================================
// Constants and data structures
// ============================================================================

// Maximum number of parameters for a single FFI function.
// In JS terms: if you try to call a C function with more than 16 args, it fails.
static constexpr size_t kMaxFFIParams = 16;

// Maximum number of JS callbacks that can be active as native function pointers
// at the same time. Think of this as a fixed-size pool -- like having 64 parking
// spaces for callbacks.
static constexpr size_t kMaxCallbackSlots = 64;

// Describes a C function's calling convention: what it returns and what it takes.
// In JS terms, this is like: { returnType: 'f64', paramTypes: ['f64'] }
// but stored as numeric enum values for fast comparison.
struct FFISignature {
  FFIType return_type;
  FFIType param_types[kMaxFFIParams];
  size_t param_count;
};

// Represents a loaded native library (like libm.so or user32.dll).
// In JS terms: the object returned by `ffi.open('libm.so')`.
// `void*` is a raw memory address -- like a BigInt pointer in JS. It can
// point to anything; C++ doesn't track what type it points to.
struct FFILibrary {
  void* handle;       // Platform-specific library handle (from uv_dlopen)
  uint32_t id;        // Unique ID for JS reference
  bool closed;        // Whether the library has been closed
};

// Represents a resolved native function (like `sqrt` from libm).
// In JS terms: the info behind the wrapper returned by `lib.func('sqrt', ...)`.
// The `fn_ptr` is the actual memory address of the C function's machine code.
struct FFIFunction {
  void* fn_ptr;              // Raw function pointer from dlsym
  uint32_t id;               // Unique ID for JS reference
  uint32_t library_id;       // Owning library ID
  FFISignature signature;    // Parameter and return type info
  bool has_fast_path;        // Whether V8 fast call is available
};

// Represents a JS callback exported as a native function pointer.
// When C code needs to call back into JS (e.g., a sort comparator, an event
// handler), we give C a real function pointer that secretly calls your JS
// function. Uses a pre-allocated trampoline slot from a fixed pool -- no
// runtime code generation, no platform-specific assembly.
struct FFICallback {
  uint32_t id;               // Unique ID for JS reference
  uint32_t library_id;       // Owning library ID
  uint32_t slot_index;       // Index into the trampoline slot pool
  FFISignature signature;    // Parameter and return type info
  bool alive;                // Whether the callback is still valid
};

// ============================================================================
// Type helper functions
// ============================================================================

// Returns how many bytes each type occupies in memory.
// In JS terms: like a lookup table { 'void': 0, 'bool': 1, 'i32': 4, ... }
// This is needed to know how many bytes to copy when passing arguments to C.
inline size_t FFITypeSize(FFIType type) {
  switch (type) {
    case FFIType::kVoid:    return 0;
    case FFIType::kBool:    return sizeof(bool);
    case FFIType::kInt8:    return 1;
    case FFIType::kUint8:   return 1;
    case FFIType::kInt16:   return 2;
    case FFIType::kUint16:  return 2;
    case FFIType::kInt32:   return 4;
    case FFIType::kUint32:  return 4;
    case FFIType::kInt64:   return 8;
    case FFIType::kUint64:  return 8;
    case FFIType::kFloat32: return 4;
    case FFIType::kFloat64: return 8;
    case FFIType::kPointer: return sizeof(void*);
    case FFIType::kString:  return sizeof(void*);
    case FFIType::kBuffer:  return sizeof(void*);
  }
  return 0;
}

// Whether a type is a simple primitive (eligible for V8 fast call path).
// V8's "fast API" can optimize calls that only use simple types (numbers and
// pointers), skipping the overhead of boxing/unboxing JS values.
inline bool FFITypeIsPrimitive(FFIType type) {
  switch (type) {
    case FFIType::kVoid:
    case FFIType::kBool:
    case FFIType::kInt32:
    case FFIType::kUint32:
    case FFIType::kInt64:
    case FFIType::kUint64:
    case FFIType::kFloat32:
    case FFIType::kFloat64:
    case FFIType::kPointer:
      return true;
    default:
      return false;
  }
}

// Whether a type is float/double. This matters because CPUs use completely
// different registers for floats vs integers (FPU registers vs general
// registers), so the calling code must know which path to take.
inline bool FFITypeIsFloat(FFIType type) {
  return type == FFIType::kFloat32 || type == FFIType::kFloat64;
}

// Whether a type is an integer or pointer. All of these can be passed in the
// same CPU register (a general-purpose register), unlike floats. `uintptr_t`
// is an unsigned integer big enough to hold any memory address on this platform.
inline bool FFITypeIsIntOrPtr(FFIType type) {
  switch (type) {
    case FFIType::kBool:
    case FFIType::kInt8:
    case FFIType::kUint8:
    case FFIType::kInt16:
    case FFIType::kUint16:
    case FFIType::kInt32:
    case FFIType::kUint32:
    case FFIType::kInt64:
    case FFIType::kUint64:
    case FFIType::kPointer:
    case FFIType::kString:
    case FFIType::kBuffer:
      return true;
    default:
      return false;
  }
}

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_FFI_TYPES_H_
