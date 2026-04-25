// ============================================================================
// binding.cc -- The main implementation of node:smol-ffi
// ============================================================================
//
// WHAT THIS FILE DOES
// This is the C++ engine behind `require('node:smol-ffi')`. When you write
// `lib.func('sqrt', 'f64', ['f64'])` and then call `sqrt(16)`, this file:
//   1. Loads the native library (.so/.dylib/.dll) into memory
//   2. Finds the `sqrt` function's address in that library
//   3. Converts your JS number `16` into a C double
//   4. Calls the native `sqrt` function at that address
//   5. Converts the C double result `4.0` back to a JS number
//
// WHY IT EXISTS
// Pure JavaScript cannot call C functions directly. V8 (the JS engine) only
// knows about JS values. This C++ code acts as a translator between the JS
// world (where everything is a Value) and the native world (where arguments
// are raw bytes in CPU registers). Without this, you'd need to write a
// native addon (.node file) for every C library you want to use.
//
// HOW JS USES THIS
// JS: internalBinding('smol_ffi') --> returns object with .open(), .call(), etc.
// User: require('node:smol-ffi') --> lib/smol-ffi.js -->
//       lib/internal/socketsecurity/ffi.js --> internalBinding('smol_ffi')
//
// KEY CONCEPTS FOR JS DEVELOPERS
// - FunctionCallbackInfo<Value>: What a C++ function receives when called
//     from JS. args[0], args[1]... are the JS arguments. You return a value
//     via args.GetReturnValue().Set(...) because V8's callback ABI uses a
//     void signature with an out-of-band return slot (not a C++ limitation).
// - Isolate: One V8 engine instance -- owns a JS heap and a GC. Each Worker
//     thread gets its own Isolate. NOT the same as a Node.js process (which
//     also has an event loop, IPC, etc. on top of the Isolate).
// - HandleScope: A handle lifetime boundary. When a HandleScope is destroyed,
//     all Local<T> handles created within it become invalid and their
//     referenced objects become eligible for GC. Not a "GC trigger" -- it just
//     marks the end of handle validity.
// - Local<T>: A reference to a JS value, scoped to the enclosing HandleScope.
//     Valid only while that HandleScope is active. Can be "escaped" to an
//     outer scope via EscapableHandleScope if needed.
// - Context: A V8 execution environment with its own global object and
//     built-ins (roughly an ECMAScript realm). NOT a browser iframe — no DOM
//     or origin model — but the same "isolated global scope" intuition.
// - Environment: Node.js's wrapper around V8's Isolate -- holds the event
//     loop, timers, module state. Like `global` but for C++ internals.
// - thread_local: A global variable that's different per thread. Like if
//     each Worker had its own `globalThis`.
// - reinterpret_cast: Reinterprets a value's type at the language level.
//     Whether the result is valid depends on alignment, aliasing, and ABI
//     rules. Used here to cast void* to typed function pointers — a
//     platform-specific ABI assumption, not standards-safe in general.
// - goto cleanup: A C-style pattern for funneling error exits through one
//     cleanup block. Not a true `finally` — only runs if code explicitly
//     jumps there. Node.js uses -fno-exceptions, so this is the practical
//     alternative to RAII for managing temporary allocations.
// ============================================================================

// HISTORY: WHY SUPPRESS V8 DEPRECATION WARNINGS
// V8 is deprecating Object::GetIsolate() because it's effectively just a
// "current isolate" lookup (V8 commit 11b9af509c83). Node.js internal
// headers still use it while straddling multiple V8 versions, so we
// suppress the warning rather than patching upstream headers. Node.js
// PRs #59805 and #60223 are cleaning this up in newer branches.

// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/ffi/binding.h"
#include "socketsecurity/ffi/trampoline.h"

#include "debug_utils-inl.h"
#include "env-inl.h"
#include "node.h"
#include "node_binding.h"
#include "node_buffer.h"
#include "node_debug.h"
#include "node_external_reference.h"
#include "util-inl.h"
#include "v8.h"

#include <uv.h>
#include <cstring>
#include <new>
#include <climits>
#include <cmath>
#include <thread>
#include <type_traits>

namespace node {
namespace socketsecurity {
namespace ffi {

// `using` statements are like JS destructuring imports:
//   const { Array, BigInt, String, ... } = v8;
// They let us write `String::New(...)` instead of `v8::String::New(...)`.
using v8::Array;
using v8::ArrayBuffer;
using v8::BackingStore;
using v8::BigInt;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::External;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Global;
using v8::HandleScope;
using v8::Int32;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Uint32;
using v8::Uint8Array;
using v8::Undefined;
using v8::Value;

// ============================================================================
// Per-environment state via TLS (Thread-Local Storage)
// ============================================================================
//
// Each thread (main thread, each Worker) gets its own FFIState so they
// can independently load libraries and call functions without races.
//
// HISTORY: WHY thread_local
// Node.js became multi-threaded in 2018 when Worker threads shipped in
// v10.5.0. Before that, process-global state was fine because there was
// only one JS thread. With Workers, each thread has its own V8 Isolate
// and Environment, so shared mutable globals cause data races. thread_local
// gives each thread its own copy. This also matters for Electron and other
// embedders that host multiple Node.js instances in one process.

// `thread_local` means each thread has its own copy of these variables.
// In JS terms: like if each Worker had its own `globalThis.ffiState`.
// `static` at file scope means these variables are private to this file
// (like a non-exported module variable in JS).

static thread_local FFIState* tl_ffi_state = nullptr;
static thread_local Environment* tl_ffi_env = nullptr;

// Called by Node.js when an Environment (thread) is shutting down.
// Deletes the FFIState, which triggers ~FFIState() to close all libraries
// and free all callback slots for that thread.
static void FFIStateCleanup(void* data) {
  auto* state = static_cast<FFIState*>(data);
  if (tl_ffi_state == state) {
    tl_ffi_state = nullptr;
    tl_ffi_env = nullptr;
  }
  // C++ has no GC -- we must explicitly `delete` heap-allocated objects.
  // This triggers the ~FFIState() destructor defined below.
  delete state;
}

// Destructor: automatically called when an FFIState is deleted.
// Cleans up all resources this thread allocated.
FFIState::~FFIState() {
  // Free callback slots and their persistent JS function handles.
  // Global<Function> is a pointers that prevent V8 from garbage-collecting
  // the JS function. We must manually .Reset() and delete them.
  for (auto& pair : callbacks) {
    FFICallback* cb = pair.second.get();
    if (cb->alive) {
      CallbackSlotData* slot_data = &g_callback_slots[cb->slot_index];
      if (slot_data->js_fn != nullptr) {
        auto* persistent = static_cast<Global<Function>*>(slot_data->js_fn);
        persistent->Reset();
        delete persistent;
        slot_data->js_fn = nullptr;
      }
      CallbackPoolFree(cb->slot_index);
      cb->alive = false;
    }
  }
  // Close all loaded native libraries.
  // uv_dlclose is libuv's cross-platform wrapper for dlclose (Unix) /
  // FreeLibrary (Windows). It unloads the .so/.dylib/.dll from memory.
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

// Gets or creates the FFIState for the current thread.
// Lazily creates state on first call, and registers a cleanup hook so
// Node.js will call FFIStateCleanup when this thread/Environment exits.
FFIState* FFIBinding::GetState(Environment* env) {
  CHECK_NOT_NULL(env);
  if (tl_ffi_state == nullptr || tl_ffi_env != env) {
    // Nothrow + skip AddCleanupHook on failure so OOM can't silently
    // register a nullptr cleanup callback. Callers check the return value
    // via GetStateOrThrow below.
    FFIState* fresh = new (std::nothrow) FFIState();
    if (fresh == nullptr) {
      return nullptr;
    }
    tl_ffi_state = fresh;
    tl_ffi_env = env;
    // HISTORY: WHY CLEANUP HOOKS INSTEAD OF DESTRUCTORS
    // With Worker threads, a binding's resources must die when that Worker's
    // Environment exits, not when the process exits. C++ destructors fire at
    // process shutdown and have no guaranteed ordering with libuv/V8 teardown.
    // Cleanup hooks run at the right time with a live isolate and event loop.
    // Node.js v12.19.0/v14.8.0 added async cleanup hooks for resources that
    // need ordered asynchronous shutdown.
    env->AddCleanupHook(FFIStateCleanup, tl_ffi_state);
  }
  return tl_ffi_state;
}

// Wraps GetState with a JS-level OOM error. Returns nullptr and throws
// when the per-thread state couldn't be allocated — callers should early
// return on nullptr.
FFIState* FFIBinding::GetStateOrThrow(Environment* env) {
  FFIState* state = GetState(env);
  if (state == nullptr) {
    v8::Isolate* isolate = env->isolate();
    isolate->ThrowException(v8::Exception::Error(
        FIXED_ONE_BYTE_STRING(isolate,
            "Out of memory: failed to allocate FFI state")));
  }
  return state;
}

// ============================================================================
// Null-byte validation
// ============================================================================
//
// C strings end at the first '\0' (null) byte. If a library path or symbol
// name contains a null byte, the C runtime would silently truncate it --
// a potential security issue (e.g., "libc.so\0.evil" would open "libc.so").
// This check prevents that.

bool FFIBinding::ContainsNullByte(const char* str, size_t len) {
  return len > 0 && memchr(str, '\0', len) != nullptr;
}

// ============================================================================
// Type string parsing
// ============================================================================
//
// Converts a JS type string (like 'f64', 'i32', 'pointer') to the internal
// FFIType enum. This is the C++ side of the mapping -- the JS side validates
// the string first, so this function just does the conversion.
// Returns kVoid as the default for unrecognized strings.

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
  if (strcmp(s, "str") == 0)     return FFIType::kString;
  if (strcmp(s, "buffer") == 0)  return FFIType::kBuffer;

  return FFIType::kVoid;
}

// ============================================================================
// Library lifecycle -- loading and unloading .so/.dylib/.dll files
// ============================================================================
//
// These functions handle opening (loading) and closing (unloading) native
// libraries. Under the hood, they use libuv's uv_dlopen/uv_dlclose which
// wrap the platform-specific system calls:
//   Linux/macOS: dlopen() / dlclose()
//   Windows:     LoadLibrary() / FreeLibrary()

// JS: const libId = binding.open('/usr/lib/libm.so.6')
// Opens a shared library and returns a numeric ID to reference it later.
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

