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

#include "quic_internal.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "uv.h"
#include "v8.h"

#include <cstring>

namespace node {
namespace socketsecurity {
namespace quic {

using v8::Boolean;
using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::NewStringType;
using v8::Object;
using v8::String;
using v8::Value;

EngineRegistry& Engines() {
  static EngineRegistry r;
  return r;
}

ConnRegistry& Conns() {
  static ConnRegistry r;
  return r;
}

uint32_t RegisterConn(lsquic_conn_t* conn, uint32_t engine_id) {
  ConnRegistry& r = Conns();
  std::lock_guard<std::mutex> lock(r.mu);
  uint32_t id = r.next_id++;
  auto slot = std::make_unique<ConnSlot>();
  slot->conn = conn;
  slot->engine_id = engine_id;
  r.conns.emplace(id, std::move(slot));
  return id;
}

lsquic_conn_t* LookupConn(uint32_t id) {
  ConnRegistry& r = Conns();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.conns.find(id);
  return it == r.conns.end() ? nullptr : it->second->conn;
}

bool UnregisterConn(uint32_t id) {
  ConnRegistry& r = Conns();
  std::lock_guard<std::mutex> lock(r.mu);
  return r.conns.erase(id) > 0;
}

EngineSlot* LookupEngineSlot(uint32_t engine_id) {
  EngineRegistry& r = Engines();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.engines.find(engine_id);
  return it == r.engines.end() ? nullptr : it->second.get();
}

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

// Bind one optional v8::Function from the callbacks object into a
// v8::Global slot. `key` is the property name. Returns true on
// success (key absent OR value is a function); false on bad type.
bool BindOptionalCallback(Isolate* isolate, Local<Context> context,
                          Local<Object> callbacks, const char* key,
                          v8::Global<Function>* out) {
  Local<String> name = NewOneByteString(isolate, key);
  if (!callbacks->Has(context, name).FromMaybe(false)) {
    return true;
  }
  MaybeLocal<Value> v = callbacks->Get(context, name);
  Local<Value> value;
  if (!v.ToLocal(&value) || value->IsNullOrUndefined()) {
    return true;
  }
  if (!value->IsFunction()) {
    return false;
  }
  out->Reset(isolate, value.As<Function>());
  return true;
}

bool BindRequiredCallback(Isolate* isolate, Local<Context> context,
                          Local<Object> callbacks, const char* key,
                          v8::Global<Function>* out) {
  Local<String> name = NewOneByteString(isolate, key);
  MaybeLocal<Value> v = callbacks->Get(context, name);
  Local<Value> value;
  if (!v.ToLocal(&value) || !value->IsFunction()) {
    return false;
  }
  out->Reset(isolate, value.As<Function>());
  return true;
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

// createEngine(flags, callbacks, settings?) -> engineHandle | 0
//
// `callbacks` is required and must be a plain object. Keys (all
// optional individually; clients typically pass on_new_stream / on_read /
// on_write / on_close / packets_out; servers add on_new_conn / on_hsk_done):
//   - packetsOut         (required for clients; lsquic refuses sending
//                         packets if absent)
//   - onNewConn          (server-side accept hook)
//   - onConnClosed
//   - onNewStream
//   - onRead             — readiness signal; JS calls streamRead to drain
//   - onWrite            — readiness signal; JS calls streamWrite to fill
//   - onClose
//   - onHskDone          — client-side handshake completion
//   - onGoawayReceived
//
// `settings` is currently unused; lsquic defaults are applied. Step 8
// will marshal the full lsquic_engine_settings struct here.
static void CreateEngine(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (!g_lsquic_inited.load(std::memory_order_acquire)) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<Context> context = isolate->GetCurrentContext();
  unsigned flags = static_cast<unsigned>(
      args[0]->Uint32Value(context).FromMaybe(0));

  // Validate callbacks object.
  if (args.Length() < 2 || !args[1]->IsObject()) {
    isolate->ThrowException(v8::Exception::TypeError(NewOneByteString(
        isolate,
        "createEngine(flags, callbacks, settings?): callbacks must be an object")));
    return;
  }
  Local<Object> callbacks = args[1].As<Object>();

  // Reserve a slot up front so the engine_id is stable before
  // lsquic_engine_new captures it via ea_packets_out_ctx /
  // ea_stream_if_ctx.
  EngineRegistry& reg = Engines();
  uint32_t id;
  EngineSlot* slot_ptr;
  {
    std::lock_guard<std::mutex> lock(reg.mu);
    id = reg.next_id++;
    auto slot = std::make_unique<EngineSlot>();
    slot->engine_id = id;
    slot->cb.isolate = isolate;
    slot->cb.context.Reset(isolate, context);
    slot_ptr = slot.get();
    reg.engines.emplace(id, std::move(slot));
  }

  bool ok = true;
  ok &= BindOptionalCallback(isolate, context, callbacks, "packetsOut",
                             &slot_ptr->cb.packets_out);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onNewConn",
                             &slot_ptr->cb.on_new_conn);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onConnClosed",
                             &slot_ptr->cb.on_conn_closed);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onNewStream",
                             &slot_ptr->cb.on_new_stream);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onRead",
                             &slot_ptr->cb.on_read);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onWrite",
                             &slot_ptr->cb.on_write);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onClose",
                             &slot_ptr->cb.on_close);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onHskDone",
                             &slot_ptr->cb.on_hsk_done);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onGoawayReceived",
                             &slot_ptr->cb.on_goaway_received);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onDatagramWrite",
                             &slot_ptr->cb.on_datagram_write);
  ok &= BindOptionalCallback(isolate, context, callbacks, "onDatagram",
                             &slot_ptr->cb.on_datagram);
  if (!ok) {
    std::lock_guard<std::mutex> lock(reg.mu);
    reg.engines.erase(id);
    isolate->ThrowException(v8::Exception::TypeError(NewOneByteString(
        isolate,
        "createEngine: a callback property is present but not a function")));
    return;
  }

  // Populate defaults for the requested flags.
  lsquic_engine_settings settings;
  lsquic_engine_init_settings(&settings, flags);

  // Wire the callback infrastructure: packets_out + stream_if both
  // route through the slot pointer, so trampolines recover the slot
  // (and its v8::Global handles) from the lsquic context.
  lsquic_engine_api api{};
  api.ea_settings = &settings;
  api.ea_packets_out = PacketsOutTrampoline;
  api.ea_packets_out_ctx = slot_ptr;
  api.ea_stream_if = &kStreamIf;
  api.ea_stream_if_ctx = slot_ptr;

  lsquic_engine_t* engine = lsquic_engine_new(flags, &api);
  if (engine == nullptr) {
    std::lock_guard<std::mutex> lock(reg.mu);
    reg.engines.erase(id);
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }

  slot_ptr->engine = engine;
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

