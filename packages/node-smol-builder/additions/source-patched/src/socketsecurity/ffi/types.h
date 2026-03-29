#ifndef SRC_SOCKETSECURITY_FFI_TYPES_H_
#define SRC_SOCKETSECURITY_FFI_TYPES_H_

#include <cstddef>
#include <cstdint>

namespace node {
namespace socketsecurity {
namespace ffi {

// FFI type identifiers matching the JS-side type strings.
// Maps between JavaScript type names, C ABI types, and V8 fast call types.
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
  kBuffer,    // uint8_t* + length pair
};

// Maximum number of parameters for a single FFI function.
static constexpr size_t kMaxFFIParams = 16;

// Signature descriptor for an FFI function.
struct FFISignature {
  FFIType return_type;
  FFIType param_types[kMaxFFIParams];
  size_t param_count;
};

// Represents a loaded native library handle.
struct FFILibrary {
  void* handle;       // Platform-specific library handle (from uv_dlopen)
  uint32_t id;        // Unique ID for JS reference
  bool closed;        // Whether the library has been closed
};

// Represents a resolved native function symbol.
struct FFIFunction {
  void* fn_ptr;              // Raw function pointer from dlsym
  uint32_t id;               // Unique ID for JS reference
  uint32_t library_id;       // Owning library ID
  FFISignature signature;    // Parameter and return type info
  bool has_fast_path;        // Whether V8 fast call is available
};

// Size of each FFI type in bytes (for buffer marshaling).
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

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_FFI_TYPES_H_
