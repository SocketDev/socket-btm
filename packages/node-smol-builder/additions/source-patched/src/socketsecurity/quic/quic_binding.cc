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
#include "uv.h"
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

// Engine handle registry. Process-wide map keyed by uint32 handle.
// Mutex-guarded so cross-worker access is safe even though typical
// QUIC use is single-threaded per engine. JS owns the lifecycle:
// createEngine() returns a handle, destroyEngine(handle) releases it.
//
// Engines hold a packets_out callback that fires synchronously inside
// engineProcessConns / engineConnect. The JS layer registers the
// callback at createEngine time; we trampoline through a static
// dispatcher that reads the per-engine V8 Persistent from the
// registry slot.
struct EngineSlot {
  lsquic_engine_t* engine;
  // Per-engine state for callbacks lands here in step 4 when
  // engineConnect introduces the packets_out trampoline.
};

struct EngineRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  std::unordered_map<uint32_t, std::unique_ptr<EngineSlot>> engines;
};

EngineRegistry& Engines() {
  static EngineRegistry r;
  return r;
}

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

// ─── Section 3: Engine create / destroy ──────────────────────────────
//
// lsquic.h:
//   void           lsquic_engine_init_settings(struct lsquic_engine_settings*,
//                                              unsigned flags);
//   int            lsquic_engine_check_settings(const struct
//                                               lsquic_engine_settings*,
//                                               unsigned flags,
//                                               char* err_buf,
//                                               size_t err_buf_sz);
//   lsquic_engine_t* lsquic_engine_new(unsigned flags,
//                                       const struct lsquic_engine_api*);
//   void           lsquic_engine_destroy(lsquic_engine_t*);
//
// createEngine(flags) accepts the flag mask (LSQUIC_ENG_SERVER on
// for server mode, 0 for client) and returns an opaque uint32
// handle. The full settings-struct passthrough (50+ fields) lands in
// step 8 — this step uses lsquic_engine_init_settings to populate
// defaults appropriate for the requested flags.
//
// The engine_api struct that lsquic_engine_new wants carries the
// stream-callback table + packets_out callback + cert lookup
// callback. We pass a minimal struct with nullptr callbacks here
// (engine compiles but can't yet send packets) — callback wiring
// lands in steps 3-4 as the dispatcher trampoline shape stabilizes.