static void DestroyEngine(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  EngineRegistry& r = Engines();
  std::unique_ptr<EngineSlot> slot;
  {
    std::lock_guard<std::mutex> lock(r.mu);
    auto it = r.engines.find(id);
    if (it == r.engines.end()) {
      return;
    }
    // If we're being called from inside a callback for this engine,
    // refuse — a JS callback can't tear down its own engine without
    // tripping into lsquic's reentrancy guards. Document via stderr
    // so the JS bug is visible.
    if (it->second->in_callback.load()) {
      fprintf(stderr,
              "smol_quic: destroyEngine(%u) refused — engine is in a "
              "callback. Defer destroyEngine outside the trampoline.\n",
              id);
      return;
    }
    slot = std::move(it->second);
    r.engines.erase(it);
  }
  // Run lsquic_engine_destroy WITHOUT the registry mutex held — it
  // synchronously calls on_conn_closed for every live conn, and those
  // trampolines may take the registry mutex when looking up the slot.
  // The slot pointer stays valid because we own the unique_ptr here.
  if (slot->engine != nullptr) {
    lsquic_engine_destroy(slot->engine);
  }
  // Reset all v8::Global handles so the JS callback Functions can be
  // GC'd. Order doesn't matter — they're independent.
  slot->cb.packets_out.Reset();
  slot->cb.on_new_conn.Reset();
  slot->cb.on_conn_closed.Reset();
  slot->cb.on_new_stream.Reset();
  slot->cb.on_read.Reset();
  slot->cb.on_write.Reset();
  slot->cb.on_close.Reset();
  slot->cb.on_hsk_done.Reset();
  slot->cb.on_goaway_received.Reset();
  slot->cb.on_datagram_write.Reset();
  slot->cb.on_datagram.Reset();
  slot->cb.context.Reset();
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

// ─── Section 5: Engine connect (outbound) ────────────────────────────
//
// lsquic.h:
//   lsquic_conn_t* lsquic_engine_connect(
//       lsquic_engine_t*, enum lsquic_version,
//       const struct sockaddr* local_sa,
//       const struct sockaddr* peer_sa,
//       void* peer_ctx,
//       lsquic_conn_ctx_t* conn_ctx,
//       const char* hostname,
//       unsigned short base_plpmtu,
//       const unsigned char* sess_resume, size_t sess_resume_len,
//       const unsigned char* token, size_t token_sz);
//
// JS surface:
//   engineConnect(handle, version, localSa, peerSa, sni, plpmtu,
//                 sessResume?, token?) -> connectionId | 0
//
// Returns a uint32 handle into the per-engine connection map (step 6
// lands the connection registry; for now we return 1 on success, 0 on
// failure as a placeholder).
//
// stream_if callbacks (on_new_conn / on_conn_closed / on_new_stream /
// on_read / on_write / on_close) wire in steps 5-6 once the JS
// callback dispatcher is in place. For now, this is connect-only:
// the connection opens, attempts the handshake via packets_out, but
// no JS-side events fire until the callback table is registered.

static void EngineConnect(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t engine_id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_engine_t* engine = LookupEngine(engine_id);
  if (engine == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }

  int version = args[1]->Int32Value(context).FromMaybe(LSQVER_I001);

  struct sockaddr_storage local_sa{};
  struct sockaddr_storage peer_sa{};
  size_t local_len = PackSockaddr(isolate, context, args[2], &local_sa);
  size_t peer_len = PackSockaddr(isolate, context, args[3], &peer_sa);
  if (local_len == 0 || peer_len == 0) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }

  // SNI hostname. Optional — null means "no hostname verification".
  String::Utf8Value sni(isolate, args[4]);
  const char* sni_cstr = (*sni == nullptr) ? nullptr : *sni;

  unsigned short plpmtu = static_cast<unsigned short>(
      args[5]->Uint32Value(context).FromMaybe(0));

  // sess_resume and token are optional Uint8Arrays. nullptr if not
  // provided — lsquic does a 1-RTT handshake instead of 0-RTT.
  const unsigned char* sess_resume = nullptr;
  size_t sess_resume_len = 0;
  if (args[6]->IsUint8Array()) {
    auto arr = args[6].As<v8::Uint8Array>();
    auto store = arr->Buffer()->GetBackingStore();
    sess_resume = static_cast<const unsigned char*>(store->Data()) +
                  arr->ByteOffset();
    sess_resume_len = arr->ByteLength();
  }
  const unsigned char* token = nullptr;
  size_t token_sz = 0;
  if (args[7]->IsUint8Array()) {
    auto arr = args[7].As<v8::Uint8Array>();
    auto store = arr->Buffer()->GetBackingStore();
    token = static_cast<const unsigned char*>(store->Data()) +
            arr->ByteOffset();
    token_sz = arr->ByteLength();
  }

  lsquic_conn_t* conn = lsquic_engine_connect(
      engine, static_cast<enum lsquic_version>(version),
      reinterpret_cast<const struct sockaddr*>(&local_sa),
      reinterpret_cast<const struct sockaddr*>(&peer_sa),
      /*peer_ctx=*/nullptr, /*conn_ctx=*/nullptr, sni_cstr, plpmtu,
      sess_resume, sess_resume_len, token, token_sz);
  if (conn == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  args.GetReturnValue().Set(
      Integer::NewFromUnsigned(isolate, RegisterConn(conn, engine_id)));
}

// ─── Section 6: Connection lifecycle ─────────────────────────────────
//
// lsquic.h:
//   void              lsquic_conn_close(lsquic_conn_t*);
//   enum LSQUIC_CONN_STATUS lsquic_conn_status(lsquic_conn_t*,
//                                               char* errbuf,
//                                               size_t bufsz);
//   const lsquic_cid_t* lsquic_conn_id(const lsquic_conn_t*);
//   enum lsquic_version lsquic_conn_quic_version(const lsquic_conn_t*);
//   const char*       lsquic_conn_get_sni(lsquic_conn_t*);
//
// JS surface:
//   connClose(connId)
//   connGetStatus(connId) -> { status, error? }
//     - status integers from LSCONN_ST_* (HSK_IN_PROGRESS, CONNECTED,
//       HSK_FAILURE, GOING_AWAY, TIMED_OUT, RESET, USER_ABORTED, ERROR,
//       CLOSED, PEER_GOING_AWAY)
//     - error: string from lsquic's errbuf when non-empty
//   connGetCID(connId) -> Uint8Array (raw CID bytes) | null
//   connGetVersion(connId) -> int (one of version.* entries)
//   connGetSNI(connId) -> string | null

static void ConnClose(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) return;
  lsquic_conn_close(conn);
  // Note: the connection isn't actually freed by lsquic_conn_close;
  // lsquic will invoke on_conn_closed (when callbacks are wired in
  // step 7) and then free the slot. The JS layer should not call
  // any other conn* method after connClose. We keep the registry
  // entry until on_conn_closed fires to give callbacks a valid
  // handle to surface the close event.
}