  // Null-byte check.
  if (ContainsNullByte(*path, path.length())) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Library path must not contain null bytes")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

  // std::make_unique<T>() aborts on OOM because Node.js compiles with
  // -fno-exceptions. Construct with nothrow so we can surface OOM as a JS
  // TypeError and let the caller retry instead of killing the process.
  auto lib = std::unique_ptr<FFILibrary>(new (std::nothrow) FFILibrary());
  if (!lib) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
          "Out of memory: failed to allocate FFI library")
        .ToLocalChecked()));
    return;
  }
  lib->handle = nullptr;
  lib->closed = false;

  uv_lib_t uv_lib;
  int err = uv_dlopen(*path, &uv_lib);
  if (err != 0) {
    // uv_dlerror wraps dlerror()/FormatMessage; output is locale- and
    // ACP-dependent and may contain bytes that fail UTF-8 validation
    // (Windows MBCS, older glibc honoring LANG, etc.). Use ToLocal
    // with a fixed-ASCII fallback rather than aborting via
    // ToLocalChecked — turning a load failure into a process kill
    // would let user-supplied library paths escalate to remote DoS.
    const char* errmsg = uv_dlerror(&uv_lib);
    Local<String> err_str;
    if (!String::NewFromUtf8(isolate, errmsg ? errmsg : "dlopen failed")
            .ToLocal(&err_str)) {
      err_str = FIXED_ONE_BYTE_STRING(
          isolate, "dlopen failed (non-UTF-8 error)");
    }
    isolate->ThrowException(Exception::Error(err_str));
    uv_dlclose(&uv_lib);
    return;
  }

  // -fno-exceptions: nothrow + null-check so OOM surfaces as a JS Error
  // instead of aborting the process. Unload the native library on failure
  // so we don't leak the OS-level handle.
  auto* stored_lib = new (std::nothrow) uv_lib_t(uv_lib);
  if (!stored_lib) {
    uv_dlclose(&uv_lib);
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
          "Out of memory: failed to allocate FFI library handle")
        .ToLocalChecked()));
    return;
  }
  lib->handle = stored_lib;
  lib->id = state->next_library_id++;

  uint32_t id = lib->id;
  // FFIState reserves its hash buckets at construction (see binding.h)
  // so this insert is rehash-free for typical workloads and won't
  // bad_alloc under -fno-exceptions.
  state->libraries[id] = std::move(lib);

  args.GetReturnValue().Set(Uint32::New(isolate, id));
}

// JS: binding.close(libraryId)
// Unloads a library and cleans up all functions and callbacks that belong to it.
void FFIBinding::Close(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "close() requires a library ID")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

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

  // Clean up functions belonging to this library.
  for (auto fn_it = state->functions.begin();
       fn_it != state->functions.end();) {
    if (fn_it->second->library_id == id) {
      fn_it = state->functions.erase(fn_it);
    } else {
      ++fn_it;
    }
  }

  // Clean up callbacks belonging to this library.
  for (auto cb_it = state->callbacks.begin();
       cb_it != state->callbacks.end();) {
    if (cb_it->second->library_id == id) {
      if (cb_it->second->alive) {
        CallbackPoolFree(cb_it->second->slot_index);
        cb_it->second->alive = false;
      }
      cb_it = state->callbacks.erase(cb_it);
    } else {
      ++cb_it;
    }
  }

  state->libraries.erase(it);
}

// ============================================================================
// Symbol resolution -- finding functions inside loaded libraries
// ============================================================================
//
// Once a library is loaded, you need to find functions by name. This is like
// looking up a key in a dictionary: the library contains a "symbol table"
// mapping names like "sqrt" to memory addresses where the function's machine
// code lives.

// JS: const address = binding.dlsym(libId, 'sqrt') // -> BigInt
// Returns the raw memory address of a symbol. Used when you need the address
// itself (e.g., to pass as a function pointer to another C function).
void FFIBinding::Dlsym(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2 || !args[1]->IsString()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "dlsym() requires (libraryId, symbolName)")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

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

  if (ContainsNullByte(*symbol_name, symbol_name.length())) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "Symbol name must not contain null bytes")
        .ToLocalChecked()));
    return;
  }

  auto* uv_lib = static_cast<uv_lib_t*>(lib_it->second->handle);
  void* ptr = nullptr;
  int err = uv_dlsym(uv_lib, *symbol_name, &ptr);
  if (err != 0) {
    // Same UTF-8 hardening as uv_dlopen above.
    const char* errmsg = uv_dlerror(uv_lib);
    Local<String> err_str;
    if (!String::NewFromUtf8(isolate, errmsg ? errmsg : "Symbol not found")
            .ToLocal(&err_str)) {
      err_str = FIXED_ONE_BYTE_STRING(
          isolate, "dlsym failed (non-UTF-8 error)");
    }
    isolate->ThrowException(Exception::Error(err_str));
    return;
  }

  args.GetReturnValue().Set(
    BigInt::NewFromUnsigned(isolate, reinterpret_cast<uint64_t>(ptr)));
}

// JS: const [fnId, hasFast] = binding.sym(libId, 'sqrt', 'f64', ['f64'])
// Resolves a symbol AND binds its type signature, returning a function ID
// that can be used with binding.call(). Also checks if a V8 "fast path"
// trampoline exists for this signature (for better performance).
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
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

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

  // Null-byte check on symbol name.
  if (ContainsNullByte(*symbol_name, symbol_name.length())) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "Symbol name must not contain null bytes")
        .ToLocalChecked()));
    return;
  }

  // Resolve the symbol via libuv.
  auto* uv_lib = static_cast<uv_lib_t*>(lib_it->second->handle);
  void* fn_ptr = nullptr;
  int err = uv_dlsym(uv_lib, *symbol_name, &fn_ptr);
  if (err != 0) {
    // Same UTF-8 hardening as uv_dlopen above.
    const char* errmsg = uv_dlerror(uv_lib);
    Local<String> err_str;
    if (!String::NewFromUtf8(isolate, errmsg ? errmsg : "Symbol not found")
            .ToLocal(&err_str)) {
      err_str = FIXED_ONE_BYTE_STRING(
          isolate, "dlsym failed (non-UTF-8 error)");
    }
    isolate->ThrowException(Exception::Error(err_str));
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
      // Array::Get on a JS-caller-supplied Proxy can throw from the
      // get trap, returning an empty MaybeLocal. ToLocalChecked on
      // that aborts the whole isolate — user-space DoS. Treat a
      // failed Get as "void param" so the call is still buildable;
      // ParseTypeString will validate the defaulted value.
      Local<Value> pt;
      if (!param_arr->Get(context, i).ToLocal(&pt)) {
        sig.param_types[i] = FFIType::kVoid;
        continue;
      }
      sig.param_types[i] = ParseTypeString(isolate, pt);
    }
  }

  // Check if a V8 fast-path trampoline is available for this signature.
  bool has_fast = FFITrampoline::GetTrampoline(sig) != nullptr;

  // std::make_unique aborts on OOM under -fno-exceptions — use nothrow so
  // OOM becomes a JS error instead of killing the isolate.
  auto func = std::unique_ptr<FFIFunction>(new (std::nothrow) FFIFunction());
  if (!func) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
          "Out of memory: failed to allocate FFI function")
        .ToLocalChecked()));
    return;
  }
  func->fn_ptr = fn_ptr;
  func->id = state->next_function_id++;
  func->library_id = lib_id;
  func->signature = sig;
  func->has_fast_path = has_fast;

  uint32_t fn_id = func->id;
  state->functions[fn_id] = std::move(func);

  // Return [functionId, hasFastPath] so the JS layer can set up fast calls.
  Local<Array> result = Array::New(isolate, 2);
  result->Set(context, 0, Uint32::New(isolate, fn_id)).Check();
  result->Set(context, 1, Boolean::New(isolate, has_fast)).Check();
  args.GetReturnValue().Set(result);
}

// ============================================================================
// Function call dispatcher -- the heart of the FFI module
// ============================================================================
//
// This is where the actual "call a C function from JS" happens. The Call()
// function below:
//   1. Looks up the function by ID
//   2. Converts each JS argument to the correct C type (marshaling)
//   3. Calls the native function with the right calling convention
//   4. Converts the C return value back to a JS value
//
// The big switch statements handle every combination of parameter types and
// return types. This is verbose but intentional -- each case compiles to a
// direct function pointer call with the exact C signature, which is what the
// CPU's calling convention (ABI) requires.
//
// Think of it like this: in JS, all values are the same "shape." In C, an
// int32_t and a double are passed in completely different CPU registers.
// This code is the translator between those two worlds.

// Range validation helpers for small integer types.
// JS numbers can hold any value, but C int8_t only holds -128 to 127.
static bool ValidateI8(int32_t v) { return v >= INT8_MIN && v <= INT8_MAX; }
static bool ValidateU8(uint32_t v) { return v <= UINT8_MAX; }
static bool ValidateI16(int32_t v) { return v >= INT16_MIN && v <= INT16_MAX; }
static bool ValidateU16(uint32_t v) { return v <= UINT16_MAX; }

