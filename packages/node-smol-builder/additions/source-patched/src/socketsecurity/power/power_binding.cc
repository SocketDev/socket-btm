// node:smol-power V8 binding glue.
//
// Two functions exposed to JS, both sync, both backed by the
// platform-specific IsOnAcPowerImpl() in power_{mac,win,linux,stub}.cc:
//
//   isOnAcPower()      -> boolean
//   isOnBatteryPower() -> boolean (inverse)
//
// API surface mirrors Electron's `powerMonitor.isOnBatteryPower()` —
// the W3C BatteryManager attributes (level, chargingTime,
// dischargingTime) are deliberately omitted because they're not
// reliable across hardware and Electron's production experience
// landed on the same minimal surface.
//
// This file is platform-agnostic. Per-platform logic lives in
// sibling .cc files; node.gyp picks one per build via OS=="…" rules.

#include "socketsecurity/power/power.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "v8.h"

namespace node {
namespace socketsecurity {
namespace power {

using v8::Boolean;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::Value;

static void IsOnAcPower(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(Boolean::New(isolate, IsOnAcPowerImpl()));
}

static void IsOnBatteryPower(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  args.GetReturnValue().Set(Boolean::New(isolate, !IsOnAcPowerImpl()));
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "isOnAcPower", IsOnAcPower);
  SetMethod(context, target, "isOnBatteryPower", IsOnBatteryPower);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(IsOnAcPower);
  registry->Register(IsOnBatteryPower);
}

}  // namespace power
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_power, node::socketsecurity::power::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_power, node::socketsecurity::power::RegisterExternalReferences)
