// node:smol-quic HTTP/3 header send/recv (lsquic_hset_if + send_headers).
//
// Owns:
//   - kHsetIf — the lsquic_hset_if table that lsquic invokes during
//     QPACK decoding when an HTTP/3 stream receives a HEADERS frame.
//     Wired into lsquic_engine_api::ea_hsi_if in quic_binding.cc::
//     CreateEngine.
//
//   - HeaderSet POD — per-stream decoded-headers accumulator. Allocated
//     by create_header_set, filled by process_header, claimed by JS via
//     streamGetHeaders, freed by discard_header_set (or by the
//     streamGetHeaders fast-path).
//
//   - streamGetHeaders / streamSendHeaders JS methods — the surface
//     HTTP/3 servers + clients use to read request/response headers and
//     write them.
//
// QPACK semantics (from lsquic.h:1315-1377):
//
//   1. lsquic creates a header-set object via hsi_create_header_set when
//      a stream gets its first HEADERS frame. We return our HeaderSet*.
//
//   2. For each header, lsquic asks for an lsxpack_header buffer via
//      hsi_prepare_decode. We hand back a reusable lsxpack_header whose
//      `buf` points into our growable backing store. If lsquic needs
//      more space than we provided (hdr is non-null on the call), we
//      grow the buffer and return the same hdr.
//
//   3. lsquic decodes the header into our buffer + calls
//      hsi_process_header. We snapshot the name+value as
//      std::string and push onto the vector.
//
//   4. When stream reading is enabled (or the JS side calls
//      streamGetHeaders), lsquic_stream_get_hset transfers ownership
//      back to us. JS marshals the vector into a {name: value, ...}
//      object then frees the set.
//
//   5. If the stream errors before headers are claimed,
//      hsi_discard_header_set runs to free our pending allocation.
//
// Outbound (streamSendHeaders): JS passes
//   { ':status': '200', 'content-type': 'text/html', ... }
// We flatten into an lsxpack_header[] + a contiguous backing buffer,
// then call lsquic_stream_send_headers.
//
// Note on pseudo-headers: HTTP/3 requires `:method`, `:scheme`,
// `:authority`, `:path` for requests and `:status` for responses.
// The JS layer is responsible for ordering — we send headers in
// whatever order the JS object iterates (insertion order in V8).

#include "quic_internal.h"

#include "lsquic.h"
#include "lsxpack_header.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "env-inl.h"
#include "util.h"
#include "v8.h"

#include <cstdlib>
#include <cstring>
#include <memory>
#include <new>
#include <string>
#include <utility>
#include <vector>