// JS: binding.setTarget(functionId)
// Stores the C function pointer in thread-local storage so the V8 Fast API
// trampoline can find it. Must be called immediately before call() in the
// JS wrapper. This is how the fast path avoids looking up the function by
// ID on every call -- the trampoline just reads the thread-local pointer.
void FFIBinding::SetTarget(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) return;

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

  uint32_t fn_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto fn_it = state->functions.find(fn_id);
  if (fn_it == state->functions.end()) return;

  FFITrampoline::SetActiveTarget(fn_it->second->fn_ptr);
}

// JS: binding.call(functionId, arg0, arg1, ...) -> returnValue
// This is the main entry point for calling a native C function from JS.
// It's the "slow path" -- every argument is a JS Value that must be
// inspected, validated, and converted to C types. The "fast path" in
// trampoline.cc bypasses all of this for simple signatures.
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
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

  uint32_t fn_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto fn_it = state->functions.find(fn_id);
  if (fn_it == state->functions.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Function not found").ToLocalChecked()));
    return;
  }

  FFIFunction* func = fn_it->second.get();
  const FFISignature& sig = func->signature;

  size_t js_arg_count = args.Length() - 1;
  if (js_arg_count != sig.param_count) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Wrong number of arguments")
        .ToLocalChecked()));
    return;
  }

  // If this function has a fast path, set the active target for the trampoline.
  // The actual fast call is wired via SetFastMethod on the JS side;
  // this slow-path call still sets the target for fallback scenarios.
  if (func->has_fast_path) {
    FFITrampoline::SetActiveTarget(func->fn_ptr);
  }

  // A union is a type that can hold ONE of several types at a time, sharing
  // the same memory. Like a JS variable that can be a number OR a boolean
  // OR a pointer, but the union only uses enough bytes for the largest type.
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

  // arg_values: the converted C values (one per parameter)
  // string_storage: temporary copies of JS strings (must be freed after call)
  // arg_regs: register-sized copies for the integer/pointer dispatch path
  ArgValue arg_values[kMaxFFIParams] = {};
  // Value-initialize string_storage so the cleanup loop below sees nullptr
  // (and skips delete[]) for slots the marshaling loop never reached. Any
  // goto cleanup taken mid-loop previously left trailing slots holding
  // stack garbage; the cleanup's null-check would pass by accident and
  // delete[] corrupt memory.
  const char* string_storage[kMaxFFIParams] = {};
  uintptr_t arg_regs[kMaxFFIParams] = {};
  void* fn = nullptr;
  Local<Value> result;
  bool has_float_params = false;

  // ---- Argument marshaling: convert each JS value to its C type ----
  // This loop processes each JS argument and stores the converted C value
  // in arg_values[i]. For string arguments, we allocate a temporary C
  // string copy (freed in the cleanup section at the bottom).
  for (size_t i = 0; i < sig.param_count; ++i) {
    Local<Value> js_arg = args[i + 1];
    string_storage[i] = nullptr;

    switch (sig.param_types[i]) {
      case FFIType::kBool:
        arg_values[i].b = js_arg->BooleanValue(isolate);
        break;
      case FFIType::kInt8: {
        int32_t v = js_arg->Int32Value(context).FromMaybe(0);
        if (!ValidateI8(v)) {
          isolate->ThrowException(Exception::RangeError(
            String::NewFromUtf8(isolate,
              "Value out of range for int8 (-128 to 127)")
              .ToLocalChecked()));
          goto cleanup;
        }
        arg_values[i].i8 = static_cast<int8_t>(v);
        break;
      }
      case FFIType::kUint8: {
        uint32_t v = js_arg->Uint32Value(context).FromMaybe(0);
        if (!ValidateU8(v)) {
          isolate->ThrowException(Exception::RangeError(
            String::NewFromUtf8(isolate,
              "Value out of range for uint8 (0 to 255)")
              .ToLocalChecked()));
          goto cleanup;
        }
        arg_values[i].u8 = static_cast<uint8_t>(v);
        break;
      }
      case FFIType::kInt16: {
        int32_t v = js_arg->Int32Value(context).FromMaybe(0);
        if (!ValidateI16(v)) {
          isolate->ThrowException(Exception::RangeError(
            String::NewFromUtf8(isolate,
              "Value out of range for int16 (-32768 to 32767)")
              .ToLocalChecked()));
          goto cleanup;
        }
        arg_values[i].i16 = static_cast<int16_t>(v);
        break;
      }
      case FFIType::kUint16: {
        uint32_t v = js_arg->Uint32Value(context).FromMaybe(0);
        if (!ValidateU16(v)) {
          isolate->ThrowException(Exception::RangeError(
            String::NewFromUtf8(isolate,
              "Value out of range for uint16 (0 to 65535)")
              .ToLocalChecked()));
          goto cleanup;
        }
        arg_values[i].u16 = static_cast<uint16_t>(v);
        break;
      }
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
        } else if (js_arg->IsArrayBuffer()) {
          auto store = js_arg.As<ArrayBuffer>()->GetBackingStore();
          arg_values[i].ptr = store ? store->Data() : nullptr;
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
          // -fno-exceptions: std::nothrow + null-check + ThrowException so
          // OOM surfaces as a JS Error instead of aborting the process.
          char* copy = new (std::nothrow) char[len + 1];
          if (!copy) {
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Out of memory: failed to allocate FFI string argument")
                .ToLocalChecked()));
            goto cleanup;
          }
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
        } else if (js_arg->IsArrayBuffer()) {
          auto store = js_arg.As<ArrayBuffer>()->GetBackingStore();
          arg_values[i].ptr = store ? store->Data() : nullptr;
        } else if (js_arg->IsNull() || js_arg->IsUndefined()) {
          arg_values[i].ptr = nullptr;
        } else {
          arg_values[i].ptr = nullptr;
        }
        break;
      default:
        arg_values[i].ptr = nullptr;
        break;
    }
  }

  // Copy each argument value into a register-sized (uintptr_t) slot.
  // CPUs pass integer/pointer arguments in general-purpose registers,
  // which are always pointer-sized (8 bytes on 64-bit). Small types like
  // int8_t get widened to fill the register.
  for (size_t i = 0; i < sig.param_count; ++i) {
    memcpy(&arg_regs[i], &arg_values[i],
           FFITypeSize(sig.param_types[i]) < sizeof(uintptr_t)
             ? FFITypeSize(sig.param_types[i]) : sizeof(uintptr_t));
  }