static void ConnGetStatus(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  Local<Object> out = Object::New(isolate);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    out->Set(context, NewOneByteString(isolate, "status"),
             Integer::New(isolate, -1))
        .Check();
    args.GetReturnValue().Set(out);
    return;
  }
  char errbuf[512];
  errbuf[0] = '\0';
  enum LSQUIC_CONN_STATUS status =
      lsquic_conn_status(conn, errbuf, sizeof(errbuf));
  out->Set(context, NewOneByteString(isolate, "status"),
           Integer::New(isolate, static_cast<int32_t>(status)))
      .Check();
  if (errbuf[0] != '\0') {
    Local<String> err = String::NewFromUtf8(isolate, errbuf,
                                              NewStringType::kNormal)
                            .ToLocalChecked();
    out->Set(context, NewOneByteString(isolate, "error"), err).Check();
  }
  args.GetReturnValue().Set(out);
}

static void ConnGetCID(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  const lsquic_cid_t* cid = lsquic_conn_id(conn);
  if (cid == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  // lsquic_cid_t is a fixed-size byte slot (typically up to 20 bytes
  // per RFC 9000). Copy the raw bytes into a Uint8Array sized to
  // cid->len. The structure layout is `{ uint_fast8_t len; uint8_t
  // idbuf[MAX_CID_LEN]; }`.
  const size_t len = cid->len;
  auto backing = v8::ArrayBuffer::NewBackingStore(isolate, len);
  std::memcpy(backing->Data(), cid->idbuf, len);
  Local<v8::ArrayBuffer> ab =
      v8::ArrayBuffer::New(isolate, std::move(backing));
  Local<v8::Uint8Array> arr = v8::Uint8Array::New(ab, 0, len);
  args.GetReturnValue().Set(arr);
}

static void ConnGetVersion(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  args.GetReturnValue().Set(Integer::New(
      isolate, static_cast<int32_t>(lsquic_conn_quic_version(conn))));
}

static void ConnGetSNI(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  const char* sni = lsquic_conn_get_sni(conn);
  if (sni == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, sni, NewStringType::kNormal)
          .ToLocalChecked());
}

