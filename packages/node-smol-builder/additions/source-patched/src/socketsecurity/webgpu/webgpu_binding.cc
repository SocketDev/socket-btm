// node:smol-webgpu binding — Dawn-detect entry shape.
//
// Build-time detection: when node-smol's configure step finds Dawn's
// build artifact (libwebgpu_dawn.a + headers from packages/dawn-builder),
// it defines HAVE_DAWN. Without Dawn, the binding compiles as a stub
// that reports unavailable.
//
// Detection contract for userland:
//
//   const { isAvailable } = internalBinding('smol_webgpu')
//   if (!isAvailable()) {
//     // Fall back to userland shim or skip WebGPU-dependent features.
//   }
//
// Why a compile-time gate (instead of dlopen at runtime)?
//
//   Dawn ships a Node binding under src/dawn/node/ — adapting that
//   surface to internalBinding shape is multi-week work (D6-D9). The
//   v0 milestone (this file) lands the detection plumbing only. When
//   dawn-builder produces its artifact and node-smol configure picks
//   it up, isAvailable() returns true; the remaining methods still
//   throw the structured "not yet wired" error until D6+ implements
//   them. This keeps the JS surface stable across the rollout — code
//   written against `isAvailable()` works today (always falls back)
//   and continues to work once real Dawn lands (returns true and the
//   call sites actually run).
//
// What lands later (D6-D9):
//
//   - Real CreateInstance / RequestAdapter / RequestDevice backed by
//     wgpu* C-API calls.
//   - GPUCommandEncoder / GPURenderPassEncoder / GPUBuffer JS wrappers.
//   - Adaptation of Dawn's src/dawn/node/ N-API binding to
//     internalBinding shape (V1 milestone).
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

// Single error message reused across every not-yet-implemented entry.
// Points at the fleet plan doc so users can find the integration
// design + an issue link to track progress.
const char kPendingMessage[] =
    "node:smol-webgpu is not yet wired — Dawn integration pending. "
    "See .claude/plans/dawn-webgpu-integration.md (D6-D9) for the "
    "method rollout.";

const char kUnavailableMessage[] =
    "node:smol-webgpu unavailable — this node-smol build was not linked "
    "against Dawn. Build dawn-builder (pnpm --filter dawn-builder run "
    "build) and rebuild node-smol with the artifact present.";

inline void ThrowPending(Isolate* isolate) {
  Local<String> msg =
      String::NewFromUtf8(isolate, kPendingMessage,
                          v8::NewStringType::kInternalized)
          .ToLocalChecked();
  isolate->ThrowException(Exception::Error(msg));
}

inline void ThrowUnavailable(Isolate* isolate) {
  Local<String> msg =
      String::NewFromUtf8(isolate, kUnavailableMessage,
                          v8::NewStringType::kInternalized)
          .ToLocalChecked();
  isolate->ThrowException(Exception::Error(msg));
}

}  // namespace

// IsAvailable is the ONE entry that returns rather than throws. It is
// the detection mechanism userland reads to decide whether to attempt
// the rest of the surface or fall back. Returns true iff this build
// was linked against Dawn.

static void IsAvailable(const FunctionCallbackInfo<Value>& args) {
#ifdef HAVE_DAWN
  args.GetReturnValue().Set(true);
#else
  args.GetReturnValue().Set(false);
#endif
}

// All other entries currently throw — kUnavailableMessage if the build
// has no Dawn, kPendingMessage otherwise (the method itself hasn't
// been implemented yet but Dawn IS present, so an upgrade unblocks
// it without a rebuild). The function names mirror the W3C WebGPU IDL
// one-for-one so the JS layer can re-export them under their
// canonical names.

static void CreateInstance(const FunctionCallbackInfo<Value>& args) {
#ifdef HAVE_DAWN
  ThrowPending(args.GetIsolate());
#else
  ThrowUnavailable(args.GetIsolate());
#endif
}

static void RequestAdapter(const FunctionCallbackInfo<Value>& args) {
#ifdef HAVE_DAWN
  ThrowPending(args.GetIsolate());
#else
  ThrowUnavailable(args.GetIsolate());
#endif
}

static void RequestDevice(const FunctionCallbackInfo<Value>& args) {
#ifdef HAVE_DAWN
  ThrowPending(args.GetIsolate());
#else
  ThrowUnavailable(args.GetIsolate());
#endif
}

static void GetPreferredCanvasFormat(
    const FunctionCallbackInfo<Value>& args) {
#ifdef HAVE_DAWN
  ThrowPending(args.GetIsolate());
#else
  ThrowUnavailable(args.GetIsolate());
#endif
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