// Shorthand macros for accessing arguments in the dispatch code below.
// ARG_I(n) = integer/pointer arg n, ARG_F64(n) = double arg n.
#define ARG_I(n) (arg_regs[(n)])
#define ARG_F64(n) (arg_values[(n)].f64)
#define ARG_F32(n) (arg_values[(n)].f32)

  fn = func->fn_ptr;

  // Detect float params.
  for (size_t i = 0; i < sig.param_count; ++i) {
    if (FFITypeIsFloat(sig.param_types[i])) {
      has_float_params = true;
      break;
    }
  }

  // ========================================================================
  // Float/double parameter dispatch
  // ========================================================================
  //
  // Why separate float and integer dispatch? CPUs use different registers
  // for floats (XMM/SSE on x64, D-registers on ARM) vs integers (RAX, RDI,
  // etc. on x64). The C calling convention (ABI) requires floats to be
  // passed in the right register bank. If we cast a double to uintptr_t
  // and passed it as an integer, the C function would read garbage from
  // the wrong register.
  //
  // The pattern below: `((double(*)(double))fn)(ARG_F64(0))` reads as:
  //   1. Cast `fn` (a void*) to "pointer to a function taking double,
  //      returning double"
  //   2. Call it with the first argument as a double
  // This tells the compiler to use the correct calling convention.
  if (has_float_params) {
    // 1-param float signatures
    if (sig.param_count == 1) {
      FFIType p0 = sig.param_types[0];
      if (p0 == FFIType::kFloat64) {
        switch (sig.return_type) {
          case FFIType::kFloat64: {
            double ret = ((double(*)(double))fn)(ARG_F64(0));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kFloat32: {
            float ret = ((float(*)(double))fn)(ARG_F64(0));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kInt32:
          case FFIType::kBool: {
            int32_t ret = ((int32_t(*)(double))fn)(ARG_F64(0));
            result = sig.return_type == FFIType::kBool
              ? Boolean::New(isolate, ret != 0).As<Value>()
              : Int32::New(isolate, ret).As<Value>();
            break;
          }
          case FFIType::kVoid:
            ((void(*)(double))fn)(ARG_F64(0));
            result = Undefined(isolate);
            break;
          case FFIType::kPointer: {
            void* ret = ((void*(*)(double))fn)(ARG_F64(0));
            result = ret ? BigInt::NewFromUnsigned(isolate,
              reinterpret_cast<uint64_t>(ret)).As<Value>()
              : Null(isolate).As<Value>();
            break;
          }
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Unsupported return type for float-param function")
                .ToLocalChecked()));
            goto cleanup;
        }
      } else if (p0 == FFIType::kFloat32) {
        switch (sig.return_type) {
          case FFIType::kFloat64: {
            double ret = ((double(*)(float))fn)(ARG_F32(0));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kFloat32: {
            float ret = ((float(*)(float))fn)(ARG_F32(0));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kInt32: {
            int32_t ret = ((int32_t(*)(float))fn)(ARG_F32(0));
            result = Int32::New(isolate, ret);
            break;
          }
          case FFIType::kVoid:
            ((void(*)(float))fn)(ARG_F32(0));
            result = Undefined(isolate);
            break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Unsupported return type for float-param function")
                .ToLocalChecked()));
            goto cleanup;
        }
      }
    }
    // 2-param float signatures
    else if (sig.param_count == 2) {
      FFIType p0 = sig.param_types[0];
      FFIType p1 = sig.param_types[1];

      if (p0 == FFIType::kFloat64 && p1 == FFIType::kFloat64) {
        switch (sig.return_type) {
          case FFIType::kFloat64: {
            double ret = ((double(*)(double, double))fn)(
                ARG_F64(0), ARG_F64(1));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kInt32: {
            int32_t ret = ((int32_t(*)(double, double))fn)(
                ARG_F64(0), ARG_F64(1));
            result = Int32::New(isolate, ret);
            break;
          }
          case FFIType::kBool: {
            int32_t ret = ((int32_t(*)(double, double))fn)(
                ARG_F64(0), ARG_F64(1));
            result = Boolean::New(isolate, ret != 0);
            break;
          }
          case FFIType::kVoid:
            ((void(*)(double, double))fn)(ARG_F64(0), ARG_F64(1));
            result = Undefined(isolate);
            break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Unsupported return type for (f64, f64) function")
                .ToLocalChecked()));
            goto cleanup;
        }
      }
      // Mixed: (i32, f64) or (f64, i32)
      else if (FFITypeIsIntOrPtr(p0) && p1 == FFIType::kFloat64) {
        switch (sig.return_type) {
          case FFIType::kFloat64: {
            double ret = ((double(*)(uintptr_t, double))fn)(
                ARG_I(0), ARG_F64(1));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kInt32: {
            int32_t ret = ((int32_t(*)(uintptr_t, double))fn)(
                ARG_I(0), ARG_F64(1));
            result = Int32::New(isolate, ret);
            break;
          }
          case FFIType::kVoid:
            ((void(*)(uintptr_t, double))fn)(ARG_I(0), ARG_F64(1));
            result = Undefined(isolate);
            break;
          case FFIType::kPointer: {
            void* ret = ((void*(*)(uintptr_t, double))fn)(
                ARG_I(0), ARG_F64(1));
            result = ret ? BigInt::NewFromUnsigned(isolate,
              reinterpret_cast<uint64_t>(ret)).As<Value>()
              : Null(isolate).As<Value>();
            break;
          }
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Unsupported return type for mixed int/float function")
                .ToLocalChecked()));
            goto cleanup;
        }
      } else if (p0 == FFIType::kFloat64 && FFITypeIsIntOrPtr(p1)) {
        switch (sig.return_type) {
          case FFIType::kFloat64: {
            double ret = ((double(*)(double, uintptr_t))fn)(
                ARG_F64(0), ARG_I(1));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kInt32: {
            int32_t ret = ((int32_t(*)(double, uintptr_t))fn)(
                ARG_F64(0), ARG_I(1));
            result = Int32::New(isolate, ret);
            break;
          }
          case FFIType::kVoid:
            ((void(*)(double, uintptr_t))fn)(ARG_F64(0), ARG_I(1));
            result = Undefined(isolate);
            break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Unsupported return type for mixed float/int function")
                .ToLocalChecked()));
            goto cleanup;
        }
      }
      // 2x float32
      else if (p0 == FFIType::kFloat32 && p1 == FFIType::kFloat32) {
        switch (sig.return_type) {
          case FFIType::kFloat32: {
            float ret = ((float(*)(float, float))fn)(ARG_F32(0), ARG_F32(1));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kFloat64: {
            double ret = ((double(*)(float, float))fn)(ARG_F32(0), ARG_F32(1));
            result = Number::New(isolate, ret);
            break;
          }
          case FFIType::kVoid:
            ((void(*)(float, float))fn)(ARG_F32(0), ARG_F32(1));
            result = Undefined(isolate);
            break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "Unsupported return type for (f32, f32) function")
                .ToLocalChecked()));
            goto cleanup;
        }
      }
      else {
        isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate,
            "Unsupported mixed float/int parameter combination")
            .ToLocalChecked()));
        goto cleanup;
      }
    }
    // 3-param: (f64,f64,f64)->f64 is common (e.g. fma, clamp)
    else if (sig.param_count == 3 &&
             sig.param_types[0] == FFIType::kFloat64 &&
             sig.param_types[1] == FFIType::kFloat64 &&
             sig.param_types[2] == FFIType::kFloat64 &&
             sig.return_type == FFIType::kFloat64) {
      double ret = ((double(*)(double, double, double))fn)(
          ARG_F64(0), ARG_F64(1), ARG_F64(2));
      result = Number::New(isolate, ret);
    }
    else {
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate,
          "Complex float signatures with >2 mixed params not yet supported")
          .ToLocalChecked()));
      goto cleanup;
    }
  }
  // ========================================================================
  // Integer/pointer-only dispatch -- up to 8 parameters
  // ========================================================================
  //
  // For functions with only integer/pointer arguments, all args can be
  // passed as `uintptr_t` (a register-sized unsigned integer). This
  // simplifies the dispatch: we just need one switch on param_count per
  // return type. The big nested switch below covers:
  //   return type -> param count -> actual function call
  //
  // Example: `((int32_t(*)(uintptr_t, uintptr_t))fn)(ARG_I(0), ARG_I(1))`
  // means "call fn as a function taking two register-sized ints, returning
  // int32_t."
  else {
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
          case 5: ((void(*)(uintptr_t, uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4)); break;
          case 6: ((void(*)(uintptr_t, uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5)); break;
          case 7: ((void(*)(uintptr_t, uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5), ARG_I(6)); break;
          case 8: ((void(*)(uintptr_t, uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5), ARG_I(6), ARG_I(7)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "void functions with >8 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = Undefined(isolate);
        break;
      }
      case FFIType::kBool:
      case FFIType::kInt8:
      case FFIType::kUint8:
      case FFIType::kInt16:
      case FFIType::kUint16:
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
          case 5: ret = ((int32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4)); break;
          case 6: ret = ((int32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5)); break;
          case 7: ret = ((int32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5), ARG_I(6)); break;
          case 8: ret = ((int32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5), ARG_I(6), ARG_I(7)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "int functions with >8 params not yet supported")
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
          case 4: ret = ((uint32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          case 5: ret = ((uint32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4)); break;
          case 6: ret = ((uint32_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "uint functions with >6 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = Uint32::New(isolate, ret);
        break;
      }
      case FFIType::kInt64: {
        int64_t ret;
        switch (sig.param_count) {
          case 0: ret = ((int64_t(*)())fn)(); break;
          case 1: ret = ((int64_t(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((int64_t(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((int64_t(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          case 4: ret = ((int64_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "i64 functions with >4 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = BigInt::New(isolate, ret);
        break;
      }
      case FFIType::kUint64: {
        uint64_t ret;
        switch (sig.param_count) {
          case 0: ret = ((uint64_t(*)())fn)(); break;
          case 1: ret = ((uint64_t(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((uint64_t(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((uint64_t(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          case 4: ret = ((uint64_t(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "u64 functions with >4 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = BigInt::NewFromUnsigned(isolate, ret);
        break;
      }
      case FFIType::kFloat32: {
        float ret;
        switch (sig.param_count) {
          case 0: ret = ((float(*)())fn)(); break;
          case 1: ret = ((float(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((float(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "f32 return with integer params: max 2 supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        result = Number::New(isolate, ret);
        break;
      }
      case FFIType::kFloat64: {
        double ret;
        switch (sig.param_count) {
          case 0: ret = ((double(*)())fn)(); break;
          case 1: ret = ((double(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((double(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((double(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          case 4: ret = ((double(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "double functions with >4 integer params not yet supported")
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
          case 4: ret = ((void*(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t))fn)(ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3)); break;
          case 5: ret = ((void*(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4)); break;
          case 6: ret = ((void*(*)(uintptr_t, uintptr_t, uintptr_t,
            uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2), ARG_I(3), ARG_I(4),
            ARG_I(5)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "ptr functions with >6 params not yet supported")
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
      case FFIType::kString: {
        // String return: treat as const char* and convert to JS string.
        const char* ret;
        switch (sig.param_count) {
          case 0: ret = ((const char*(*)())fn)(); break;
          case 1: ret = ((const char*(*)(uintptr_t))fn)(ARG_I(0)); break;
          case 2: ret = ((const char*(*)(uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1)); break;
          case 3: ret = ((const char*(*)(uintptr_t, uintptr_t, uintptr_t))fn)(
            ARG_I(0), ARG_I(1), ARG_I(2)); break;
          default:
            isolate->ThrowException(Exception::Error(
              String::NewFromUtf8(isolate,
                "string-return functions with >3 params not yet supported")
                .ToLocalChecked()));
            goto cleanup;
        }
        if (ret == nullptr) {
          result = Null(isolate);
        } else {
          // FFI kString returns raw bytes from arbitrary user-loaded
          // native libraries — Latin-1 libs, EUC-JP libs, buffers
          // mistakenly typed as "string", etc. can all yield bytes
          // that fail UTF-8 validation. Falling back to Null on a
          // failed decode avoids aborting the isolate on a caller's
          // own mistake. (The caller can switch to kPointer to
          // receive the raw bytes and decode themselves if they
          // know the encoding.)
          Local<String> s;
          if (!String::NewFromUtf8(isolate, ret).ToLocal(&s)) {
            result = Null(isolate);
          } else {
            result = s;
          }
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
#undef ARG_F32

// This label is the target of `goto cleanup` used throughout the dispatch
// code above. It frees any temporary C string copies we allocated during
// argument marshaling. In JS terms, this is like a `finally` block.
cleanup:
  for (size_t i = 0; i < sig.param_count; ++i) {
    if (string_storage[i] != nullptr) {
      delete[] string_storage[i];
    }
  }
}

// ============================================================================
// Pointer / memory helpers -- bridging between JS values and raw addresses
// ============================================================================
//
// In C, data lives at raw memory addresses (pointers). In JS, you work with
// Buffer, ArrayBuffer, BigInt, and String. These helpers convert between the
// two worlds:
//   ptrToString:      C char* address -> JS string
//   ptrToBuffer:      C address + length -> Node.js Buffer (copy or zero-copy)
//   bufferToPtr:      Node.js Buffer -> BigInt address
//   ptrToArrayBuffer: C address + length -> JS ArrayBuffer

// JS: binding.ptrToString(0x12345678n) -> "hello" or null
// Reads a null-terminated C string from a memory address.
void FFIBinding::PtrToString(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();

  if (args.Length() < 1 || !args[0]->IsBigInt()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "ptrToString() requires a BigInt pointer")
        .ToLocalChecked()));
    return;
  }

  bool lossless;
  uint64_t ptr_val = args[0].As<BigInt>()->Uint64Value(&lossless);

  if (ptr_val == 0) {
    args.GetReturnValue().SetNull();
    return;
  }

  const char* str = reinterpret_cast<const char*>(ptr_val);
  static constexpr size_t kMaxStringRead = 1024 * 1024;  // 1 MB
  size_t len = strnlen(str, kMaxStringRead);

  // HISTORY: WHY kNormal vs kInternalized STRINGS
  // V8 "interns" strings by deduplicating them in a global table. Internalized
  // strings have O(1) identity comparison (pointer equality) and are ideal for
  // property names and stable identifiers. Use kNormal for arbitrary or one-off
  // data — interning transient strings bloats the intern table. Most Node.js
  // internal code uses kNormal for dynamic data and FIXED_ONE_BYTE_STRING
  // (which interns) for constant property names.
  Local<String> out;
  if (!String::NewFromUtf8(isolate, str, NewStringType::kNormal,
                           static_cast<int>(len)).ToLocal(&out)) {
    return;
  }
  args.GetReturnValue().Set(out);
}

// JS: binding.ptrToBuffer(0x12345678n, 1024) -> Buffer
// Creates a Node.js Buffer from a raw memory address.
// copy=true (default): allocates new memory and copies the data (safe).
// copy=false: the Buffer points directly at the native memory (fast but
//   dangerous -- the caller must ensure the memory outlives the Buffer).
void FFIBinding::PtrToBuffer(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2 || !args[0]->IsBigInt()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "ptrToBuffer() requires (ptrBigInt, length[, copy])")
        .ToLocalChecked()));
    return;
  }

  bool lossless;
  uint64_t ptr_val = args[0].As<BigInt>()->Uint64Value(&lossless);
  size_t length = static_cast<size_t>(
    args[1]->IntegerValue(context).FromMaybe(0));

  if (ptr_val == 0 && length > 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Cannot read from null pointer")
        .ToLocalChecked()));
    return;
  }

  // Cap at 1 GB — matches PtrToArrayBuffer sibling. Without this cap
  // Buffer::Copy of an attacker-controlled length can abort the isolate
  // via V8 OOM path under -fno-exceptions.
  constexpr size_t kMaxCopyBytes = 1ULL * 1024 * 1024 * 1024;
  if (length > kMaxCopyBytes) {
    isolate->ThrowException(Exception::RangeError(
      String::NewFromUtf8(isolate,
          "ptrToBuffer copy length exceeds 1 GB limit")
        .ToLocalChecked()));
    return;
  }

  // Default to copy=true for safety.
  bool copy = true;
  if (args.Length() >= 3 && !args[2]->IsUndefined()) {
    copy = args[2]->BooleanValue(isolate);
  }

  auto* data = reinterpret_cast<char*>(ptr_val);
  Environment* env = Environment::GetCurrent(isolate);

  if (copy) {
    auto maybe_buf = node::Buffer::Copy(env, data, length);
    if (maybe_buf.IsEmpty()) {
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate, "Failed to allocate buffer")
          .ToLocalChecked()));
      return;
    }
    args.GetReturnValue().Set(maybe_buf.ToLocalChecked());
  } else {
    // Zero-copy: create a Buffer that references the native memory directly.
    // The caller must guarantee the memory outlives the Buffer.
    auto maybe_buf = node::Buffer::New(env, data, length,
      [](char*, void*) {}, nullptr);
    if (maybe_buf.IsEmpty()) {
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate, "Failed to create buffer view")
          .ToLocalChecked()));
      return;
    }
    args.GetReturnValue().Set(maybe_buf.ToLocalChecked());
  }
}

// JS: binding.bufferToPtr(myBuffer) -> BigInt (memory address)
// Returns the raw memory address where the Buffer's data lives.
// Useful for passing a Buffer's contents to a C function that expects a pointer.
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

// JS: binding.ptrToArrayBuffer(0x12345678n, 1024) -> ArrayBuffer
// Same as ptrToBuffer but returns an ArrayBuffer instead of a Buffer.
void FFIBinding::PtrToArrayBuffer(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2 || !args[0]->IsBigInt()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "ptrToArrayBuffer() requires (ptrBigInt, length[, copy])")
        .ToLocalChecked()));
    return;
  }

  bool lossless;
  uint64_t ptr_val = args[0].As<BigInt>()->Uint64Value(&lossless);
  size_t length = static_cast<size_t>(
    args[1]->IntegerValue(context).FromMaybe(0));

  if (ptr_val == 0 && length > 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
        "Cannot create ArrayBuffer from null pointer")
        .ToLocalChecked()));
    return;
  }

  bool copy = true;
  if (args.Length() >= 3 && !args[2]->IsUndefined()) {
    copy = args[2]->BooleanValue(isolate);
  }

  if (copy) {
    // Cap length BEFORE calling the allocating NewBackingStore
    // overload. V8's default failure mode is kOutOfMemory which
    // aborts the isolate rather than returning nullptr, so a caller
    // like `ptrToArrayBuffer(0x1n, 10_000_000_000n, true)` would
    // kill the whole process. A 1 GB cap keeps the request well
    // below what V8 actually attempts to allocate and converts the
    // failure into a catchable JS RangeError. We keep the default
    // signature to stay compatible across V8 versions in the
    // Node.js submodule pin (newer kReturnNull overloads aren't
    // universally available).
    constexpr size_t kMaxCopyBytes = 1ULL * 1024 * 1024 * 1024;
    if (length > kMaxCopyBytes) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate,
          "ptrToArrayBuffer copy length exceeds 1 GB limit")
          .ToLocalChecked()));
      return;
    }
    std::unique_ptr<BackingStore> store =
        ArrayBuffer::NewBackingStore(isolate, length);
    if (!store) {
      // NewBackingStore can return null under near-OOM conditions
      // (e.g. when a fatal error handler is installed). Dereferencing
      // store->Data() would then segfault. Surface as a JS error.
      isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate,
          "Out of memory allocating ArrayBuffer backing store")
          .ToLocalChecked()));
      return;
    }
    memcpy(store->Data(), reinterpret_cast<void*>(ptr_val), length);
    Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, std::move(store));
    args.GetReturnValue().Set(ab);
  } else {
    std::unique_ptr<BackingStore> store = ArrayBuffer::NewBackingStore(
        reinterpret_cast<void*>(ptr_val), length,
        [](void*, size_t, void*) {}, nullptr);
    Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, std::move(store));
    args.GetReturnValue().Set(ab);
  }
}

// ============================================================================
// Raw memory get/set -- read/write typed values at raw memory addresses
// ============================================================================
//
// These functions let JS read and write individual values (int32, float64,
// etc.) at arbitrary memory addresses. In JS terms, they're like DataView's
// getInt32()/setInt32() but for raw native memory instead of ArrayBuffers.
//
// The implementation uses C++ templates (generics) so we write the logic
// once and the compiler generates separate versions for int8, uint8, int16,
// uint16, int32, uint32, int64, uint64, float, and double.

// Validates that the pointer argument is valid and computes the final address
// (pointer + byte offset). Returns false and throws a JS error if invalid.
static bool ValidatePtrOffset(Isolate* isolate,
                              const FunctionCallbackInfo<Value>& args,
                              uint8_t** out_ptr) {
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "First argument must be a BigInt or Number pointer")
        .ToLocalChecked()));
    return false;
  }

  uint64_t ptr_val;
  if (args[0]->IsBigInt()) {
    bool lossless;
    ptr_val = args[0].As<BigInt>()->Uint64Value(&lossless);
  } else if (args[0]->IsNumber()) {
    // Number path — enables V8 fast API. Safe for 48-bit addresses.
    ptr_val = static_cast<uint64_t>(
      args[0]->NumberValue(context).FromMaybe(0.0));
  } else {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "First argument must be a BigInt or Number pointer")
        .ToLocalChecked()));
    return false;
  }

  if (ptr_val == 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Cannot dereference a null pointer")
        .ToLocalChecked()));
    return false;
  }

  size_t offset = 0;
  if (args.Length() > 1 && !args[1]->IsUndefined()) {
    offset = static_cast<size_t>(args[1]->IntegerValue(context).FromMaybe(0));
  }

  *out_ptr = reinterpret_cast<uint8_t*>(ptr_val) + offset;
  return true;
}

// `template <typename T>` is C++ generics -- like TypeScript's `function
// getValue<T>(...)`. The compiler creates a separate function for each type
// (int8_t, uint8_t, int32_t, float, double, etc.).
// memcpy is used instead of direct pointer dereference to avoid alignment
// issues (some CPUs crash if you read a 4-byte int from a non-4-byte-aligned
// address).
template <typename T>
void FFIBinding::GetValue(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  uint8_t* ptr;
  if (!ValidatePtrOffset(isolate, args, &ptr)) return;

  T value;
  memcpy(&value, ptr, sizeof(value));

  if constexpr (std::is_same_v<T, int8_t> || std::is_same_v<T, int16_t> ||
                std::is_same_v<T, int32_t>) {
    args.GetReturnValue().Set(Integer::New(isolate, value));
  } else if constexpr (std::is_same_v<T, uint8_t> ||
                       std::is_same_v<T, uint16_t> ||
                       std::is_same_v<T, uint32_t>) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, value));
  } else if constexpr (std::is_same_v<T, int64_t>) {
    args.GetReturnValue().Set(BigInt::New(isolate, value));
  } else if constexpr (std::is_same_v<T, uint64_t>) {
    args.GetReturnValue().Set(BigInt::NewFromUnsigned(isolate, value));
  } else if constexpr (std::is_same_v<T, float> ||
                       std::is_same_v<T, double>) {
    args.GetReturnValue().Set(Number::New(isolate, value));
  }
}

// Helper to validate pointer+offset+value for set operations.
static bool ValidatePtrOffsetValue(Isolate* isolate,
                                   const FunctionCallbackInfo<Value>& args,
                                   uint8_t** out_ptr,
                                   Local<Value>* out_value) {
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "set requires (pointer, offset, value)")
        .ToLocalChecked()));
    return false;
  }

  uint64_t ptr_val;
  if (args[0]->IsBigInt()) {
    bool lossless;
    ptr_val = args[0].As<BigInt>()->Uint64Value(&lossless);
  } else if (args[0]->IsNumber()) {
    ptr_val = static_cast<uint64_t>(
      args[0]->NumberValue(context).FromMaybe(0.0));
  } else {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "First argument must be a BigInt or Number pointer")
        .ToLocalChecked()));
    return false;
  }

  if (ptr_val == 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Cannot write to a null pointer")
        .ToLocalChecked()));
    return false;
  }

  size_t offset = static_cast<size_t>(
    args[1]->IntegerValue(context).FromMaybe(0));
  *out_ptr = reinterpret_cast<uint8_t*>(ptr_val) + offset;
  *out_value = args[2];
  return true;
}

template <typename T>
void FFIBinding::SetValue(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint8_t* ptr;
  Local<Value> value;
  if (!ValidatePtrOffsetValue(isolate, args, &ptr, &value)) return;

  T converted;
  if constexpr (std::is_same_v<T, int8_t>) {
    int32_t v = value->Int32Value(context).FromMaybe(0);
    if (v < INT8_MIN || v > INT8_MAX) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "Value out of range for int8")
          .ToLocalChecked()));
      return;
    }
    converted = static_cast<T>(v);
  } else if constexpr (std::is_same_v<T, uint8_t>) {
    uint32_t v = value->Uint32Value(context).FromMaybe(0);
    if (v > UINT8_MAX) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "Value out of range for uint8")
          .ToLocalChecked()));
      return;
    }
    converted = static_cast<T>(v);
  } else if constexpr (std::is_same_v<T, int16_t>) {
    int32_t v = value->Int32Value(context).FromMaybe(0);
    if (v < INT16_MIN || v > INT16_MAX) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "Value out of range for int16")
          .ToLocalChecked()));
      return;
    }
    converted = static_cast<T>(v);
  } else if constexpr (std::is_same_v<T, uint16_t>) {
    uint32_t v = value->Uint32Value(context).FromMaybe(0);
    if (v > UINT16_MAX) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "Value out of range for uint16")
          .ToLocalChecked()));
      return;
    }
    converted = static_cast<T>(v);
  } else if constexpr (std::is_same_v<T, int32_t>) {
    converted = value->Int32Value(context).FromMaybe(0);
  } else if constexpr (std::is_same_v<T, uint32_t>) {
    converted = value->Uint32Value(context).FromMaybe(0);
  } else if constexpr (std::is_same_v<T, int64_t>) {
    if (value->IsBigInt()) {
      bool lossless;
      converted = value.As<BigInt>()->Int64Value(&lossless);
      if (!lossless) {
        isolate->ThrowException(Exception::RangeError(
          String::NewFromUtf8(isolate, "BigInt out of range for int64")
            .ToLocalChecked()));
        return;
      }
    } else {
      converted = static_cast<T>(value->IntegerValue(context).FromMaybe(0));
    }
  } else if constexpr (std::is_same_v<T, uint64_t>) {
    if (value->IsBigInt()) {
      bool lossless;
      converted = value.As<BigInt>()->Uint64Value(&lossless);
      if (!lossless) {
        isolate->ThrowException(Exception::RangeError(
          String::NewFromUtf8(isolate, "BigInt out of range for uint64")
            .ToLocalChecked()));
        return;
      }
    } else {
      converted = static_cast<T>(value->IntegerValue(context).FromMaybe(0));
    }
  } else if constexpr (std::is_same_v<T, float> ||
                       std::is_same_v<T, double>) {
    converted = static_cast<T>(value->NumberValue(context).FromMaybe(0.0));
  }

  memcpy(ptr, &converted, sizeof(converted));
}

