#ifndef SRC_SOCKETSECURITY_QUIC_QUIC_INTERNAL_H_
#define SRC_SOCKETSECURITY_QUIC_QUIC_INTERNAL_H_

// node:smol-quic internal shared types.
//
// quic_binding.cc owns engine + connection lifecycle. quic_stream_binding.cc
// owns stream registry + the lsquic stream_if + packets_out trampolines.
// Both files share the EngineSlot type (because the trampolines need to
// recover the engine's JsCallbackTable from the lsquic context pointer),
// the registry accessors, and the JsCallbackTable definition.
//
// Hard rule (CLAUDE.md → File size): each .cc file stays under the
// 1000-line hard cap. The binding is naturally one cohesive surface so
// the split is along the engine ↔ stream seam — engine code lives in
// quic_binding.cc, stream callback machinery lives in
// quic_stream_binding.cc, and the shared types live here.

#include "lsquic.h"

#include "v8.h"

#include <atomic>
#include <memory>
#include <mutex>
#include <unordered_map>

// Forward-declare opaque OpenSSL types at GLOBAL scope (matches
// <openssl/ssl.h>'s declaration). Pulling them inside the smol-quic
// namespace would create a distinct local `ssl_ctx_st` type that
// doesn't unify with the real one when quic_settings_binding.cc
// includes <openssl/ssl.h>.
struct ssl_ctx_st;
using SSL_CTX = struct ssl_ctx_st;

namespace node {

class ExternalReferenceRegistry;

namespace socketsecurity {
namespace quic {

// V8 callback table — one per engine. Populated from the
// `callbacks` object passed to createEngine and used by the
// extern-C trampolines registered with lsquic.
//
// All v8::Global handles are Reset() in the EngineSlot destructor,
// after lsquic_engine_destroy has run, so lsquic can never call back
// into JS via a stale Global.
struct JsCallbackTable {
  v8::Isolate* isolate = nullptr;
  v8::Global<v8::Context> context;
  v8::Global<v8::Function> packets_out;
  v8::Global<v8::Function> on_new_conn;
  v8::Global<v8::Function> on_conn_closed;
  v8::Global<v8::Function> on_new_stream;
  v8::Global<v8::Function> on_read;
  v8::Global<v8::Function> on_write;
  v8::Global<v8::Function> on_close;
  v8::Global<v8::Function> on_hsk_done;
  v8::Global<v8::Function> on_goaway_received;
  // step 7 — server + datagrams
  v8::Global<v8::Function> on_datagram_write;  // outbound readiness
  v8::Global<v8::Function> on_datagram;        // inbound payload
};

// SSL_CTX is forward-declared at global scope (above) so it unifies
// with <openssl/ssl.h>'s declaration when quic_settings_binding.cc
// pulls in the full header.

struct EngineSlot {
  lsquic_engine_t* engine = nullptr;
  // Set in CreateEngine when callbacks are bound; queried by every
  // trampoline. Mutex on EngineRegistry guards the map, but the slot
  // itself is owned by a unique_ptr and only freed after the slot is
  // lifted out under that mutex — so the callback table is safe to
  // dereference once the slot pointer is recovered from the lsquic
  // engine context.
  JsCallbackTable cb;
  // Set true while a trampoline is inside Function::Call. destroyEngine
  // sees this and parks the slot in a Graveyard instead of destroying
  // it synchronously, avoiding the "JS callback calls destroyEngine
  // on its own engine" footgun.
  std::atomic<bool> in_callback{false};
  // Per-engine ID for stream-side back-pointer. Matches the registry
  // key under which Engines() stores this slot.
  uint32_t engine_id = 0;
  // Server-side cert context (step 8). Built via setServerCertContext
  // from PEM cert+key blobs. Single-SNI for now — multi-SNI lookup is
  // a future refinement. Owned by the slot; freed in destroyEngine.
  SSL_CTX* ssl_ctx = nullptr;
};

struct EngineRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  std::unordered_map<uint32_t, std::unique_ptr<EngineSlot>> engines;
};

EngineRegistry& Engines();

struct ConnSlot {
  lsquic_conn_t* conn = nullptr;
  uint32_t engine_id = 0;
};

struct ConnRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  std::unordered_map<uint32_t, std::unique_ptr<ConnSlot>> conns;
};

ConnRegistry& Conns();
uint32_t RegisterConn(lsquic_conn_t* conn, uint32_t engine_id);
lsquic_conn_t* LookupConn(uint32_t id);
bool UnregisterConn(uint32_t id);

struct StreamSlot {
  lsquic_stream_t* stream = nullptr;
  uint32_t engine_id = 0;
  std::atomic<bool> in_callback{false};
};

struct StreamRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  std::unordered_map<uint32_t, std::unique_ptr<StreamSlot>> streams;
};

