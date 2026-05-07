// node:smol-quic settings struct + server-side cert lookup.
//
// Owns:
//   - ApplyJsSettings — table-driven marshaler that copies JS object
//     fields into lsquic_engine_settings. Covers the ~30 most-tuned
//     settings (idle timeout, ping period, congestion control,
//     flow-control windows, ECN, DPLPMTUD, datagrams, QPACK, etc.).
//     Unknown JS keys are silently ignored so JS can pass forward-
//     compatible blobs.
//
//   - SetServerCertContext — JS method that builds an OpenSSL SSL_CTX
//     from PEM cert+key Uint8Arrays and stashes it on the EngineSlot.
//
//   - LookupCertTrampoline — lsquic_lookup_cert_f registered via
//     ea_lookup_cert. Single-SNI: returns the slot's ssl_ctx for any
//     SNI. Multi-SNI dispatch is a future refinement (would key by
//     hostname into a SNI→SSL_CTX map; current scope is "one cert,
//     one server").
//
// Split rationale: keeps quic_binding.cc under the 1000-line hard cap
// while putting server-config code together (settings + certs both
// configure the engine before lsquic_engine_new is called).
//
// OpenSSL: we use the BIO_new_mem_buf path so JS can pass PEM bytes
// directly without writing to disk. The SSL_CTX is held by the
// EngineSlot's ssl_ctx field and freed in destroyEngine.

#include "quic_internal.h"

#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/pem.h>
#include <openssl/ssl.h>
#include <openssl/x509.h>

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "env-inl.h"
#include "util.h"
#include "v8.h"

#include <cstddef>
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
using v8::Uint8Array;
using v8::Value;