// Explicit instantiations for get/set.
void FFIBinding::GetInt8(const FunctionCallbackInfo<Value>& a) {
  GetValue<int8_t>(a);
}
void FFIBinding::GetUint8(const FunctionCallbackInfo<Value>& a) {
  GetValue<uint8_t>(a);
}
void FFIBinding::GetInt16(const FunctionCallbackInfo<Value>& a) {
  GetValue<int16_t>(a);
}
void FFIBinding::GetUint16(const FunctionCallbackInfo<Value>& a) {
  GetValue<uint16_t>(a);
}
void FFIBinding::GetInt32(const FunctionCallbackInfo<Value>& a) {
  GetValue<int32_t>(a);
}
void FFIBinding::GetUint32(const FunctionCallbackInfo<Value>& a) {
  GetValue<uint32_t>(a);
}
void FFIBinding::GetInt64(const FunctionCallbackInfo<Value>& a) {
  GetValue<int64_t>(a);
}
void FFIBinding::GetUint64(const FunctionCallbackInfo<Value>& a) {
  GetValue<uint64_t>(a);
}
void FFIBinding::GetFloat32(const FunctionCallbackInfo<Value>& a) {
  GetValue<float>(a);
}
void FFIBinding::GetFloat64(const FunctionCallbackInfo<Value>& a) {
  GetValue<double>(a);
}
void FFIBinding::SetInt8(const FunctionCallbackInfo<Value>& a) {
  SetValue<int8_t>(a);
}
void FFIBinding::SetUint8(const FunctionCallbackInfo<Value>& a) {
  SetValue<uint8_t>(a);
}
void FFIBinding::SetInt16(const FunctionCallbackInfo<Value>& a) {
  SetValue<int16_t>(a);
}
void FFIBinding::SetUint16(const FunctionCallbackInfo<Value>& a) {
  SetValue<uint16_t>(a);
}
void FFIBinding::SetInt32(const FunctionCallbackInfo<Value>& a) {
  SetValue<int32_t>(a);
}
void FFIBinding::SetUint32(const FunctionCallbackInfo<Value>& a) {
  SetValue<uint32_t>(a);
}
void FFIBinding::SetInt64(const FunctionCallbackInfo<Value>& a) {
  SetValue<int64_t>(a);
}
void FFIBinding::SetUint64(const FunctionCallbackInfo<Value>& a) {
  SetValue<uint64_t>(a);
}
void FFIBinding::SetFloat32(const FunctionCallbackInfo<Value>& a) {
  SetValue<float>(a);
}
void FFIBinding::SetFloat64(const FunctionCallbackInfo<Value>& a) {
  SetValue<double>(a);
}

