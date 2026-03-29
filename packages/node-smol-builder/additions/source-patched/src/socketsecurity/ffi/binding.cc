// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// binding.cc
// V8 binding for node:smol-ffi — cross-platform FFI via libuv.
//
// Self-contained in additions/ — survives Node.js upstream updates without
// patches to any upstream .cc files. Only requires the one-line binding
// registration in the node_binding patch.

#include "socketsecurity/ffi/binding.h"

#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "node_external_reference.h"
#include "util-inl.h"
#include "v8.h"

#include <uv.h>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace ffi {

using v8::Array;
using v8::ArrayBuffer;
using v8::BigInt;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::External;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Int32;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Uint32;
using v8::Uint8Array;
using v8::Value;

// Per-environment FFI state via thread-local storage with cleanup hooks.
// Tracks the owning Environment* to handle Workers correctly — if a different
// Environment runs on the same thread, we create a new state for it.
static thread_local FFIState* tl_ffi_state = nullptr;
static thread_local Environment* tl_ffi_env = nullptr;

static void FFIStateCleanup(void* data) {
  auto* state = static_cast<FFIState*>(data);
  if (tl_ffi_state == state) {
    tl_ffi_state = nullptr;
    tl_ffi_env = nullptr;
  }
  delete state;
}

FFIState::~FFIState() {
  for (auto& pair : libraries) {
    FFILibrary* lib = pair.second.get();
    if (!lib->closed && lib->handle != nullptr) {
      auto* uv_lib = static_cast<uv_lib_t*>(lib->handle);
      uv_dlclose(uv_lib);
      delete uv_lib;
      lib->handle = nullptr;
      lib->closed = true;
    }
  }
}

FFIState* FFIBinding::GetState(Environment* env) {
  CHECK_NOT_NULL(env);
  if (tl_ffi_state == nullptr || tl_ffi_env != env) {
    tl_ffi_state = new FFIState();
    tl_ffi_env = env;
    env->AddCleanupHook(FFIStateCleanup, tl_ffi_state);
  }
  return tl_ffi_state;
}

// Parse a JS type string ('int', 'uint', 'f64', 'pointer', etc.) to FFIType.
FFIType FFIBinding::ParseTypeString(Isolate* isolate, Local<Value> val) {
  if (!val->IsString()) return FFIType::kVoid;

  String::Utf8Value type_str(isolate, val);
  if (*type_str == nullptr) return FFIType::kVoid;

  const char* s = *type_str;
  if (strcmp(s, "void") == 0)    return FFIType::kVoid;
  if (strcmp(s, "bool") == 0)    return FFIType::kBool;
  if (strcmp(s, "i8") == 0)      return FFIType::kInt8;
  if (strcmp(s, "u8") == 0)      return FFIType::kUint8;
  if (strcmp(s, "i16") == 0)     return FFIType::kInt16;
  if (strcmp(s, "u16") == 0)     return FFIType::kUint16;
  if (strcmp(s, "int") == 0)     return FFIType::kInt32;
  if (strcmp(s, "i32") == 0)     return FFIType::kInt32;
  if (strcmp(s, "uint") == 0)    return FFIType::kUint32;
  if (strcmp(s, "u32") == 0)     return FFIType::kUint32;
  if (strcmp(s, "i64") == 0)     return FFIType::kInt64;
  if (strcmp(s, "u64") == 0)     return FFIType::kUint64;
  if (strcmp(s, "f32") == 0)     return FFIType::kFloat32;
  if (strcmp(s, "float") == 0)   return FFIType::kFloat32;
  if (strcmp(s, "f64") == 0)     return FFIType::kFloat64;
  if (strcmp(s, "double") == 0)  return FFIType::kFloat64;
  if (strcmp(s, "pointer") == 0) return FFIType::kPointer;
  if (strcmp(s, "ptr") == 0)     return FFIType::kPointer;
  if (strcmp(s, "string") == 0)  return FFIType::kString;
  if (strcmp(s, "buffer") == 0)  return FFIType::kBuffer;

  return FFIType::kVoid;
}

// ffi.open(path) -> libraryId
void FFIBinding::Open(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsString()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "open() requires a string path")
        .ToLocalChecked()));
    return;
  }

  String::Utf8Value path(isolate, args[0]);
  if (*path == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Invalid path").ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetState(env);

  auto lib = std::make_unique<FFILibrary>();
  lib->handle = nullptr;
  lib->closed = false;

  // Use libuv for cross-platform dlopen.
  uv_lib_t uv_lib;
  int err = uv_dlopen(*path, &uv_lib);
  if (err != 0) {
    const char* errmsg = uv_dlerror(&uv_lib);
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, errmsg ? errmsg : "dlopen failed")
        .ToLocalChecked()));
    uv_dlclose(&uv_lib);
    return;
  }

  auto* stored_lib = new uv_lib_t(uv_lib);
  lib->handle = stored_lib;
  lib->id = state->next_library_id++;

  uint32_t id = lib->id;
  state->libraries[id] = std::move(lib);

  args.GetReturnValue().Set(Uint32::New(isolate, id));
}