namespace {

Local<String> NewOneByte(Isolate* isolate, const char* literal) {
  return String::NewFromOneByte(isolate,
                                reinterpret_cast<const uint8_t*>(literal),
                                NewStringType::kNormal,
                                static_cast<int>(std::strlen(literal)))
      .ToLocalChecked();
}

// ─── Settings marshaler ──────────────────────────────────────────────
//
// Driven by a static table of { js_name, c_offset, c_type } rows.
// The js_name is the camelCase JS key; offsetof targets the C field;
// the type tag picks the conversion at apply time.

enum class FieldType {
  kUnsigned,        // `unsigned` in C
  kUnsignedLong,    // `unsigned long`
  kInt,             // `int`
  kInt8,            // `int` field used as 0/1 boolean
  kUnsignedShort,   // `unsigned short`
};

struct SettingRow {
  const char* js_name;
  size_t offset;
  FieldType type;
};

// Most-commonly-tuned subset. Each row maps a camelCase JS key to a
// field on lsquic_engine_settings. The full struct has ~75 fields;
// this subset covers the ~30 settings users actually touch (the
// remainder are advanced tuning or deprecated). Extending this table
// is the documented path for niche settings.
#define LSQUIC_SETTING(name, c_field, type) \
  { name, offsetof(lsquic_engine_settings, c_field), type }

constexpr SettingRow kSettings[] = {
    // Versioning
    LSQUIC_SETTING("versions", es_versions, FieldType::kUnsigned),

    // Flow-control windows
    LSQUIC_SETTING("cfcw", es_cfcw, FieldType::kUnsigned),
    LSQUIC_SETTING("sfcw", es_sfcw, FieldType::kUnsigned),
    LSQUIC_SETTING("maxCfcw", es_max_cfcw, FieldType::kUnsigned),
    LSQUIC_SETTING("maxSfcw", es_max_sfcw, FieldType::kUnsigned),
    LSQUIC_SETTING("maxStreamsIn", es_max_streams_in, FieldType::kUnsigned),

    // Timeouts
    LSQUIC_SETTING("handshakeTo", es_handshake_to, FieldType::kUnsignedLong),
    LSQUIC_SETTING("idleConnTo", es_idle_conn_to, FieldType::kUnsignedLong),
    LSQUIC_SETTING("idleTimeout", es_idle_timeout, FieldType::kUnsigned),
    LSQUIC_SETTING("pingPeriod", es_ping_period, FieldType::kUnsigned),
    LSQUIC_SETTING("noprogressTimeout", es_noprogress_timeout,
                   FieldType::kUnsigned),
    LSQUIC_SETTING("silentClose", es_silent_close, FieldType::kInt8),

    // Headers / HTTP/3
    LSQUIC_SETTING("maxHeaderListSize", es_max_header_list_size,
                   FieldType::kUnsigned),

    // Initial transport params (RFC 9000)
    LSQUIC_SETTING("initMaxData", es_init_max_data, FieldType::kUnsigned),
    LSQUIC_SETTING("initMaxStreamDataBidiRemote",
                   es_init_max_stream_data_bidi_remote, FieldType::kUnsigned),
    LSQUIC_SETTING("initMaxStreamDataBidiLocal",
                   es_init_max_stream_data_bidi_local, FieldType::kUnsigned),
    LSQUIC_SETTING("initMaxStreamDataUni", es_init_max_stream_data_uni,
                   FieldType::kUnsigned),
    LSQUIC_SETTING("initMaxStreamsBidi", es_init_max_streams_bidi,
                   FieldType::kUnsigned),
    LSQUIC_SETTING("initMaxStreamsUni", es_init_max_streams_uni,
                   FieldType::kUnsigned),

    // Source connection ID
    LSQUIC_SETTING("scidLen", es_scid_len, FieldType::kUnsigned),
    LSQUIC_SETTING("scidIssRate", es_scid_iss_rate, FieldType::kUnsigned),

    // QPACK
    LSQUIC_SETTING("qpackDecMaxSize", es_qpack_dec_max_size,
                   FieldType::kUnsigned),
    LSQUIC_SETTING("qpackDecMaxBlocked", es_qpack_dec_max_blocked,
                   FieldType::kUnsigned),
    LSQUIC_SETTING("qpackEncMaxSize", es_qpack_enc_max_size,
                   FieldType::kUnsigned),
    LSQUIC_SETTING("qpackEncMaxBlocked", es_qpack_enc_max_blocked,
                   FieldType::kUnsigned),

    // Wire features
    LSQUIC_SETTING("ecn", es_ecn, FieldType::kInt8),
    LSQUIC_SETTING("allowMigration", es_allow_migration, FieldType::kInt8),
    LSQUIC_SETTING("qlBits", es_ql_bits, FieldType::kInt),
    LSQUIC_SETTING("spin", es_spin, FieldType::kInt8),
    LSQUIC_SETTING("delayedAcks", es_delayed_acks, FieldType::kInt8),
    LSQUIC_SETTING("timestamps", es_timestamps, FieldType::kInt8),
    LSQUIC_SETTING("greaseQuicBit", es_grease_quic_bit, FieldType::kInt8),

    // MTU / DPLPMTUD
    LSQUIC_SETTING("maxUdpPayloadSizeRx", es_max_udp_payload_size_rx,
                   FieldType::kUnsignedShort),
    LSQUIC_SETTING("dplpmtud", es_dplpmtud, FieldType::kInt8),
    LSQUIC_SETTING("basePlpmtu", es_base_plpmtu, FieldType::kUnsignedShort),
    LSQUIC_SETTING("maxPlpmtu", es_max_plpmtu, FieldType::kUnsignedShort),
    LSQUIC_SETTING("mtuProbeTimer", es_mtu_probe_timer, FieldType::kUnsigned),

    // Datagrams
    LSQUIC_SETTING("datagrams", es_datagrams, FieldType::kInt8),

    // Congestion control
    LSQUIC_SETTING("ccAlgo", es_cc_algo, FieldType::kUnsigned),
    LSQUIC_SETTING("ccRttThresh", es_cc_rtt_thresh, FieldType::kUnsigned),
    LSQUIC_SETTING("enableBwSampler", es_enable_bw_sampler, FieldType::kInt8),

    // Pacing
    LSQUIC_SETTING("pacePackets", es_pace_packets, FieldType::kInt8),
    LSQUIC_SETTING("clockGranularity", es_clock_granularity,
                   FieldType::kUnsigned),

    // Misc
    LSQUIC_SETTING("rwOnce", es_rw_once, FieldType::kInt8),
    LSQUIC_SETTING("procTimeThresh", es_proc_time_thresh, FieldType::kUnsigned),
    LSQUIC_SETTING("optimisticNat", es_optimistic_nat, FieldType::kInt8),
    LSQUIC_SETTING("extHttpPrio", es_ext_http_prio, FieldType::kInt8),
};

#undef LSQUIC_SETTING

bool SetField(Isolate* isolate, Local<Context> context, Local<Value> v,
              uint8_t* base, const SettingRow& row) {
  uint8_t* target = base + row.offset;
  switch (row.type) {
    case FieldType::kUnsigned: {
      uint32_t n = v->Uint32Value(context).FromMaybe(0);
      *reinterpret_cast<unsigned*>(target) = static_cast<unsigned>(n);
      return true;
    }
    case FieldType::kUnsignedLong: {
      // Accept Number; lsquic uses unsigned long for ms-scale timeouts.
      double d = v->NumberValue(context).FromMaybe(0.0);
      if (d < 0) d = 0;
      *reinterpret_cast<unsigned long*>(target) =
          static_cast<unsigned long>(d);
      return true;
    }
    case FieldType::kInt: {
      int32_t n = v->Int32Value(context).FromMaybe(0);
      *reinterpret_cast<int*>(target) = static_cast<int>(n);
      return true;
    }
    case FieldType::kInt8: {
      // Accept boolean or 0/1; lsquic uses `int` for these.
      int b = v->BooleanValue(isolate) ? 1 : 0;
      *reinterpret_cast<int*>(target) = b;
      return true;
    }
    case FieldType::kUnsignedShort: {
      uint32_t n = v->Uint32Value(context).FromMaybe(0);
      if (n > 0xffff) n = 0xffff;
      *reinterpret_cast<unsigned short*>(target) = static_cast<unsigned short>(n);
      return true;
    }
  }
  return false;
}

}  // namespace