// ============================================================================
// V8 Fast API paths for get/set (accepts Number pointer, not BigInt)
// ============================================================================
// V8 Fast API cannot handle BigInt args, so these fast paths accept the
// pointer address as a double (Number). Safe for all userspace addresses
// on 48-bit virtual address platforms (x64, arm64).

using v8::FastApiCallbackOptions;

static int32_t FastGetInt32(Local<Value> recv, double ptr, double offset,
                            FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.getInt32");
  auto* p = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(ptr));
  int32_t value;
  memcpy(&value, p + static_cast<size_t>(offset), sizeof(value));
  return value;
}

static uint32_t FastGetUint32(Local<Value> recv, double ptr, double offset,
                              FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.getUint32");
  auto* p = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(ptr));
  uint32_t value;
  memcpy(&value, p + static_cast<size_t>(offset), sizeof(value));
  return value;
}

static double FastGetFloat64(Local<Value> recv, double ptr, double offset,
                             FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.getFloat64");
  auto* p = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(ptr));
  double value;
  memcpy(&value, p + static_cast<size_t>(offset), sizeof(value));
  return value;
}

static void FastSetInt32(Local<Value> recv, double ptr, double offset,
                         int32_t value,
                         FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.setInt32");
  auto* p = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(ptr));
  memcpy(p + static_cast<size_t>(offset), &value, sizeof(value));
}

static void FastSetUint32(Local<Value> recv, double ptr, double offset,
                          uint32_t value,
                          FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.setUint32");
  auto* p = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(ptr));
  memcpy(p + static_cast<size_t>(offset), &value, sizeof(value));
}

static void FastSetFloat64(Local<Value> recv, double ptr, double offset,
                           double value,
                           FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ffi.setFloat64");
  auto* p = reinterpret_cast<uint8_t*>(static_cast<uintptr_t>(ptr));
  memcpy(p + static_cast<size_t>(offset), &value, sizeof(value));
}