static void CreateEngine(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (!g_lsquic_inited.load(std::memory_order_acquire)) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  unsigned flags = static_cast<unsigned>(
      args[0]->Uint32Value(context).FromMaybe(0));

  // Populate defaults for the requested flags.
  lsquic_engine_settings settings;
  lsquic_engine_init_settings(&settings, flags);

  // Engine API struct — callbacks land in steps 3-4. For now the
  // engine can be constructed and destroyed but not driven; the JS
  // layer will see a valid handle and exercise the lifecycle.
  lsquic_engine_api api{};
  api.ea_settings = &settings;

  lsquic_engine_t* engine = lsquic_engine_new(flags, &api);
  if (engine == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }

  EngineRegistry& r = Engines();
  std::lock_guard<std::mutex> lock(r.mu);
  uint32_t id = r.next_id++;
  auto slot = std::make_unique<EngineSlot>();
  slot->engine = engine;
  r.engines.emplace(id, std::move(slot));
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

static void DestroyEngine(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  EngineRegistry& r = Engines();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.engines.find(id);
  if (it == r.engines.end()) {
    return;
  }
  lsquic_engine_destroy(it->second->engine);
  r.engines.erase(it);
}

// ─── Engine lookup helper ────────────────────────────────────────────
//
// Mutex-guarded read of the registry. Returns nullptr if the handle
// is unknown — callers must check before dereferencing.

static lsquic_engine_t* LookupEngine(uint32_t id) {
  EngineRegistry& r = Engines();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.engines.find(id);
  return it == r.engines.end() ? nullptr : it->second->engine;
}

// ─── Section 4: Engine I/O ───────────────────────────────────────────
//
// lsquic.h:
//   void     lsquic_engine_process_conns(lsquic_engine_t*);
//   int      lsquic_engine_packet_in(lsquic_engine_t*,
//                                     const unsigned char* data, size_t len,
//                                     const struct sockaddr* sa_local,
//                                     const struct sockaddr* sa_peer,
//                                     void* peer_ctx, int ecn);
//   int      lsquic_engine_has_unsent_packets(lsquic_engine_t*);
//   unsigned lsquic_engine_count_attq(lsquic_engine_t*, int from_now);
//   unsigned lsquic_engine_quic_versions(const lsquic_engine_t*);
//
// JS surface:
//   engineProcessConns(handle)
//   enginePacketIn(handle, buf, localSaJson, peerSaJson, ecn) -> int
//   engineHasUnsent(handle) -> bool
//   engineCountAttq(handle, fromNowMs) -> uint
//   engineQuicVersions(handle) -> uint  // bitmask
//
// Sockaddr packing: JS passes addresses as plain objects:
//   { family: 4 | 6, port: number, address: string }
// We marshal to struct sockaddr_in / sockaddr_in6 inline.

namespace {

// Pack a JS sockaddr-shape object into struct sockaddr_storage via
// libuv's portable helpers (uv_ip4_addr / uv_ip6_addr). Returns the
// populated address length, or 0 on parse failure. Caller's `out`
// is the storage struct cast-target.
//
// Using libuv here means no <arpa/inet.h> / <winsock2.h> includes —
// libuv abstracts the platform split. Same pattern Node's
// cares_wrap.cc uses (uv_inet_pton).
size_t PackSockaddr(Isolate* isolate, Local<Context> context,
                    Local<Value> val, struct sockaddr_storage* out) {
  if (!val->IsObject()) return 0;
  Local<Object> obj = val.As<Object>();
  Local<Value> familyVal;
  if (!obj->Get(context, NewOneByteString(isolate, "family"))
           .ToLocal(&familyVal)) {
    return 0;
  }
  int family = familyVal->Int32Value(context).FromMaybe(4);
  Local<Value> portVal;
  Local<Value> addrVal;
  if (!obj->Get(context, NewOneByteString(isolate, "port"))
           .ToLocal(&portVal) ||
      !obj->Get(context, NewOneByteString(isolate, "address"))
           .ToLocal(&addrVal)) {
    return 0;
  }
  int port = portVal->Int32Value(context).FromMaybe(0);
  if (!addrVal->IsString()) return 0;
  String::Utf8Value addrStr(isolate, addrVal);
  if (*addrStr == nullptr) return 0;

  std::memset(out, 0, sizeof(*out));
  if (family == 6) {
    auto* sin6 = reinterpret_cast<struct sockaddr_in6*>(out);
    if (uv_ip6_addr(*addrStr, port, sin6) != 0) return 0;
    return sizeof(struct sockaddr_in6);
  }
  auto* sin = reinterpret_cast<struct sockaddr_in*>(out);
  if (uv_ip4_addr(*addrStr, port, sin) != 0) return 0;
  return sizeof(struct sockaddr_in);
}

}  // namespace

static void EngineProcessConns(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_engine_t* engine =
      LookupEngine(args[0]->Uint32Value(context).FromMaybe(0));
  if (engine == nullptr) return;
  lsquic_engine_process_conns(engine);
}

static void EnginePacketIn(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_engine_t* engine =
      LookupEngine(args[0]->Uint32Value(context).FromMaybe(0));
  if (engine == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  if (!args[1]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  auto arr = args[1].As<v8::Uint8Array>();
  auto store = arr->Buffer()->GetBackingStore();
  const unsigned char* data = static_cast<const unsigned char*>(
      store->Data()) + arr->ByteOffset();
  const size_t len = arr->ByteLength();

  struct sockaddr_storage local_sa{};
  struct sockaddr_storage peer_sa{};
  size_t local_len = PackSockaddr(isolate, context, args[2], &local_sa);
  size_t peer_len = PackSockaddr(isolate, context, args[3], &peer_sa);
  if (local_len == 0 || peer_len == 0) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  int ecn = args[4]->Int32Value(context).FromMaybe(0);
  int r = lsquic_engine_packet_in(
      engine, data, len,
      reinterpret_cast<const struct sockaddr*>(&local_sa),
      reinterpret_cast<const struct sockaddr*>(&peer_sa), nullptr, ecn);
  args.GetReturnValue().Set(Integer::New(isolate, r));
}

static void EngineHasUnsent(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_engine_t* engine =
      LookupEngine(args[0]->Uint32Value(context).FromMaybe(0));
  args.GetReturnValue().Set(
      Boolean::New(isolate, engine != nullptr &&
                                lsquic_engine_has_unsent_packets(engine) != 0));
}

static void EngineCountAttq(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_engine_t* engine =
      LookupEngine(args[0]->Uint32Value(context).FromMaybe(0));
  if (engine == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  int from_now = args[1]->Int32Value(context).FromMaybe(0);
  args.GetReturnValue().Set(Integer::NewFromUnsigned(
      isolate, lsquic_engine_count_attq(engine, from_now)));
}

static void EngineQuicVersions(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_engine_t* engine =
      LookupEngine(args[0]->Uint32Value(context).FromMaybe(0));
  if (engine == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  args.GetReturnValue().Set(Integer::NewFromUnsigned(
      isolate, lsquic_engine_quic_versions(engine)));
}

// ─── Engine flag mirror ──────────────────────────────────────────────
//
// LSQUIC_ENG_SERVER + LSQUIC_ENG_HTTP from lsquic.h:`enum
// lsquic_engine_flags`. Composed by JS into the flag mask passed to
// createEngine().

static void BindEngineFlags(Isolate* isolate, Local<Context> context,
                            Local<Object> target) {
  Local<Object> engineFlags = Object::New(isolate);
  engineFlags
      ->Set(context, NewOneByteString(isolate, "SERVER"),
            Integer::New(isolate, LSQUIC_ENG_SERVER))
      .Check();
  engineFlags
      ->Set(context, NewOneByteString(isolate, "HTTP"),
            Integer::New(isolate, LSQUIC_ENG_HTTP))
      .Check();
  target
      ->Set(context, NewOneByteString(isolate, "engineFlags"), engineFlags)
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
  SetMethod(context, target, "createEngine", CreateEngine);
  SetMethod(context, target, "destroyEngine", DestroyEngine);
  SetMethod(context, target, "engineProcessConns", EngineProcessConns);
  SetMethod(context, target, "enginePacketIn", EnginePacketIn);
  SetMethod(context, target, "engineHasUnsent", EngineHasUnsent);
  SetMethod(context, target, "engineCountAttq", EngineCountAttq);
  SetMethod(context, target, "engineQuicVersions", EngineQuicVersions);

  BindVersionEnum(isolate, context, target);
  BindEngineFlags(isolate, context, target);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(GlobalInit);
  registry->Register(GlobalCleanup);
  registry->Register(CreateEngine);
  registry->Register(DestroyEngine);
  registry->Register(EngineProcessConns);
  registry->Register(EnginePacketIn);
  registry->Register(EngineHasUnsent);
  registry->Register(EngineCountAttq);
  registry->Register(EngineQuicVersions);
}

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_quic,
                                    node::socketsecurity::quic::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_quic, node::socketsecurity::quic::RegisterExternalReferences)