// ffi.close(libraryId)
void FFIBinding::Close(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "close() requires a library ID")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetState(env);

  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);

  auto it = state->libraries.find(id);
  if (it == state->libraries.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Library not found").ToLocalChecked()));
    return;
  }

  FFILibrary* lib = it->second.get();
  if (!lib->closed && lib->handle != nullptr) {
    auto* uv_lib = static_cast<uv_lib_t*>(lib->handle);
    uv_dlclose(uv_lib);
    delete uv_lib;
    lib->handle = nullptr;
    lib->closed = true;
  }

  for (auto fn_it = state->functions.begin();
       fn_it != state->functions.end();) {
    if (fn_it->second->library_id == id) {
      fn_it = state->functions.erase(fn_it);
    } else {
      ++fn_it;
    }
  }

  state->libraries.erase(it);
}

// ffi.sym(libraryId, symbolName, returnType, [paramTypes]) -> functionId
void FFIBinding::Sym(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "sym() requires (libraryId, name, returnType, [paramTypes])")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetState(env);

  uint32_t lib_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto lib_it = state->libraries.find(lib_id);
  if (lib_it == state->libraries.end() || lib_it->second->closed) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Library not found or closed")
        .ToLocalChecked()));
    return;
  }

  String::Utf8Value symbol_name(isolate, args[1]);
  if (*symbol_name == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Invalid symbol name").ToLocalChecked()));
    return;
  }

  // Resolve the symbol via libuv.
  auto* uv_lib = static_cast<uv_lib_t*>(lib_it->second->handle);
  void* fn_ptr = nullptr;
  int err = uv_dlsym(uv_lib, *symbol_name, &fn_ptr);
  if (err != 0) {
    const char* errmsg = uv_dlerror(uv_lib);
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, errmsg ? errmsg : "Symbol not found")
        .ToLocalChecked()));
    return;
  }

  // Parse return type.
  FFIType ret_type = ParseTypeString(isolate, args[2]);

  // Parse parameter types.
  FFISignature sig;
  sig.return_type = ret_type;
  sig.param_count = 0;

  if (args.Length() >= 4 && args[3]->IsArray()) {
    Local<Array> param_arr = args[3].As<Array>();
    sig.param_count = param_arr->Length();
    if (sig.param_count > kMaxFFIParams) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "Too many parameters (max 16)")
          .ToLocalChecked()));
      return;
    }
    for (size_t i = 0; i < sig.param_count; ++i) {
      Local<Value> pt = param_arr->Get(context, i).ToLocalChecked();
      sig.param_types[i] = ParseTypeString(isolate, pt);
    }
  }

  // Validate that the slow-path dispatcher supports this signature.
  // Supported return types: void, bool, i32, u32, f64, pointer.
  // Supported param types: all integer/pointer types + f64 (limited combos).
  // Unsupported: f32, i64/u64 as params, buffer, string return.
  switch (sig.return_type) {
    case FFIType::kVoid:
    case FFIType::kBool:
    case FFIType::kInt32:
    case FFIType::kUint32:
    case FFIType::kFloat64:
    case FFIType::kPointer:
      break;
    default:
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate,
          "Unsupported return type for slow-path dispatcher")
          .ToLocalChecked()));
      return;
  }

  auto func = std::make_unique<FFIFunction>();
  func->fn_ptr = fn_ptr;
  func->id = state->next_function_id++;
  func->library_id = lib_id;
  func->signature = sig;
  func->has_fast_path = false;  // V8 fast path not yet wired to JS API

  uint32_t fn_id = func->id;
  state->functions[fn_id] = std::move(func);

  args.GetReturnValue().Set(Uint32::New(isolate, fn_id));
}