StreamRegistry& Streams();
uint32_t RegisterStream(lsquic_stream_t* stream, uint32_t engine_id);
lsquic_stream_t* LookupStream(uint32_t id);
bool UnregisterStream(uint32_t id);

EngineSlot* LookupEngineSlot(uint32_t engine_id);

// Address of the static lsquic_stream_if filled in by quic_stream_binding.cc.
// quic_binding.cc passes this to lsquic_engine_api during createEngine.
extern const lsquic_stream_if kStreamIf;

// packets_out trampoline registered via lsquic_engine_api::ea_packets_out.
// Defined in quic_stream_binding.cc.
extern "C" int PacketsOutTrampoline(void* packets_out_ctx,
                                    const struct lsquic_out_spec* specs,
                                    unsigned count);

// Stream JS methods registered into the binding target by
// quic_stream_binding.cc. Called from quic_binding.cc::Initialize.
void RegisterStreamMethods(v8::Local<v8::Context> context,
                           v8::Local<v8::Object> target);
void RegisterStreamExternalReferences(ExternalReferenceRegistry* registry);

// Settings + cert JS methods registered into the binding target by
// quic_settings_binding.cc. Called from quic_binding.cc::Initialize.
void RegisterSettingsMethods(v8::Local<v8::Context> context,
                             v8::Local<v8::Object> target);
void RegisterSettingsExternalReferences(ExternalReferenceRegistry* registry);

// HTTP/3 stream JS methods registered by quic_http3_binding.cc. Called
// from quic_binding.cc::Initialize.
void RegisterHttp3Methods(v8::Local<v8::Context> context,
                          v8::Local<v8::Object> target);
void RegisterHttp3ExternalReferences(ExternalReferenceRegistry* registry);

// Header-set interface registered via lsquic_engine_api::ea_hsi_if.
// Defined in quic_http3_binding.cc. Always non-null; lsquic only uses
// it when the engine is in HTTP/3 mode.
extern const struct lsquic_hset_if kHsetIf;

// Apply a JS settings object onto an lsquic_engine_settings struct.
// Returns true on success; throws a v8 exception and returns false on
// invalid field type. Unknown keys are silently ignored (so JS can
// pass through future-proofing data without per-version breakage).
//
// Implementation lives in quic_settings_binding.cc; called from
// quic_binding.cc::CreateEngine.
bool ApplyJsSettings(v8::Isolate* isolate, v8::Local<v8::Context> context,
                     v8::Local<v8::Value> settings_arg,
                     lsquic_engine_settings* out);

// Cert-lookup trampoline registered via lsquic_engine_api::ea_lookup_cert.
// Returns the EngineSlot::ssl_ctx (single-SNI). NULL if no cert was set
// via setServerCertContext.
extern "C" struct ssl_ctx_st* LookupCertTrampoline(
    void* lsquic_cert_lookup_ctx, const struct sockaddr* local,
    const char* sni);

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_QUIC_QUIC_INTERNAL_H_
