// node:smol-webgpu binding — stub.
//
// Exposes the JS surface (navigator.gpu shape) so userland code that
// compiles against WebGPU resolves the module. Every call currently
// throws "WebGPU not yet wired" — the underlying Dawn integration is
// a multi-week effort tracked separately.
//
// Why a stub?
//
//   Dawn (https://dawn.googlesource.com/dawn) is Chromium's WebGPU
//   implementation. Its `src/dawn/node/` subdirectory ships a Node.js
//   binding ready to adapt to internalBinding shape. But the Dawn
//   tree is ~436 MB cloned, pulls Tint (WGSL compiler) + SPIRV-Tools
//   + per-platform GPU drivers (Metal on macOS, Vulkan/D3D12
//   elsewhere), and the first compile is hours. Adding it as a
//   submodule before the rest of the WebGPU surface is designed
//   bloats the fleet repo without delivering value.
//
// What lands now:
//
//   - The smol_webgpu binding name (so internalBinding('smol_webgpu')
//     resolves without crashing).
//   - createInstance() / requestAdapter() / requestDevice() stubs
//     that throw a structured error pointing at the design doc.
//
// What lands later:
//
//   - Dawn submodule at packages/node-smol-builder/upstream/dawn.
//   - CMake island-build wrapper that compiles libwebgpu_dawn.a +
//     libtint.a + libspirv_cross.a as static libs.
//   - Real implementation of every stub here.
//
// The JS surface in lib/smol-webgpu.js mirrors the W3C WebGPU IDL
// (https://www.w3.org/TR/webgpu/) so userland code is portable.

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

namespace node {
namespace socketsecurity {
namespace webgpu {

using v8::Context;
using v8::Exception;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

// Single error message reused across every stub entry. Points at the
// fleet plan doc so users can find the integration design + an issue
// link to track progress.
const char kPendingMessage[] =
    "node:smol-webgpu is not yet wired — Dawn integration pending. "
    "See .claude/plans/opentui-smol-tui-completion.md (Phase C) and "
    "https://dawn.googlesource.com/dawn/+/refs/heads/main/src/dawn/node/ "
    "for the design path.";

inline void ThrowPending(Isolate* isolate) {
  Local<String> msg =
      String::NewFromUtf8(isolate, kPendingMessage,
                          v8::NewStringType::kInternalized)
          .ToLocalChecked();
  isolate->ThrowException(Exception::Error(msg));
}

}  // namespace

// All entries currently throw. The function names mirror the
// W3C WebGPU IDL one-for-one so the JS layer can re-export them
// under their canonical names.

static void CreateInstance(const FunctionCallbackInfo<Value>& args) {
  ThrowPending(args.GetIsolate());
}

static void RequestAdapter(const FunctionCallbackInfo<Value>& args) {
  ThrowPending(args.GetIsolate());
}

static void RequestDevice(const FunctionCallbackInfo<Value>& args) {
  ThrowPending(args.GetIsolate());
}

static void GetPreferredCanvasFormat(
    const FunctionCallbackInfo<Value>& args) {
  ThrowPending(args.GetIsolate());
}

static void IsAvailable(const FunctionCallbackInfo<Value>& args) {
  // Synchronous detection helper — returns false in the stub. Userland
  // code reads this before attempting to use the API and falls back
  // to userland WebGPU shims (or skips WebGPU features) when it's
  // false. This is the ONE entry that doesn't throw — userland needs
  // a deterministic detection mechanism.
  args.GetReturnValue().Set(false);
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "createInstance", CreateInstance);
  SetMethod(context, target, "getPreferredCanvasFormat",
            GetPreferredCanvasFormat);
  SetMethod(context, target, "isAvailable", IsAvailable);
  SetMethod(context, target, "requestAdapter", RequestAdapter);
  SetMethod(context, target, "requestDevice", RequestDevice);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CreateInstance);
  registry->Register(GetPreferredCanvasFormat);
  registry->Register(IsAvailable);
  registry->Register(RequestAdapter);
  registry->Register(RequestDevice);
}

}  // namespace webgpu
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_webgpu, node::socketsecurity::webgpu::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_webgpu, node::socketsecurity::webgpu::RegisterExternalReferences)
