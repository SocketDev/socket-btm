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

// Per-environment FFI state. Uses thread-local storage with cleanup hooks
// to ensure isolation between Workers and proper shutdown.
struct FFIState {
  std::unordered_map<uint32_t, std::unique_ptr<FFILibrary>> libraries;
  std::unordered_map<uint32_t, std::unique_ptr<FFIFunction>> functions;
  uint32_t next_library_id = 1;
  uint32_t next_function_id = 1;

  ~FFIState();
};

// V8 binding for node:smol-ffi — cross-platform FFI via libuv.
class FFIBinding {
 public:
  static void Initialize(
    v8::Local<v8::Object> target,
    v8::Local<v8::Value> unused,
    v8::Local<v8::Context> context,
    void* priv);
  static void RegisterExternalReferences(ExternalReferenceRegistry* registry);

 private:
  static void Open(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Close(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Sym(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Call(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void PtrToBuffer(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void BufferToPtr(const v8::FunctionCallbackInfo<v8::Value>& args);

  static FFIType ParseTypeString(v8::Isolate* isolate, v8::Local<v8::Value> val);
  static FFIState* GetState(Environment* env);
};

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_FFI_BINDING_H_