// ─── Section 7: Datagram conn methods ────────────────────────────────
//
// lsquic.h: lsquic_conn_want_datagram_write, lsquic_conn_get_min_datagram_size,
// lsquic_conn_set_min_datagram_size. The on_datagram + on_dg_write
// trampolines live in quic_stream_binding.cc next to the stream_if
// instance; these JS methods are the conn-state setters callers use
// to opt in to datagram traffic.

static void ConnWantDatagramWrite(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  int want = args[1]->BooleanValue(isolate) ? 1 : 0;
  args.GetReturnValue().Set(
      Integer::New(isolate, lsquic_conn_want_datagram_write(conn, want)));
}

static void ConnGetMinDatagramSize(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  args.GetReturnValue().Set(Integer::New(
      isolate, static_cast<int32_t>(lsquic_conn_get_min_datagram_size(conn))));
}

static void ConnSetMinDatagramSize(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_conn_t* conn = LookupConn(id);
  if (conn == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  size_t sz =
      static_cast<size_t>(args[1]->Uint32Value(context).FromMaybe(0));
  args.GetReturnValue().Set(
      Integer::New(isolate, lsquic_conn_set_min_datagram_size(conn, sz)));
}

// ─── LSCONN_ST_* enum mirror ─────────────────────────────────────────
//
// lsquic.h:`enum LSQUIC_CONN_STATUS`. Numeric values exposed so JS
// can compare connGetStatus().status against named constants.

static void BindConnStatus(Isolate* isolate, Local<Context> context,
                           Local<Object> target) {
  Local<Object> connStatus = Object::New(isolate);
#define BIND_STATUS(name, value)                                         \
  connStatus                                                             \
      ->Set(context, NewOneByteString(isolate, name),                    \
            Integer::New(isolate, static_cast<int32_t>(value)))          \
      .Check();
  BIND_STATUS("HSK_IN_PROGRESS", LSCONN_ST_HSK_IN_PROGRESS);
  BIND_STATUS("CONNECTED", LSCONN_ST_CONNECTED);
  BIND_STATUS("HSK_FAILURE", LSCONN_ST_HSK_FAILURE);
  BIND_STATUS("GOING_AWAY", LSCONN_ST_GOING_AWAY);
  BIND_STATUS("TIMED_OUT", LSCONN_ST_TIMED_OUT);
  BIND_STATUS("RESET", LSCONN_ST_RESET);
  BIND_STATUS("USER_ABORTED", LSCONN_ST_USER_ABORTED);
  BIND_STATUS("ERROR", LSCONN_ST_ERROR);
  BIND_STATUS("CLOSED", LSCONN_ST_CLOSED);
  BIND_STATUS("PEER_GOING_AWAY", LSCONN_ST_PEER_GOING_AWAY);
#undef BIND_STATUS
  target
      ->Set(context, NewOneByteString(isolate, "connStatus"), connStatus)
      .Check();
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
  SetMethod(context, target, "engineConnect", EngineConnect);
  SetMethod(context, target, "connClose", ConnClose);
  SetMethod(context, target, "connGetStatus", ConnGetStatus);
  SetMethod(context, target, "connGetCID", ConnGetCID);
  SetMethod(context, target, "connGetVersion", ConnGetVersion);
  SetMethod(context, target, "connGetSNI", ConnGetSNI);
  SetMethod(context, target, "connWantDatagramWrite", ConnWantDatagramWrite);
  SetMethod(context, target, "connGetMinDatagramSize", ConnGetMinDatagramSize);
  SetMethod(context, target, "connSetMinDatagramSize", ConnSetMinDatagramSize);

  BindVersionEnum(isolate, context, target);
  BindEngineFlags(isolate, context, target);
  BindConnStatus(isolate, context, target);

  // Stream methods live in quic_stream_binding.cc so each .cc file
  // stays under the 1000-line hard cap. The stream binding registers
  // streamRead / streamWrite / streamShutdown / streamClose /
  // streamWantRead / streamWantWrite on the same `target` object.
  RegisterStreamMethods(context, target);
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
  registry->Register(EngineConnect);
  registry->Register(ConnClose);
  registry->Register(ConnGetStatus);
  registry->Register(ConnGetCID);
  registry->Register(ConnGetVersion);
  registry->Register(ConnGetSNI);
  registry->Register(ConnWantDatagramWrite);
  registry->Register(ConnGetMinDatagramSize);
  registry->Register(ConnSetMinDatagramSize);
  RegisterStreamExternalReferences(registry);
}

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_quic,
                                    node::socketsecurity::quic::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_quic, node::socketsecurity::quic::RegisterExternalReferences)