bool ApplyJsSettings(Isolate* isolate, Local<Context> context,
                     Local<Value> settings_arg,
                     lsquic_engine_settings* out) {
  if (settings_arg.IsEmpty() || !settings_arg->IsObject()) {
    // No settings — leave defaults populated by lsquic_engine_init_settings.
    return true;
  }
  Local<Object> obj = settings_arg.As<Object>();
  uint8_t* base = reinterpret_cast<uint8_t*>(out);

  for (const SettingRow& row : kSettings) {
    Local<String> key = NewOneByte(isolate, row.js_name);
    if (!obj->Has(context, key).FromMaybe(false)) {
      continue;
    }
    MaybeLocal<Value> mv = obj->Get(context, key);
    Local<Value> v;
    if (!mv.ToLocal(&v) || v->IsNullOrUndefined()) {
      continue;
    }
    if (!SetField(isolate, context, v, base, row)) {
      return false;
    }
  }
  return true;
}

// ─── SSL_CTX cert lookup ─────────────────────────────────────────────

namespace {

// Build an SSL_CTX from PEM cert + PEM key blobs in memory. Returns
// nullptr on parse error; the caller is expected to have already
// validated the inputs are Uint8Array.
SSL_CTX* BuildSslCtx(const uint8_t* cert_pem, size_t cert_len,
                     const uint8_t* key_pem, size_t key_len) {
  SSL_CTX* ctx = SSL_CTX_new(TLS_method());
  if (ctx == nullptr) {
    return nullptr;
  }
  // lsquic requires TLS 1.3 for QUIC.
  SSL_CTX_set_min_proto_version(ctx, TLS1_3_VERSION);
  SSL_CTX_set_max_proto_version(ctx, TLS1_3_VERSION);

  BIO* cert_bio = BIO_new_mem_buf(cert_pem, static_cast<int>(cert_len));
  if (cert_bio == nullptr) {
    SSL_CTX_free(ctx);
    return nullptr;
  }
  X509* cert = PEM_read_bio_X509_AUX(cert_bio, nullptr, nullptr, nullptr);
  BIO_free(cert_bio);
  if (cert == nullptr) {
    SSL_CTX_free(ctx);
    return nullptr;
  }
  int rc = SSL_CTX_use_certificate(ctx, cert);
  X509_free(cert);
  if (rc != 1) {
    SSL_CTX_free(ctx);
    return nullptr;
  }

  BIO* key_bio = BIO_new_mem_buf(key_pem, static_cast<int>(key_len));
  if (key_bio == nullptr) {
    SSL_CTX_free(ctx);
    return nullptr;
  }
  EVP_PKEY* key = PEM_read_bio_PrivateKey(key_bio, nullptr, nullptr, nullptr);
  BIO_free(key_bio);
  if (key == nullptr) {
    SSL_CTX_free(ctx);
    return nullptr;
  }
  rc = SSL_CTX_use_PrivateKey(ctx, key);
  EVP_PKEY_free(key);
  if (rc != 1) {
    SSL_CTX_free(ctx);
    return nullptr;
  }
  if (SSL_CTX_check_private_key(ctx) != 1) {
    SSL_CTX_free(ctx);
    return nullptr;
  }
  return ctx;
}

void SetServerCertContext(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t engine_id = args[0]->Uint32Value(context).FromMaybe(0);

  if (!args[1]->IsUint8Array() || !args[2]->IsUint8Array()) {
    isolate->ThrowException(v8::Exception::TypeError(NewOneByte(
        isolate,
        "setServerCertContext(engineHandle, certPem, keyPem): "
        "certPem and keyPem must be Uint8Array")));
    return;
  }
  auto cert_arr = args[1].As<Uint8Array>();
  auto key_arr = args[2].As<Uint8Array>();
  auto cert_store = cert_arr->Buffer()->GetBackingStore();
  auto key_store = key_arr->Buffer()->GetBackingStore();
  const uint8_t* cert_pem =
      static_cast<const uint8_t*>(cert_store->Data()) + cert_arr->ByteOffset();
  const uint8_t* key_pem =
      static_cast<const uint8_t*>(key_store->Data()) + key_arr->ByteOffset();

  SSL_CTX* ctx = BuildSslCtx(cert_pem, cert_arr->ByteLength(), key_pem,
                             key_arr->ByteLength());
  if (ctx == nullptr) {
    isolate->ThrowException(v8::Exception::Error(NewOneByte(
        isolate,
        "setServerCertContext: failed to parse PEM cert or key "
        "(check that both are PEM-encoded and that the key matches the cert)")));
    return;
  }

  EngineRegistry& r = Engines();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.engines.find(engine_id);
  if (it == r.engines.end()) {
    SSL_CTX_free(ctx);
    isolate->ThrowException(v8::Exception::Error(NewOneByte(
        isolate, "setServerCertContext: unknown engineHandle")));
    return;
  }
  // Replace any prior cert context.
  if (it->second->ssl_ctx != nullptr) {
    SSL_CTX_free(it->second->ssl_ctx);
  }
  it->second->ssl_ctx = ctx;
  args.GetReturnValue().Set(Boolean::New(isolate, true));
}

}  // namespace

extern "C" struct ssl_ctx_st* LookupCertTrampoline(
    void* lsquic_cert_lookup_ctx, const struct sockaddr* /*local*/,
    const char* /*sni*/) {
  auto* slot = static_cast<EngineSlot*>(lsquic_cert_lookup_ctx);
  if (slot == nullptr) {
    return nullptr;
  }
  return slot->ssl_ctx;
}

void RegisterSettingsMethods(Local<Context> context, Local<Object> target) {
  SetMethod(context, target, "setServerCertContext", SetServerCertContext);
}

void RegisterSettingsExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(SetServerCertContext);
}

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node