namespace node {
namespace socketsecurity {
namespace quic {

using v8::Array;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::NewStringType;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

// Initial capacity of the per-stream header decode buffer. Most HTTP/3
// HEADERS frames stay well under 4 KB; we grow if needed.
constexpr size_t kInitialBufCapacity = 4096;

// Reusable lsxpack_header given back to lsquic per decode round. lsquic
// only reads it inside hsi_prepare_decode → hsi_process_header so it's
// safe to reuse across iterations of the same header set.
struct HeaderSet {
  // Decoded (name, value) pairs.
  std::vector<std::pair<std::string, std::string>> entries;
  // Backing buffer for the in-flight header being decoded.
  std::vector<char> buf;
  // The lsxpack_header lsquic writes into. Reset before each
  // hsi_prepare_decode return.
  lsxpack_header_t hdr{};
};

void* HsiCreateHeaderSet(void* /*hsi_ctx*/, lsquic_stream_t* /*stream*/,
                         int /*is_push_promise*/) {
  return new (std::nothrow) HeaderSet();
}

lsxpack_header_t* HsiPrepareDecode(void* hdr_set, lsxpack_header_t* hdr,
                                   size_t space) {
  auto* set = static_cast<HeaderSet*>(hdr_set);
  if (set == nullptr) {
    return nullptr;
  }
  // First call for this header (hdr == nullptr) or grow request
  // (hdr != nullptr, space > current capacity).
  size_t required = space < kInitialBufCapacity ? kInitialBufCapacity : space;
  if (set->buf.size() < required) {
    set->buf.assign(required, 0);
  }
  std::memset(&set->hdr, 0, sizeof(set->hdr));
  set->hdr.buf = set->buf.data();
  set->hdr.val_len = static_cast<lsxpack_strlen_t>(set->buf.size());
  return &set->hdr;
}

int HsiProcessHeader(void* hdr_set, lsxpack_header_t* hdr) {
  auto* set = static_cast<HeaderSet*>(hdr_set);
  if (set == nullptr) {
    return -1;
  }
  if (hdr == nullptr) {
    // End-of-headers signal — nothing to push.
    return 0;
  }
  // Defensive: name_len + val_len within buf.
  if (hdr->buf == nullptr) {
    return -1;
  }
  std::string name(hdr->buf + hdr->name_offset, hdr->name_len);
  std::string value(hdr->buf + hdr->val_offset, hdr->val_len);
  set->entries.emplace_back(std::move(name), std::move(value));
  return 0;
}

void HsiDiscardHeaderSet(void* hdr_set) {
  delete static_cast<HeaderSet*>(hdr_set);
}

}  // namespace

const lsquic_hset_if kHsetIf = {
    /* .hsi_create_header_set  = */ HsiCreateHeaderSet,
    /* .hsi_prepare_decode     = */ HsiPrepareDecode,
    /* .hsi_process_header     = */ HsiProcessHeader,
    /* .hsi_discard_header_set = */ HsiDiscardHeaderSet,
    /* .hsi_flags              = */ static_cast<enum lsquic_hsi_flag>(0),
};

namespace {

Local<String> NewOneByte(Isolate* isolate, const char* literal) {
  return String::NewFromOneByte(isolate,
                                reinterpret_cast<const uint8_t*>(literal),
                                NewStringType::kNormal,
                                static_cast<int>(std::strlen(literal)))
      .ToLocalChecked();
}

// streamGetHeaders(streamId) -> { name: value, ... } | null
//
// Claims the decoded header set for the stream. Returns null if no
// header set is available (the stream isn't HTTP/3, or HEADERS hasn't
// arrived yet, or it was already claimed). After this call, the
// caller owns the set — we delete it before returning the JS object.
void StreamGetHeaders(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_stream_t* stream = LookupStream(id);
  if (stream == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  void* raw = lsquic_stream_get_hset(stream);
  if (raw == nullptr) {
    args.GetReturnValue().SetNull();
    return;
  }
  std::unique_ptr<HeaderSet> set(static_cast<HeaderSet*>(raw));
  Local<Object> obj = Object::New(isolate);
  for (const auto& kv : set->entries) {
    Local<String> key =
        String::NewFromUtf8(isolate, kv.first.data(), NewStringType::kNormal,
                            static_cast<int>(kv.first.size()))
            .ToLocalChecked();
    Local<String> val =
        String::NewFromUtf8(isolate, kv.second.data(),
                            NewStringType::kNormal,
                            static_cast<int>(kv.second.size()))
            .ToLocalChecked();
    obj->Set(context, key, val).Check();
  }
  args.GetReturnValue().Set(obj);
}

// streamSendHeaders(streamId, headersObj, eos: bool) -> int
//
// Flatten the JS object into an lsxpack_header[] backed by a single
// contiguous buffer, then call lsquic_stream_send_headers. Returns
// the lsquic return value (0 on success, -1 on error). eos is
// ignored on IETF QUIC per lsquic.h.
void StreamSendHeaders(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  lsquic_stream_t* stream = LookupStream(id);
  if (stream == nullptr || !args[1]->IsObject()) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  Local<Object> obj = args[1].As<Object>();
  int eos = args[2]->BooleanValue(isolate) ? 1 : 0;

  MaybeLocal<Array> mnames = obj->GetOwnPropertyNames(context);
  Local<Array> names;
  if (!mnames.ToLocal(&names)) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  uint32_t n = names->Length();

  // Two passes: first measure to size the buffer, then fill.
  std::vector<std::pair<std::string, std::string>> kv;
  kv.reserve(n);
  size_t total = 0;
  for (uint32_t i = 0; i < n; ++i) {
    Local<Value> key_v;
    if (!names->Get(context, i).ToLocal(&key_v) || !key_v->IsString()) {
      args.GetReturnValue().Set(Integer::New(isolate, -1));
      return;
    }
    Local<Value> val_v;
    if (!obj->Get(context, key_v).ToLocal(&val_v) || !val_v->IsString()) {
      args.GetReturnValue().Set(Integer::New(isolate, -1));
      return;
    }
    String::Utf8Value key_utf8(isolate, key_v);
    String::Utf8Value val_utf8(isolate, val_v);
    if (*key_utf8 == nullptr || *val_utf8 == nullptr) {
      args.GetReturnValue().Set(Integer::New(isolate, -1));
      return;
    }
    size_t klen = static_cast<size_t>(key_utf8.length());
    size_t vlen = static_cast<size_t>(val_utf8.length());
    if (klen == 0 || klen > LSXPACK_MAX_STRLEN ||
        vlen > LSXPACK_MAX_STRLEN) {
      args.GetReturnValue().Set(Integer::New(isolate, -1));
      return;
    }
    kv.emplace_back(std::string(*key_utf8, klen), std::string(*val_utf8, vlen));
    total += klen + vlen;
  }

  // Allocate the backing buffer + lsxpack_header[] in one pass.
  // lsxpack_header points name_offset / val_offset into this buffer.
  std::vector<char> buf(total);
  std::vector<lsxpack_header_t> hdrs(kv.size());
  size_t off = 0;
  for (size_t i = 0; i < kv.size(); ++i) {
    lsxpack_header_t& h = hdrs[i];
    std::memset(&h, 0, sizeof(h));
    h.buf = buf.data();
    h.name_offset = static_cast<lsxpack_offset_t>(off);
    h.name_len = static_cast<lsxpack_strlen_t>(kv[i].first.size());
    std::memcpy(buf.data() + off, kv[i].first.data(), kv[i].first.size());
    off += kv[i].first.size();
    h.val_offset = static_cast<lsxpack_offset_t>(off);
    h.val_len = static_cast<lsxpack_strlen_t>(kv[i].second.size());
    std::memcpy(buf.data() + off, kv[i].second.data(), kv[i].second.size());
    off += kv[i].second.size();
  }

  lsquic_http_headers_t hl;
  hl.count = static_cast<int>(hdrs.size());
  hl.headers = hdrs.data();
  int r = lsquic_stream_send_headers(stream, &hl, eos);
  args.GetReturnValue().Set(Integer::New(isolate, r));
}

}  // namespace

void RegisterHttp3Methods(Local<Context> context, Local<Object> target) {
  SetMethod(context, target, "streamGetHeaders", StreamGetHeaders);
  SetMethod(context, target, "streamSendHeaders", StreamSendHeaders);
}

void RegisterHttp3ExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(StreamGetHeaders);
  registry->Register(StreamSendHeaders);
}

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node