// ffi.call(functionId, ...args) -> returnValue
// Generic slow-path dispatcher. Marshals JS values through a buffer
// and invokes the native function.
void FFIBinding::Call(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "call() requires a function ID")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetState(env);

  uint32_t fn_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto fn_it = state->functions.find(fn_id);
  if (fn_it == state->functions.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Function not found").ToLocalChecked()));
    return;
  }

  FFIFunction* func = fn_it->second.get();
  const FFISignature& sig = func->signature;

  // Verify argument count.
  size_t js_arg_count = args.Length() - 1;  // Subtract function ID
  if (js_arg_count != sig.param_count) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Wrong number of arguments")
        .ToLocalChecked()));
    return;
  }

  // Marshal arguments into a native buffer.
  // For each parameter, convert the JS value to the appropriate C type
  // and store it in a stack-allocated argument array.
  //
  // NOTE: This is the slow path. For hot calls, the V8 Fast API trampoline
  // bypasses this entirely and calls the function pointer directly.

  // We use a union to hold each argument value.
  union ArgValue {
    bool b;
    int8_t i8;
    uint8_t u8;
    int16_t i16;
    uint16_t u16;
    int32_t i32;
    uint32_t u32;
    int64_t i64;
    uint64_t u64;
    float f32;
    double f64;
    void* ptr;
  };

  ArgValue arg_values[kMaxFFIParams] = {};
  const char* string_storage[kMaxFFIParams];  // Keep strings alive during call

  for (size_t i = 0; i < sig.param_count; ++i) {
    Local<Value> js_arg = args[i + 1];
    string_storage[i] = nullptr;

    switch (sig.param_types[i]) {
      case FFIType::kBool:
        arg_values[i].b = js_arg->BooleanValue(isolate);
        break;
      case FFIType::kInt8:
        arg_values[i].i8 =
          static_cast<int8_t>(js_arg->Int32Value(context).FromMaybe(0));
        break;
      case FFIType::kUint8:
        arg_values[i].u8 =
          static_cast<uint8_t>(js_arg->Uint32Value(context).FromMaybe(0));
        break;
      case FFIType::kInt16:
        arg_values[i].i16 =
          static_cast<int16_t>(js_arg->Int32Value(context).FromMaybe(0));
        break;
      case FFIType::kUint16:
        arg_values[i].u16 =
          static_cast<uint16_t>(js_arg->Uint32Value(context).FromMaybe(0));
        break;
      case FFIType::kInt32:
        arg_values[i].i32 = js_arg->Int32Value(context).FromMaybe(0);
        break;
      case FFIType::kUint32:
        arg_values[i].u32 = js_arg->Uint32Value(context).FromMaybe(0);
        break;
      case FFIType::kInt64:
        if (js_arg->IsBigInt()) {
          bool lossless;
          arg_values[i].i64 = js_arg.As<BigInt>()->Int64Value(&lossless);
          if (!lossless) {
            isolate->ThrowException(Exception::RangeError(
              String::NewFromUtf8(isolate,
                "BigInt value does not fit in int64")
                .ToLocalChecked()));
            goto cleanup;
          }
        } else {
          arg_values[i].i64 =
            static_cast<int64_t>(js_arg->IntegerValue(context).FromMaybe(0));
        }
        break;
      case FFIType::kUint64:
        if (js_arg->IsBigInt()) {
          bool lossless;
          arg_values[i].u64 = js_arg.As<BigInt>()->Uint64Value(&lossless);
          if (!lossless) {
            isolate->ThrowException(Exception::RangeError(
              String::NewFromUtf8(isolate,
                "BigInt value does not fit in uint64")
                .ToLocalChecked()));
            goto cleanup;
          }
        } else {
          arg_values[i].u64 =
            static_cast<uint64_t>(js_arg->IntegerValue(context).FromMaybe(0));
        }
        break;
      case FFIType::kFloat32:
        arg_values[i].f32 =
          static_cast<float>(js_arg->NumberValue(context).FromMaybe(0.0));
        break;
      case FFIType::kFloat64:
        arg_values[i].f64 = js_arg->NumberValue(context).FromMaybe(0.0);
        break;
      case FFIType::kPointer:
        if (js_arg->IsNull() || js_arg->IsUndefined()) {
          arg_values[i].ptr = nullptr;
        } else if (js_arg->IsArrayBufferView()) {
          arg_values[i].ptr = Buffer::Data(js_arg);
        } else if (js_arg->IsBigInt()) {
          bool lossless;
          arg_values[i].ptr = reinterpret_cast<void*>(
            js_arg.As<BigInt>()->Uint64Value(&lossless));
        } else {
          arg_values[i].ptr = nullptr;
        }
        break;
      case FFIType::kString: {
        if (js_arg->IsNull() || js_arg->IsUndefined()) {
          arg_values[i].ptr = nullptr;
        } else {
          String::Utf8Value str(isolate, js_arg);
          if (*str == nullptr) {
            arg_values[i].ptr = nullptr;
            break;
          }
          size_t len = str.length();
          char* copy = new char[len + 1];
          memcpy(copy, *str, len);
          copy[len] = '\0';
          string_storage[i] = copy;
          arg_values[i].ptr = copy;
        }
        break;
      }
      case FFIType::kBuffer:
        if (js_arg->IsArrayBufferView()) {
          arg_values[i].ptr = Buffer::Data(js_arg);
        } else {
          arg_values[i].ptr = nullptr;
        }
        break;
      default:
        arg_values[i].ptr = nullptr;
        break;
    }
  }

  // Call the native function.
  // For simplicity, we use a platform-native call through a function pointer
  // cast. This handles the common case of simple signatures on x64/arm64
  // where arguments are passed in registers following the standard ABI.
  //
  // For production use with complex signatures (struct returns, variadic),
  // integrate libffi here. The slow path is already behind V8's argument
  // marshaling overhead, so libffi's ~100ns overhead is negligible.

  // Build argument pointer array for platform call.
  void* arg_ptrs[kMaxFFIParams];
  for (size_t i = 0; i < sig.param_count; ++i) {
    arg_ptrs[i] = &arg_values[i];
  }

  // Generic call dispatch by param count and return type.
  // We use type-correct function pointer casts to ensure the C ABI
  // passes arguments in the correct registers (integer vs FPU/SIMD).

  // Convert each argument to a register-sized integer via memcpy (well-defined
  // behavior, unlike reinterpret_cast through union). Zero-initialized
  // arg_values ensures small types have no padding garbage.
  uintptr_t arg_regs[kMaxFFIParams] = {};
  for (size_t i = 0; i < sig.param_count; ++i) {
    memcpy(&arg_regs[i], &arg_values[i],
           FFITypeSize(sig.param_types[i]) < sizeof(uintptr_t)
             ? FFITypeSize(sig.param_types[i]) : sizeof(uintptr_t));
  }