static v8::CFunction cf_get_i32(v8::CFunction::Make(FastGetInt32));
static v8::CFunction cf_get_u32(v8::CFunction::Make(FastGetUint32));
static v8::CFunction cf_get_f64(v8::CFunction::Make(FastGetFloat64));
static v8::CFunction cf_set_i32(v8::CFunction::Make(FastSetInt32));
static v8::CFunction cf_set_u32(v8::CFunction::Make(FastSetUint32));
static v8::CFunction cf_set_f64(v8::CFunction::Make(FastSetFloat64));

// ============================================================================
// Callbacks — JS -> native function pointer (without libffi)
// ============================================================================

// This is the entry point called by the callback trampoline pool when native
// code invokes a callback slot. It marshals arguments and calls the JS function.
// Defined extern "C" linkage-compatible for the trampoline.cc forward decl.
uintptr_t InvokeCallbackSlot(uint32_t slot,
                             uintptr_t a0, uintptr_t a1,
                             uintptr_t a2, uintptr_t a3) {
  // Look up the slot data.
  CallbackSlotData* data = &g_callback_slots[slot];
  if (!data->allocated || data->env == nullptr || data->js_fn == nullptr) {
    return 0;
  }

  // Callbacks must be invoked on the thread that created them.
  if (std::this_thread::get_id() != data->thread_id) {
    FPrintF(stderr,
            "FFI callback invoked from wrong thread — "
            "callbacks must fire on their creating thread\n");
    return 0;
  }

  auto* env = static_cast<Environment*>(data->env);
  auto* persistent = static_cast<Global<Function>*>(data->js_fn);

  Isolate* isolate = env->isolate();
  // HISTORY: WHY HandleScope IS MANDATORY
  // HandleScope is V8's GC contract with embedders. Every Local<T> handle
  // acts as a GC root — it prevents the referenced JS value from being
  // collected. Without a HandleScope, handles accumulate on V8's handle
  // stack indefinitely, retaining objects that should be dead. In a loop
  // creating many locals, this causes unbounded memory growth and eventual
  // OOM. The scope acts as a checkpoint: when it's destroyed, all locals
  // created within it become eligible for GC.
  HandleScope handle_scope(isolate);
  Local<Context> context = env->context();
  Local<Function> fn = persistent->Get(isolate);

  if (fn.IsEmpty()) return 0;

  const FFISignature& sig = data->signature;
  uintptr_t raw_args[4] = {a0, a1, a2, a3};

  // Marshal native args to JS values.
  Local<Value> js_args[kMaxFFIParams];
  size_t argc = sig.param_count < 4 ? sig.param_count : 4;

  for (size_t i = 0; i < argc; ++i) {
    switch (sig.param_types[i]) {
      case FFIType::kBool:
        js_args[i] = Boolean::New(isolate, raw_args[i] != 0);
        break;
      case FFIType::kInt8:
      case FFIType::kInt16:
      case FFIType::kInt32:
        js_args[i] = Int32::New(isolate, static_cast<int32_t>(raw_args[i]));
        break;
      case FFIType::kUint8:
      case FFIType::kUint16:
      case FFIType::kUint32:
        js_args[i] = Uint32::New(isolate, static_cast<uint32_t>(raw_args[i]));
        break;
      case FFIType::kInt64:
        js_args[i] = BigInt::New(isolate,
            static_cast<int64_t>(raw_args[i]));
        break;
      case FFIType::kUint64:
        js_args[i] = BigInt::NewFromUnsigned(isolate, raw_args[i]);
        break;
      case FFIType::kPointer:
      case FFIType::kString:
      case FFIType::kBuffer:
        js_args[i] = BigInt::NewFromUnsigned(isolate, raw_args[i]);
        break;
      default:
        js_args[i] = Undefined(isolate);
        break;
    }
  }

  v8::TryCatch try_catch(isolate);
  v8::MaybeLocal<Value> maybe_result = fn->Call(
      context, Undefined(isolate), argc, js_args);

  if (try_catch.HasCaught()) {
    // Cannot propagate exceptions across the FFI boundary.
    FPrintF(stderr, "FFI callback threw an exception (slot %u)\n", slot);
    return 0;
  }

  Local<Value> result_val;
  if (!maybe_result.ToLocal(&result_val)) return 0;

  // Marshal JS return value back to native.
  switch (sig.return_type) {
    case FFIType::kVoid:
      return 0;
    case FFIType::kBool:
      return result_val->BooleanValue(isolate) ? 1 : 0;
    case FFIType::kInt8:
    case FFIType::kInt16:
    case FFIType::kInt32:
      return static_cast<uintptr_t>(
        result_val->Int32Value(context).FromMaybe(0));
    case FFIType::kUint8:
    case FFIType::kUint16:
    case FFIType::kUint32:
      return static_cast<uintptr_t>(
        result_val->Uint32Value(context).FromMaybe(0));
    case FFIType::kPointer:
      if (result_val->IsBigInt()) {
        bool lossless;
        return static_cast<uintptr_t>(
          result_val.As<BigInt>()->Uint64Value(&lossless));
      }
      return 0;
    default:
      return 0;
  }
}

// Float callback entry point — receives doubles from FPU registers.
double InvokeCallbackSlotF64(uint32_t slot,
                             double a0, double a1,
                             double a2, double a3) {
  CallbackSlotData* data = &g_callback_slots[slot];
  if (!data->allocated || data->env == nullptr || data->js_fn == nullptr) {
    return 0.0;
  }

  if (std::this_thread::get_id() != data->thread_id) {
    FPrintF(stderr,
            "FFI callback invoked from wrong thread — "
            "callbacks must fire on their creating thread\n");
    return 0.0;
  }

  auto* env = static_cast<Environment*>(data->env);
  auto* persistent = static_cast<Global<Function>*>(data->js_fn);

  Isolate* isolate = env->isolate();
  HandleScope handle_scope(isolate);
  Local<Context> context = env->context();
  Local<Function> fn = persistent->Get(isolate);

  if (fn.IsEmpty()) return 0.0;

  const FFISignature& sig = data->signature;
  double raw_f64[4] = {a0, a1, a2, a3};

  Local<Value> js_args[kMaxFFIParams];
  size_t argc = sig.param_count < 4 ? sig.param_count : 4;

  for (size_t i = 0; i < argc; ++i) {
    switch (sig.param_types[i]) {
      case FFIType::kFloat64:
        js_args[i] = Number::New(isolate, raw_f64[i]);
        break;
      case FFIType::kFloat32:
        js_args[i] = Number::New(isolate, static_cast<float>(raw_f64[i]));
        break;
      default:
        // Non-float args in a float callback — shouldn't happen but handle.
        js_args[i] = Number::New(isolate, raw_f64[i]);
        break;
    }
  }

  v8::TryCatch try_catch(isolate);
  v8::MaybeLocal<Value> maybe_result = fn->Call(
      context, Undefined(isolate), argc, js_args);

  if (try_catch.HasCaught()) {
    FPrintF(stderr, "FFI callback threw an exception (slot %u)\n", slot);
    return 0.0;
  }

  Local<Value> result_val;
  if (!maybe_result.ToLocal(&result_val)) return 0.0;

  switch (sig.return_type) {
    case FFIType::kVoid:
      return 0.0;
    case FFIType::kFloat64:
    case FFIType::kFloat32:
      return result_val->NumberValue(context).FromMaybe(0.0);
    case FFIType::kInt32:
      return static_cast<double>(
        result_val->Int32Value(context).FromMaybe(0));
    case FFIType::kBool:
      return result_val->BooleanValue(isolate) ? 1.0 : 0.0;
    default:
      return 0.0;
  }
}

