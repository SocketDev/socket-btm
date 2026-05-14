// node:smol-quic V8 binding glue.
//
// Bridges the JS-facing `node:smol-quic` surface to the embedded
// lsquic engine (lsquic-infra package). Same handle-registry pattern
// as the smol_tui binding — process-wide unordered_map keyed by an
// opaque uint32 handle, mutex-guarded for cross-worker safety, with
// JS-owned lifecycles via explicit destroyEngine / destroyConn /
// destroyStream calls.
//
// Functional groups exposed:
//
//   1. Global init / cleanup — wraps lsquic_global_init /
//      lsquic_global_cleanup. Must be called before any engine ops
//      and at process exit. The lib idiom is "JS module init calls
//      globalInit once, never calls cleanup" — process exit is the
//      cleanup boundary.
//
//   2. Engine lifecycle — createEngine(flags, settings) returns a
//      handle; destroyEngine(handle) tears down. Settings struct is
//      passed as a plain JS object that we transform into a
//      lsquic_engine_settings struct in C++.
//
//   3. Engine I/O — engineProcessConns(handle) drains pending
//      conn-tickable work; enginePacketIn(handle, buf, len, ecn,
//      localSa, peerSa) feeds wire bytes; engineConnectionsCount
//      reports live conn count for back-pressure.
//
//   4. Engine connect — engineConnect(handle, version, localSa,
//      peerSa, sni, peerCtx, alpn, zeroRttToken) opens an outbound
//      connection, returns a connection handle.
//
//   5. Connection — connClose / connGetStatus / connGetCID /
//      connGetPeerAddr / connGetALPN. Outbound + inbound use the
//      same surface.
//
//   6. Stream — streamOpen / streamClose / streamRead / streamWrite
//      / streamShutdown / streamSetPriority. Plus headers send/read
//      for HTTP/3 (see smol_http3_binding.cc).
//
// Upstream pin:
//   lsquic v4.6.2 (lsquic-infra/.gitmodules # lsquic-4.6.2)
//   https://github.com/litespeedtech/lsquic/tree/v4.6.2
//
// Public header (~2342 lines, 90 entry points):
//   packages/lsquic-infra/upstream/lsquic/include/lsquic.h
//
// TLS backend: OpenSSL 3.5.6 (vendored by Node 26's deps/openssl/)
// rather than BoringSSL — see lsquic-infra/README.md for the
// `SSL_set_quic_tls_cbs` rationale. lsquic auto-detects via cmake
// flag `LSQUIC_LIBSSL=OPENSSL`.

#include "lsquic.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <atomic>
#include <cstring>
#include <memory>
#include <mutex>
#include <unordered_map>

namespace node {
namespace socketsecurity {
namespace quic {

using v8::Boolean;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

Local<String> NewOneByteString(Isolate* isolate, const char* literal) {
  return String::NewFromOneByte(isolate,
                                reinterpret_cast<const uint8_t*>(literal),
                                NewStringType::kNormal,
                                static_cast<int>(std::strlen(literal)))
      .ToLocalChecked();
}

// Global-init state. lsquic_global_init must run exactly once per
// process and before any engine constructor; lsquic_global_cleanup is
// optional but harmless at process exit. We track the call so the JS
// layer's idempotent `globalInit()` doesn't re-enter the C library.
std::atomic<bool> g_lsquic_inited{false};

}  // namespace

// ─── Section 1: Global init / cleanup ────────────────────────────────
//
// lsquic.h:
//   int  lsquic_global_init(int flags);
//   void lsquic_global_cleanup(void);
//
// `flags` is LSQUIC_GLOBAL_CLIENT | LSQUIC_GLOBAL_SERVER — passing
// both is the typical embed pattern (a Node process can be either
// role per-engine). We default to both so the JS layer needs no flag
// handling.

static void GlobalInit(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (g_lsquic_inited.load(std::memory_order_acquire)) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  int32_t flags = args[0]->Int32Value(context).FromMaybe(
      LSQUIC_GLOBAL_CLIENT | LSQUIC_GLOBAL_SERVER);
  const int r = lsquic_global_init(flags);
  if (r == 0) {
    g_lsquic_inited.store(true, std::memory_order_release);
  }
  args.GetReturnValue().Set(Integer::New(isolate, r));
}

static void GlobalCleanup(const FunctionCallbackInfo<Value>& args) {
  if (!g_lsquic_inited.exchange(false, std::memory_order_acq_rel)) {
    return;
  }
  lsquic_global_cleanup();
}

// ─── Section 2: Version enum mirror ──────────────────────────────────
//
// lsquic.h `enum lsquic_version` carries the wire versions supported
// (Q043, Q046, Q050, ID27, ID29, ID-1, V1, RFC9000). We mirror the
// numeric enum values to JS so callers pass them by name through the
// `version` argument of engineConnect.

static void BindVersionEnum(Isolate* isolate, Local<Context> context,
                            Local<Object> target) {
  Local<Object> versions = Object::New(isolate);
#define BIND_VERSION(name, value)                                        \
  versions                                                               \
      ->Set(context, NewOneByteString(isolate, name),                    \
            Integer::New(isolate, static_cast<int32_t>(value)))          \
      .Check();
  BIND_VERSION("Q043", LSQVER_043);
  BIND_VERSION("Q046", LSQVER_046);
  BIND_VERSION("Q050", LSQVER_050);
  BIND_VERSION("ID27", LSQVER_ID27);
  BIND_VERSION("ID29", LSQVER_ID29);
  BIND_VERSION("I001", LSQVER_I001);  // RFC 9000 / QUIC v1
  BIND_VERSION("I002", LSQVER_I002);  // RFC 9369 / QUIC v2
#undef BIND_VERSION
  target->Set(context, NewOneByteString(isolate, "version"), versions)
      .Check();

  Local<Object> globalFlags = Object::New(isolate);
  globalFlags
      ->Set(context, NewOneByteString(isolate, "CLIENT"),
            Integer::New(isolate, LSQUIC_GLOBAL_CLIENT))
      .Check();
  globalFlags
      ->Set(context, NewOneByteString(isolate, "SERVER"),
            Integer::New(isolate, LSQUIC_GLOBAL_SERVER))
      .Check();
  target
      ->Set(context, NewOneByteString(isolate, "globalFlags"), globalFlags)
      .Check();
}

// ─── Initialize / RegisterExternalReferences ─────────────────────────

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  Isolate* isolate = context->GetIsolate();

  SetMethod(context, target, "globalInit", GlobalInit);
  SetMethod(context, target, "globalCleanup", GlobalCleanup);

  BindVersionEnum(isolate, context, target);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(GlobalInit);
  registry->Register(GlobalCleanup);
}

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_quic,
                                    node::socketsecurity::quic::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_quic, node::socketsecurity::quic::RegisterExternalReferences)