#define ARG_I(n) (arg_regs[(n)])
#define ARG_F64(n) (arg_values[(n)].f64)

  void* fn = func->fn_ptr;
  Local<Value> result;

  // Check if any parameter is a float/double (needs FPU register passing).
  bool has_float_params = false;
  for (size_t i = 0; i < sig.param_count; ++i) {
    if (sig.param_types[i] == FFIType::kFloat32 ||
        sig.param_types[i] == FFIType::kFloat64) {
      has_float_params = true;
      break;
    }
  }

  // For signatures with float/double params, use type-correct dispatch
  // to ensure the C ABI passes values in FPU registers (XMM on x64,
  // V registers on ARM64) rather than integer registers.
  if (has_float_params) {
    // Only support the most common float patterns.
    if (sig.param_count == 1 && sig.param_types[0] == FFIType::kFloat64) {
      if (sig.return_type == FFIType::kFloat64) {
        double ret = ((double(*)(double))fn)(ARG_F64(0));
        result = Number::New(isolate, ret);
      } else if (sig.return_type == FFIType::kInt32 ||
                 sig.return_type == FFIType::kBool) {
        int32_t ret = ((int32_t(*)(double))fn)(ARG_F64(0));
        result = sig.return_type == FFIType::kBool
          ? Boolean::New(isolate, ret != 0).As<Value>()
          : Int32::New(isolate, ret).As<Value>();
      } else if (sig.return_type == FFIType::kVoid) {
        ((void(*)(double))fn)(ARG_F64(0));
        result = v8::Undefined(isolate);
      } else {
        isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate,
            "Unsupported return type for float-param function")
            .ToLocalChecked()));
        goto cleanup;
      }
    } else if (sig.param_count == 2 &&
               sig.param_types[0] == FFIType::kFloat64 &&
               sig.param_types[1] == FFIType::kFloat64) {
      if (sig.return_type == FFIType::kFloat64) {
        double ret = ((double(*)(double, double))fn)(ARG_F64(0), ARG_F64(1));
        result = Number::New(isolate, ret);
      } else {
        isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate,
            "Unsupported return type for (f64, f64) function")
            .ToLocalChecked()));
        goto cleanup;
      }
    } else {
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate,
          "Complex float signatures not yet supported in slow path")
          .ToLocalChecked()));
      goto cleanup;
    }
  } else {
    // Integer/pointer-only params — safe to pass through uintptr_t registers.
    switch (sig.return_type) {
      case FFIType::kVoid: {
        switch (sig.param_count) {
          case 0: ((void(*)())fn)(); break;
          case 1: ((void(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ((void(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ((void(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          case 4: ((void(*)(uintptr_t, uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "void functions with >4 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = v8::Undefined(isolate);
        break;
      }
      case FFIType::kBool:
      case FFIType::kInt32: {
        int32_t ret;
        switch (sig.param_count) {
          case 0: ret = ((int32_t(*)())fn)(); break;
          case 1: ret = ((int32_t(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((int32_t(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((int32_t(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          case 4: ret = ((int32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "int functions with >4 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        if (sig.return_type == FFIType::kBool) {
          result = Boolean::New(isolate, ret != 0);
        } else {
          result = Int32::New(isolate, ret);
        }
        break;
      }
      case FFIType::kUint32: {
        uint32_t ret;
        switch (sig.param_count) {
          case 0: ret = ((uint32_t(*)())fn)(); break;
          case 1: ret = ((uint32_t(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((uint32_t(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((uint32_t(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "uint functions with >3 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = Uint32::New(isolate, ret);
        break;
      }
      case FFIType::kFloat64: {
        // No float params (checked above), so all args are integer/pointer.
        double ret;
        switch (sig.param_count) {
          case 0: ret = ((double(*)())fn)(); break;
          case 1: ret = ((double(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((double(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "double functions with >2 integer params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = Number::New(isolate, ret);
        break;
      }
      case FFIType::kPointer: {
        void* ret;
        switch (sig.param_count) {
          case 0: ret = ((void*(*)())fn)(); break;
          case 1: ret = ((void*(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((void*(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((void*(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "ptr functions with >3 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        if (ret == nullptr) {
          result = Null(isolate);
        } else {
          result = BigInt::NewFromUnsigned(isolate,
            reinterpret_cast<uint64_t>(ret));
        }
        break;
      }
      default:
        isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate, "Unsupported return type")
            .ToLocalChecked()));
        goto cleanup;
    }
  }

  args.GetReturnValue().Set(result);

#undef ARG_I
#undef ARG_F64

cleanup:
  // Free any string copies we allocated.
  for (size_t i = 0; i < sig.param_count; ++i) {
    if (string_storage[i] != nullptr) {
      delete[] string_storage[i];
    }
  }
}

// ffi.ptrToBuffer(ptrBigInt, length) -> Buffer
void FFIBinding::PtrToBuffer(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2 || !args[0]->IsBigInt()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "ptrToBuffer() requires (ptrBigInt, length)")
        .ToLocalChecked()));
    return;
  }

  bool lossless;
  uint64_t ptr_val = args[0].As<BigInt>()->Uint64Value(&lossless);
  size_t length = static_cast<size_t>(
    args[1]->IntegerValue(context).FromMaybe(0));

  if (ptr_val == 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Cannot read from null pointer")
        .ToLocalChecked()));
    return;
  }

  // Create a Buffer that copies from the pointer (safe — no dangling refs).
  auto* data = reinterpret_cast<const char*>(ptr_val);
  auto maybe_buf = node::Buffer::Copy(
    Environment::GetCurrent(isolate), data, length);
  if (maybe_buf.IsEmpty()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Failed to allocate buffer")
        .ToLocalChecked()));
    return;
  }
  args.GetReturnValue().Set(maybe_buf.ToLocalChecked());
}

// ffi.bufferToPtr(buffer) -> BigInt
void FFIBinding::BufferToPtr(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsArrayBufferView()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "bufferToPtr() requires a Buffer")
        .ToLocalChecked()));
    return;
  }

  void* data = Buffer::Data(args[0]);
  args.GetReturnValue().Set(
    BigInt::NewFromUnsigned(isolate, reinterpret_cast<uint64_t>(data)));
}

// Module initialization.
void FFIBinding::Initialize(
    Local<Object> target,
    Local<Value> unused,
    Local<Context> context,
    void* priv) {
  SetMethod(context, target, "open", Open);
  SetMethod(context, target, "close", Close);
  SetMethod(context, target, "sym", Sym);
  SetMethod(context, target, "call", Call);
  SetMethod(context, target, "ptrToBuffer", PtrToBuffer);
  SetMethod(context, target, "bufferToPtr", BufferToPtr);
}

void FFIBinding::RegisterExternalReferences(
    ExternalReferenceRegistry* registry) {
  registry->Register(Open);
  registry->Register(Close);
  registry->Register(Sym);
  registry->Register(Call);
  registry->Register(PtrToBuffer);
  registry->Register(BufferToPtr);
}

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_ffi,
    node::socketsecurity::ffi::FFIBinding::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_ffi,
    node::socketsecurity::ffi::FFIBinding::RegisterExternalReferences)