// ffi.registerCallback(libraryId, returnType, paramTypes, jsFn) -> callbackId
void FFIBinding::RegisterCallback(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 4) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "registerCallback(libraryId, returnType, paramTypes, function)")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

  uint32_t lib_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto lib_it = state->libraries.find(lib_id);
  if (lib_it == state->libraries.end() || lib_it->second->closed) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Library not found or closed")
        .ToLocalChecked()));
    return;
  }

  FFIType ret_type = ParseTypeString(isolate, args[1]);

  FFISignature sig;
  sig.return_type = ret_type;
  sig.param_count = 0;

  if (args[2]->IsArray()) {
    Local<Array> param_arr = args[2].As<Array>();
    sig.param_count = param_arr->Length();
    if (sig.param_count > 4) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate,
          "Callbacks support at most 4 parameters")
          .ToLocalChecked()));
      return;
    }
    for (size_t i = 0; i < sig.param_count; ++i) {
      // Same Array::Get-from-Proxy guard as FFIBinding::Sym above —
      // a throwing get trap otherwise kills the whole isolate.
      Local<Value> pt;
      if (!param_arr->Get(context, i).ToLocal(&pt)) {
        sig.param_types[i] = FFIType::kVoid;
        continue;
      }
      sig.param_types[i] = ParseTypeString(isolate, pt);
    }
  }

  if (!args[3]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Fourth argument must be a function")
        .ToLocalChecked()));
    return;
  }

  // Check if any param is float/double — determines which slot pool to use.
  bool needs_float = false;
  for (size_t i = 0; i < sig.param_count; ++i) {
    if (FFITypeIsFloat(sig.param_types[i])) {
      needs_float = true;
      break;
    }
  }

  // Float callbacks require ALL params to be float/double (can't mix
  // int+float in the trampoline since they use different register banks).
  if (needs_float) {
    for (size_t i = 0; i < sig.param_count; ++i) {
      if (!FFITypeIsFloat(sig.param_types[i])) {
        isolate->ThrowException(Exception::TypeError(
          String::NewFromUtf8(isolate,
            "Float callbacks must have all-float parameters "
            "(cannot mix float and integer params in callbacks)")
            .ToLocalChecked()));
        return;
      }
    }
  }

  // Allocate a slot from the appropriate pool.
  int32_t slot = CallbackPoolAlloc(needs_float);
  if (slot < 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
        "Callback pool exhausted (max 64 concurrent callbacks)")
        .ToLocalChecked()));
    return;
  }

  // Store the JS function reference. -fno-exceptions: nothrow + null-check.
  // If OOM, release the pool slot we just claimed so another caller can reuse
  // it, then surface as a JS Error instead of aborting the process.
  auto* persistent = new (std::nothrow) Global<Function>(
      isolate, args[3].As<Function>());
  if (!persistent) {
    CallbackPoolFree(static_cast<uint32_t>(slot));
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
          "Out of memory: failed to persist callback function")
        .ToLocalChecked()));
    return;
  }

  CallbackSlotData slot_data;
  slot_data.env = env;
  slot_data.js_fn = persistent;
  slot_data.signature = sig;
  slot_data.thread_id = std::this_thread::get_id();
  slot_data.allocated = true;
  CallbackPoolSetData(static_cast<uint32_t>(slot), &slot_data);

  // Get the native function pointer for this slot.
  void* native_ptr = CallbackPoolGetPtr(static_cast<uint32_t>(slot), sig);

  // std::make_unique aborts on OOM under -fno-exceptions. Nothrow so that
  // OOM here tears down the partial state (pool slot + persistent handle)
  // and surfaces a JS Error rather than killing the process.
  auto cb = std::unique_ptr<FFICallback>(new (std::nothrow) FFICallback());
  if (!cb) {
    // Zero the slot data before freeing so stray references can't see a
    // stale `js_fn` pointer after we delete it.
    CallbackSlotData empty_slot{};
    CallbackPoolSetData(static_cast<uint32_t>(slot), &empty_slot);
    CallbackPoolFree(static_cast<uint32_t>(slot));
    delete persistent;
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate,
          "Out of memory: failed to allocate FFI callback")
        .ToLocalChecked()));
    return;
  }
  cb->id = state->next_callback_id++;
  cb->library_id = lib_id;
  cb->slot_index = static_cast<uint32_t>(slot);
  cb->signature = sig;
  cb->alive = true;

  uint32_t cb_id = cb->id;
  state->callbacks[cb_id] = std::move(cb);

  // Return [callbackId, nativePtrBigInt].
  Local<Array> result_arr = Array::New(isolate, 2);
  result_arr->Set(context, 0, Uint32::New(isolate, cb_id)).Check();
  result_arr->Set(context, 1, BigInt::NewFromUnsigned(isolate,
      reinterpret_cast<uint64_t>(native_ptr))).Check();
  args.GetReturnValue().Set(result_arr);
}

// ffi.unregisterCallback(callbackId)
void FFIBinding::UnregisterCallback(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate,
        "unregisterCallback() requires a callback ID")
        .ToLocalChecked()));
    return;
  }

  Environment* env = Environment::GetCurrent(args);
  FFIState* state = GetStateOrThrow(env);
  if (state == nullptr) {
    return;
  }

  uint32_t cb_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto cb_it = state->callbacks.find(cb_id);
  if (cb_it == state->callbacks.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Callback not found").ToLocalChecked()));
    return;
  }

  FFICallback* cb = cb_it->second.get();
  if (cb->alive) {
    // Free the persistent handle and the slot.
    extern CallbackSlotData g_callback_slots[];
    CallbackSlotData* slot_data = &g_callback_slots[cb->slot_index];
    if (slot_data->js_fn != nullptr) {
      auto* persistent = static_cast<Global<Function>*>(slot_data->js_fn);
      persistent->Reset();
      delete persistent;
      slot_data->js_fn = nullptr;
    }
    CallbackPoolFree(cb->slot_index);
    cb->alive = false;
  }

  state->callbacks.erase(cb_it);
}

// ============================================================================
// Module initialization
// ============================================================================

void FFIBinding::Initialize(
    Local<Object> target,
    Local<Value> unused,
    Local<Context> context,
    void* priv) {
  CallbackPoolInit();

  // Library lifecycle
  SetMethod(context, target, "open", Open);
  SetMethod(context, target, "close", Close);

  // Symbol resolution
  SetMethod(context, target, "sym", Sym);
  SetMethod(context, target, "dlsym", Dlsym);

  // Function calling
  SetMethod(context, target, "call", Call);
  SetMethod(context, target, "setTarget", SetTarget);

  // Pointer / memory helpers
  SetMethod(context, target, "ptrToBuffer", PtrToBuffer);
  SetMethod(context, target, "bufferToPtr", BufferToPtr);
  SetMethod(context, target, "ptrToString", PtrToString);
  SetMethod(context, target, "ptrToArrayBuffer", PtrToArrayBuffer);

  // Raw memory get/set
  SetMethod(context, target, "getInt8", GetInt8);
  SetMethod(context, target, "getUint8", GetUint8);
  SetMethod(context, target, "getInt16", GetInt16);
  SetMethod(context, target, "getUint16", GetUint16);
  // get/set with V8 fast paths for the most common types.
  // Fast paths accept Number pointers (double), slow paths accept BigInt.
  SetFastMethodNoSideEffect(context, target, "getInt32", GetInt32, &cf_get_i32);
  SetFastMethodNoSideEffect(
      context, target, "getUint32", GetUint32, &cf_get_u32);
  SetFastMethodNoSideEffect(
      context, target, "getFloat64", GetFloat64, &cf_get_f64);
  SetFastMethod(context, target, "setInt32", SetInt32, &cf_set_i32);
  SetFastMethod(context, target, "setUint32", SetUint32, &cf_set_u32);
  SetFastMethod(context, target, "setFloat64", SetFloat64, &cf_set_f64);
  // Remaining get/set without fast paths (less commonly hot).
  SetMethod(context, target, "getInt64", GetInt64);
  SetMethod(context, target, "getUint64", GetUint64);
  SetMethod(context, target, "getFloat32", GetFloat32);
  SetMethod(context, target, "setInt8", SetInt8);
  SetMethod(context, target, "setUint8", SetUint8);
  SetMethod(context, target, "setInt16", SetInt16);
  SetMethod(context, target, "setUint16", SetUint16);
  SetMethod(context, target, "setInt64", SetInt64);
  SetMethod(context, target, "setUint64", SetUint64);
  SetMethod(context, target, "setFloat32", SetFloat32);

  // Callbacks
  SetMethod(context, target, "registerCallback", RegisterCallback);
  SetMethod(context, target, "unregisterCallback", UnregisterCallback);
}

// HISTORY: WHY REGISTER EXTERNAL REFERENCES (SNAPSHOTS)
// Node.js v18.8.0 (PR #38905) introduced user-land startup snapshots
// (--build-snapshot / --snapshot-blob): the runtime serializes its initialized
// JS heap at build time and deserializes it on startup, avoiding the cost of
// re-parsing and re-compiling bootstrap code.
// V8 can serialize JS objects but NOT raw C++ function pointers. So every
// native function that JS can call must be registered here — V8 records
// a placeholder during serialization and reconnects it to the real C++
// function when loading the snapshot. Without this, snapshot-based startup
// would crash when calling any native method.
void FFIBinding::RegisterExternalReferences(
    ExternalReferenceRegistry* registry) {
  registry->Register(Open);
  registry->Register(Close);
  registry->Register(Sym);
  registry->Register(Dlsym);
  registry->Register(Call);
  registry->Register(SetTarget);
  registry->Register(PtrToBuffer);
  registry->Register(BufferToPtr);
  registry->Register(PtrToString);
  registry->Register(PtrToArrayBuffer);
  registry->Register(GetInt8);
  registry->Register(GetUint8);
  registry->Register(GetInt16);
  registry->Register(GetUint16);
  registry->Register(GetInt32);
  registry->Register(cf_get_i32);
  registry->Register(GetUint32);
  registry->Register(cf_get_u32);
  registry->Register(GetInt64);
  registry->Register(GetUint64);
  registry->Register(GetFloat32);
  registry->Register(GetFloat64);
  registry->Register(cf_get_f64);
  registry->Register(SetInt8);
  registry->Register(SetUint8);
  registry->Register(SetInt16);
  registry->Register(SetUint16);
  registry->Register(SetInt32);
  registry->Register(cf_set_i32);
  registry->Register(SetUint32);
  registry->Register(cf_set_u32);
  registry->Register(SetInt64);
  registry->Register(SetUint64);
  registry->Register(SetFloat32);
  registry->Register(SetFloat64);
  registry->Register(cf_set_f64);
  registry->Register(RegisterCallback);
  registry->Register(UnregisterCallback);
}

}  // namespace ffi
}  // namespace socketsecurity
}  // namespace node

// HISTORY: WHY NODE_BINDING_CONTEXT_AWARE_INTERNAL
// "Context-aware" means this binding initializes per-Environment (per V8
// context), not as a process-global singleton. This distinction became
// critical when Worker threads shipped in Node.js v10.5.0 (2018) — old-style
// bindings assumed one isolate and one event loop per process, which breaks
// with Workers. Node.js added ERR_NON_CONTEXT_AWARE_DISABLED for environments
// that reject the old model. Every new binding MUST be context-aware.
NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_ffi,
    node::socketsecurity::ffi::FFIBinding::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_ffi,
    node::socketsecurity::ffi::FFIBinding::RegisterExternalReferences)

#pragma GCC diagnostic pop
