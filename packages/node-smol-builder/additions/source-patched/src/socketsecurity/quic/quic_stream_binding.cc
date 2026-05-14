// node:smol-quic stream + outbound callbacks.
//
// Owns:
//   - StreamRegistry — JS-handle ↔ lsquic_stream_t* map.
//   - Six lsquic_stream_if trampolines (on_new_conn, on_conn_closed,
//     on_new_stream, on_read, on_write, on_close) + on_hsk_done +
//     on_goaway_received.
//   - The packets_out trampoline (per-engine outbound batch).
//   - Six stream JS methods (streamRead, streamWrite, streamShutdown,
//     streamClose, streamWantRead, streamWantWrite).
//
// quic_binding.cc owns engine + connection lifecycle. Both files share
// EngineSlot / ConnSlot / StreamSlot via quic_internal.h. The split is
// purely about the 1000-line hard cap per .cc file.
//
// Trampoline invariants:
//
//   1. Every trampoline recovers the EngineSlot* from the lsquic context
//      pointer set during createEngine (ea_stream_if_ctx / ea_packets_out_ctx).
//   2. Each trampoline enters Isolate::Scope + HandleScope + Context::Scope
//      using the table captured at createEngine time.
//   3. Each trampoline runs under v8::TryCatch. A JS exception inside a
//      callback is delivered via TriggerUncaughtException; the trampoline
//      returns lsquic's "no-op" sentinel so wire processing continues.
//   4. Each trampoline toggles slot->in_callback to block reentrant
//      destroyEngine.
//
// Buffer marshaling:
//
//   - on_read / on_write deliver NO payload. The trampoline only signals
//     readiness. JS calls streamRead / streamWrite with its own
//     Uint8Array to actually move bytes. This keeps the dispatcher
//     zero-copy and avoids transient ArrayBuffer allocations per
//     byte-ready event (which can fire dozens of times per packet).
//
//   - packets_out materializes the lsquic_out_spec array as a JS array
//     of { peer: {addr, port}, iov: Uint8Array, ecn }. The Uint8Array
//     wraps lsquic's iov_base via NewBackingStore with EmptyDeleter —
//     zero-copy in the single-iov case. JS must consume the buffer
//     synchronously inside the callback (the memory is on lsquic's
//     send queue).
//
// Reference table:
//   lsquic.h ~ line 158  struct lsquic_stream_if
//   lsquic.h ~ line 1205 struct lsquic_out_spec
//   lsquic.h ~ line 1228 typedef lsquic_packets_out_f
//   node_sqlite.cc       Global<Function> + TryCatch pattern (Node 26)
//   cares_wrap.cc        per-request callback retention pattern

#include "quic_internal.h"

#include "node.h"
#include "node_binding.h"
#include "node_errors.h"
#include "node_external_reference.h"
#include "util.h"
#include "uv.h"
#include "v8.h"

#include <cstdio>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace quic {

using v8::ArrayBuffer;
using v8::BackingStore;
using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
using v8::Object;
using v8::String;
using v8::TryCatch;
using v8::Uint8Array;
using v8::Value;

// ─── StreamRegistry ──────────────────────────────────────────────────

StreamRegistry& Streams() {
  static StreamRegistry r;
  return r;
}

uint32_t RegisterStream(lsquic_stream_t* stream, uint32_t engine_id) {
  StreamRegistry& r = Streams();
  std::lock_guard<std::mutex> lock(r.mu);
  uint32_t id = r.next_id++;
  auto slot = std::make_unique<StreamSlot>();
  slot->stream = stream;
  slot->engine_id = engine_id;
  r.streams.emplace(id, std::move(slot));
  return id;
}

lsquic_stream_t* LookupStream(uint32_t id) {
  StreamRegistry& r = Streams();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.streams.find(id);
  return it == r.streams.end() ? nullptr : it->second->stream;
}

bool UnregisterStream(uint32_t id) {
  StreamRegistry& r = Streams();
  std::lock_guard<std::mutex> lock(r.mu);
  return r.streams.erase(id) > 0;
}

namespace {

Local<String> NewOneByte(Isolate* isolate, const char* literal) {
  return String::NewFromOneByte(isolate,
                                reinterpret_cast<const uint8_t*>(literal),
                                NewStringType::kNormal,
                                static_cast<int>(std::strlen(literal)))
      .ToLocalChecked();
}

// Recover the stream handle stored on a lsquic_stream_t. We cast a
// uintptr_t through lsquic_stream_ctx_t* — lsquic treats the pointer
// as opaque per its docs.
uint32_t StreamHandleOf(lsquic_stream_t* s) {
  lsquic_stream_ctx_t* ctx = lsquic_stream_get_ctx(s);
  return static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx));
}

uint32_t EngineIdForStream(uint32_t stream_id) {
  StreamRegistry& r = Streams();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.streams.find(stream_id);
  return it == r.streams.end() ? 0 : it->second->engine_id;
}

uint32_t EngineIdForConn(uint32_t conn_id) {
  ConnRegistry& r = Conns();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.conns.find(conn_id);
  return it == r.conns.end() ? 0 : it->second->engine_id;
}

// In-callback guard: set + clear slot->in_callback around the JS dispatch.
class InCallbackGuard {
 public:
  explicit InCallbackGuard(std::atomic<bool>* flag) : flag_(flag) {
    flag_->store(true, std::memory_order_release);
  }
  ~InCallbackGuard() { flag_->store(false, std::memory_order_release); }

 private:
  std::atomic<bool>* flag_;
};

// Run `fn` under TryCatch. On exception, deliver via TriggerUncaughtException
// and return false; *out_result is left untouched.
bool CallJs(Isolate* isolate, Local<Context> context,
            const v8::Global<Function>& fn, int argc, Local<Value> argv[],
            Local<Value>* out_result) {
  if (fn.IsEmpty()) {
    return false;
  }
  Local<Function> local = fn.Get(isolate);
  TryCatch try_catch(isolate);
  v8::MaybeLocal<Value> result =
      local->Call(context, v8::Undefined(isolate), argc, argv);
  if (try_catch.HasCaught()) {
    errors::TriggerUncaughtException(isolate, try_catch);
    return false;
  }
  return result.ToLocal(out_result);
}

void CallJsVoid(Isolate* isolate, Local<Context> context,
                const v8::Global<Function>& fn, int argc, Local<Value> argv[]) {
  Local<Value> ignored;
  CallJs(isolate, context, fn, argc, argv, &ignored);
}

// Build { addr: string, port: int, family: int } from a sockaddr*.
Local<Object> SockaddrToJs(Isolate* isolate, Local<Context> context,
                           const struct sockaddr* sa) {
  Local<Object> obj = Object::New(isolate);
  if (sa == nullptr) {
    return obj;
  }
  char addr_buf[INET6_ADDRSTRLEN];
  addr_buf[0] = '\0';
  int port = 0;
  if (sa->sa_family == AF_INET) {
    auto* sin = reinterpret_cast<const struct sockaddr_in*>(sa);
    uv_inet_ntop(AF_INET, &sin->sin_addr, addr_buf, sizeof(addr_buf));
    port = ntohs(sin->sin_port);
  } else if (sa->sa_family == AF_INET6) {
    auto* sin6 = reinterpret_cast<const struct sockaddr_in6*>(sa);
    uv_inet_ntop(AF_INET6, &sin6->sin6_addr, addr_buf, sizeof(addr_buf));
    port = ntohs(sin6->sin6_port);
  }
  obj->Set(context, NewOneByte(isolate, "family"),
           Integer::New(isolate, sa->sa_family))
      .Check();
  obj->Set(context, NewOneByte(isolate, "addr"),
           String::NewFromUtf8(isolate, addr_buf).ToLocalChecked())
      .Check();
  obj->Set(context, NewOneByte(isolate, "port"), Integer::New(isolate, port))
      .Check();
  return obj;
}

// Pointer-to-member-of-member into JsCallbackTable. Used by the
// stream readiness dispatcher so on_read / on_write / on_close share
// a single implementation parameterized by which callback to fire.
using CallbackFieldPtr = v8::Global<Function> JsCallbackTable::*;

void DispatchStreamReadiness(lsquic_stream_t* s, CallbackFieldPtr field) {
  uint32_t stream_id = StreamHandleOf(s);
  uint32_t engine_id = EngineIdForStream(stream_id);
  EngineSlot* slot = LookupEngineSlot(engine_id);
  if (slot == nullptr || (slot->cb.*field).IsEmpty()) {
    return;
  }
  Isolate* isolate = slot->cb.isolate;
  Isolate::Scope iso_scope(isolate);
  HandleScope handle_scope(isolate);
  Local<Context> context = slot->cb.context.Get(isolate);
  Context::Scope context_scope(context);
  InCallbackGuard guard(&slot->in_callback);
  Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, stream_id)};
  CallJsVoid(isolate, context, slot->cb.*field, 1, argv);
}

}  // namespace

// ─── packets_out trampoline ──────────────────────────────────────────

extern "C" int PacketsOutTrampoline(void* packets_out_ctx,
                                    const struct lsquic_out_spec* specs,
                                    unsigned count) {
  auto* slot = static_cast<EngineSlot*>(packets_out_ctx);
  if (slot == nullptr || slot->cb.packets_out.IsEmpty()) {
    // No JS handler — tell lsquic everything was sent so it doesn't
    // accumulate retransmit pressure on a dead engine.
    return static_cast<int>(count);
  }
  Isolate* isolate = slot->cb.isolate;
  Isolate::Scope iso_scope(isolate);
  HandleScope handle_scope(isolate);
  Local<Context> context = slot->cb.context.Get(isolate);
  Context::Scope context_scope(context);
  InCallbackGuard guard(&slot->in_callback);

  Local<v8::Array> arr = v8::Array::New(isolate, static_cast<int>(count));
  for (unsigned i = 0; i < count; ++i) {
    const lsquic_out_spec& s = specs[i];
    Local<Object> entry = Object::New(isolate);
    entry->Set(context, NewOneByte(isolate, "local"),
               SockaddrToJs(isolate, context, s.local_sa))
        .Check();
    entry->Set(context, NewOneByte(isolate, "peer"),
               SockaddrToJs(isolate, context, s.dest_sa))
        .Check();
    entry->Set(context, NewOneByte(isolate, "ecn"),
               Integer::New(isolate, s.ecn))
        .Check();
    if (s.iovlen == 1) {
      // Zero-copy: wrap lsquic's iov_base in an ArrayBuffer with an
      // empty deleter (lsquic owns the memory; JS must consume
      // synchronously inside this call).
      std::unique_ptr<BackingStore> bs = ArrayBuffer::NewBackingStore(
          s.iov[0].iov_base, s.iov[0].iov_len, BackingStore::EmptyDeleter,
          nullptr);
      Local<ArrayBuffer> buf = ArrayBuffer::New(isolate, std::move(bs));
      Local<Uint8Array> view = Uint8Array::New(buf, 0, s.iov[0].iov_len);
      entry->Set(context, NewOneByte(isolate, "iov"), view).Check();
    } else {
      size_t total = 0;
      for (size_t j = 0; j < s.iovlen; ++j) {
        total += s.iov[j].iov_len;
      }
      std::unique_ptr<BackingStore> bs =
          ArrayBuffer::NewBackingStore(isolate, total);
      uint8_t* dst = static_cast<uint8_t*>(bs->Data());
      size_t off = 0;
      for (size_t j = 0; j < s.iovlen; ++j) {
        std::memcpy(dst + off, s.iov[j].iov_base, s.iov[j].iov_len);
        off += s.iov[j].iov_len;
      }
      Local<ArrayBuffer> buf = ArrayBuffer::New(isolate, std::move(bs));
      Local<Uint8Array> view = Uint8Array::New(buf, 0, total);
      entry->Set(context, NewOneByte(isolate, "iov"), view).Check();
    }
    arr->Set(context, i, entry).Check();
  }

  Local<Value> argv[] = {arr};
  Local<Value> result;
  if (!CallJs(isolate, context, slot->cb.packets_out, 1, argv, &result)) {
    return static_cast<int>(count);
  }
  int32_t sent =
      result->Int32Value(context).FromMaybe(static_cast<int32_t>(count));
  if (sent < 0) {
    sent = -1;
  } else if (static_cast<unsigned>(sent) > count) {
    sent = static_cast<int>(count);
  }
  return sent;
}

// ─── stream_if trampolines ───────────────────────────────────────────

extern "C" lsquic_conn_ctx_t* OnNewConnTrampoline(void* stream_if_ctx,
                                                  lsquic_conn_t* c) {
  auto* slot = static_cast<EngineSlot*>(stream_if_ctx);
  if (slot == nullptr) {
    return nullptr;
  }
  uint32_t conn_id = RegisterConn(c, slot->engine_id);
  if (!slot->cb.on_new_conn.IsEmpty()) {
    Isolate* isolate = slot->cb.isolate;
    Isolate::Scope iso_scope(isolate);
    HandleScope handle_scope(isolate);
    Local<Context> context = slot->cb.context.Get(isolate);
    Context::Scope context_scope(context);
    InCallbackGuard guard(&slot->in_callback);
    Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, conn_id)};
    CallJsVoid(isolate, context, slot->cb.on_new_conn, 1, argv);
  }
  return reinterpret_cast<lsquic_conn_ctx_t*>(static_cast<uintptr_t>(conn_id));
}

extern "C" void OnConnClosedTrampoline(lsquic_conn_t* c) {
  lsquic_conn_ctx_t* ctx = lsquic_conn_get_ctx(c);
  uint32_t conn_id = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx));
  EngineSlot* slot = LookupEngineSlot(EngineIdForConn(conn_id));
  if (slot != nullptr && !slot->cb.on_conn_closed.IsEmpty()) {
    Isolate* isolate = slot->cb.isolate;
    Isolate::Scope iso_scope(isolate);
    HandleScope handle_scope(isolate);
    Local<Context> context = slot->cb.context.Get(isolate);
    Context::Scope context_scope(context);
    InCallbackGuard guard(&slot->in_callback);
    Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, conn_id)};
    CallJsVoid(isolate, context, slot->cb.on_conn_closed, 1, argv);
  }
  UnregisterConn(conn_id);
}

extern "C" lsquic_stream_ctx_t* OnNewStreamTrampoline(void* stream_if_ctx,
                                                      lsquic_stream_t* s) {
  auto* slot = static_cast<EngineSlot*>(stream_if_ctx);
  if (slot == nullptr) {
    return nullptr;
  }
  uint32_t stream_id = RegisterStream(s, slot->engine_id);
  // Stamp the stream's per-stream ctx with the JS handle so on_read /
  // on_write / on_close can recover it without a registry walk.
  lsquic_stream_set_ctx(s, reinterpret_cast<lsquic_stream_ctx_t*>(
                              static_cast<uintptr_t>(stream_id)));
  if (!slot->cb.on_new_stream.IsEmpty()) {
    Isolate* isolate = slot->cb.isolate;
    Isolate::Scope iso_scope(isolate);
    HandleScope handle_scope(isolate);
    Local<Context> context = slot->cb.context.Get(isolate);
    Context::Scope context_scope(context);
    InCallbackGuard guard(&slot->in_callback);
    Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, stream_id)};
    CallJsVoid(isolate, context, slot->cb.on_new_stream, 1, argv);
  }
  return reinterpret_cast<lsquic_stream_ctx_t*>(
      static_cast<uintptr_t>(stream_id));
}

extern "C" void OnReadTrampoline(lsquic_stream_t* s, lsquic_stream_ctx_t*) {
  DispatchStreamReadiness(s, &JsCallbackTable::on_read);
}

extern "C" void OnWriteTrampoline(lsquic_stream_t* s, lsquic_stream_ctx_t*) {
  DispatchStreamReadiness(s, &JsCallbackTable::on_write);
}

extern "C" void OnCloseTrampoline(lsquic_stream_t* s, lsquic_stream_ctx_t*) {
  // Fire on_close first (with the stream still live in our registry),
  // then unregister.
  uint32_t stream_id = StreamHandleOf(s);
  DispatchStreamReadiness(s, &JsCallbackTable::on_close);
  UnregisterStream(stream_id);
}

extern "C" void OnHskDoneTrampoline(lsquic_conn_t* c,
                                    enum lsquic_hsk_status status) {
  lsquic_conn_ctx_t* ctx = lsquic_conn_get_ctx(c);
  uint32_t conn_id = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx));
  EngineSlot* slot = LookupEngineSlot(EngineIdForConn(conn_id));
  if (slot == nullptr || slot->cb.on_hsk_done.IsEmpty()) {
    return;
  }
  Isolate* isolate = slot->cb.isolate;
  Isolate::Scope iso_scope(isolate);
  HandleScope handle_scope(isolate);
  Local<Context> context = slot->cb.context.Get(isolate);
  Context::Scope context_scope(context);
  InCallbackGuard guard(&slot->in_callback);
  Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, conn_id),
                         Integer::New(isolate, static_cast<int>(status))};
  CallJsVoid(isolate, context, slot->cb.on_hsk_done, 2, argv);
}

extern "C" void OnGoawayReceivedTrampoline(lsquic_conn_t* c) {
  lsquic_conn_ctx_t* ctx = lsquic_conn_get_ctx(c);
  uint32_t conn_id = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx));
  EngineSlot* slot = LookupEngineSlot(EngineIdForConn(conn_id));
  if (slot == nullptr || slot->cb.on_goaway_received.IsEmpty()) {
    return;
  }
  Isolate* isolate = slot->cb.isolate;
  Isolate::Scope iso_scope(isolate);
  HandleScope handle_scope(isolate);
  Local<Context> context = slot->cb.context.Get(isolate);
  Context::Scope context_scope(context);
  InCallbackGuard guard(&slot->in_callback);
  Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, conn_id)};
  CallJsVoid(isolate, context, slot->cb.on_goaway_received, 1, argv);
}

// ─── Datagram trampolines (step 7) ───────────────────────────────────
//
// on_dg_write fires when there's room for an outbound datagram. We
// dispatch to JS as `onDatagramWrite(connId, maxBytes)` which returns
// a Uint8Array (the bytes to send) or null/undefined (nothing to send
// right now). The trampoline copies into lsquic's buffer and returns
// the byte count.
//
// on_datagram fires with an inbound datagram payload. We zero-copy
// wrap lsquic's buffer in a Uint8Array (EmptyDeleter — JS must
// consume synchronously) and dispatch `onDatagram(connId, data)`.

extern "C" ssize_t OnDatagramWriteTrampoline(lsquic_conn_t* c, void* buf,
                                              size_t sz) {
  lsquic_conn_ctx_t* ctx = lsquic_conn_get_ctx(c);
  uint32_t conn_id = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx));
  EngineSlot* slot = LookupEngineSlot(EngineIdForConn(conn_id));
  if (slot == nullptr || slot->cb.on_datagram_write.IsEmpty()) {
    return -1;
  }
  Isolate* isolate = slot->cb.isolate;
  Isolate::Scope iso_scope(isolate);
  HandleScope handle_scope(isolate);
  Local<Context> context = slot->cb.context.Get(isolate);
  Context::Scope context_scope(context);
  InCallbackGuard guard(&slot->in_callback);
  Local<Value> argv[] = {
      Integer::NewFromUnsigned(isolate, conn_id),
      Integer::New(isolate, static_cast<int32_t>(sz)),
  };
  Local<Value> result;
  if (!CallJs(isolate, context, slot->cb.on_datagram_write, 2, argv,
              &result)) {
    return -1;
  }
  if (!result->IsUint8Array()) {
    // JS returned null/undefined — no datagram ready right now.
    return -1;
  }
  auto arr = result.As<Uint8Array>();
  size_t len = arr->ByteLength();
  if (len > sz) {
    len = sz;
  }
  auto store = arr->Buffer()->GetBackingStore();
  std::memcpy(buf,
              static_cast<const uint8_t*>(store->Data()) + arr->ByteOffset(),
              len);
  return static_cast<ssize_t>(len);
}

extern "C" void OnDatagramTrampoline(lsquic_conn_t* c, const void* buf,
                                     size_t sz) {
  lsquic_conn_ctx_t* ctx = lsquic_conn_get_ctx(c);
  uint32_t conn_id = static_cast<uint32_t>(reinterpret_cast<uintptr_t>(ctx));
  EngineSlot* slot = LookupEngineSlot(EngineIdForConn(conn_id));
  if (slot == nullptr || slot->cb.on_datagram.IsEmpty()) {
    return;
  }
  Isolate* isolate = slot->cb.isolate;
  Isolate::Scope iso_scope(isolate);
  HandleScope handle_scope(isolate);
  Local<Context> context = slot->cb.context.Get(isolate);
  Context::Scope context_scope(context);
  InCallbackGuard guard(&slot->in_callback);
  // Zero-copy wrap the payload — JS must consume synchronously.
  std::unique_ptr<BackingStore> bs = ArrayBuffer::NewBackingStore(
      const_cast<void*>(buf), sz, BackingStore::EmptyDeleter, nullptr);
  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, std::move(bs));
  Local<Uint8Array> view = Uint8Array::New(ab, 0, sz);
  Local<Value> argv[] = {Integer::NewFromUnsigned(isolate, conn_id), view};
  CallJsVoid(isolate, context, slot->cb.on_datagram, 2, argv);
}

// ─── kStreamIf static instance ───────────────────────────────────────
//
// quic_binding.cc passes &kStreamIf to lsquic_engine_api.ea_stream_if
// at createEngine time. Function pointers must match the lsquic_stream_if
// signatures byte-for-byte; see lsquic.h ~line 163.

const lsquic_stream_if kStreamIf = {
    /* .on_new_conn         = */ OnNewConnTrampoline,
    /* .on_goaway_received  = */ OnGoawayReceivedTrampoline,
    /* .on_conn_closed      = */ OnConnClosedTrampoline,
    /* .on_new_stream       = */ OnNewStreamTrampoline,
    /* .on_read             = */ OnReadTrampoline,
    /* .on_write            = */ OnWriteTrampoline,
    /* .on_close            = */ OnCloseTrampoline,
    /* .on_dg_write         = */ OnDatagramWriteTrampoline,
    /* .on_datagram         = */ OnDatagramTrampoline,
    /* .on_hsk_done         = */ OnHskDoneTrampoline,
    /* .on_new_token        = */ nullptr,
    /* .on_sess_resume_info = */ nullptr,
    /* .on_reset            = */ nullptr,
    /* .on_conncloseframe_received = */ nullptr,
};

// ─── Stream JS methods ───────────────────────────────────────────────
//
// All six methods accept a stream handle as args[0] and look up the
// underlying lsquic_stream_t* via the registry. Returns:
//   - streamRead  / streamWrite      : int (bytes; -1 on error; 0 on EOF/blocked)
//   - streamShutdown / streamClose   : int (lsquic return; 0 ok, < 0 err)
//   - streamWantRead / streamWantWrite: int (previous want flag from lsquic)

namespace {

lsquic_stream_t* StreamFromArgs(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  return LookupStream(id);
}

void StreamRead(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  lsquic_stream_t* s = StreamFromArgs(args);
  if (s == nullptr || !args[1]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  auto arr = args[1].As<Uint8Array>();
  auto store = arr->Buffer()->GetBackingStore();
  void* dst = static_cast<uint8_t*>(store->Data()) + arr->ByteOffset();
  ssize_t r = lsquic_stream_read(s, dst, arr->ByteLength());
  args.GetReturnValue().Set(Integer::New(isolate, static_cast<int32_t>(r)));
}

void StreamWrite(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  lsquic_stream_t* s = StreamFromArgs(args);
  if (s == nullptr || !args[1]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  auto arr = args[1].As<Uint8Array>();
  auto store = arr->Buffer()->GetBackingStore();
  const void* src =
      static_cast<const uint8_t*>(store->Data()) + arr->ByteOffset();
  ssize_t r = lsquic_stream_write(s, src, arr->ByteLength());
  args.GetReturnValue().Set(Integer::New(isolate, static_cast<int32_t>(r)));
}

void StreamShutdown(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_stream_t* s = StreamFromArgs(args);
  if (s == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  int how = args[1]->Int32Value(context).FromMaybe(2);
  args.GetReturnValue().Set(
      Integer::New(isolate, lsquic_stream_shutdown(s, how)));
}

void StreamClose(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  lsquic_stream_t* s = StreamFromArgs(args);
  if (s == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  args.GetReturnValue().Set(Integer::New(isolate, lsquic_stream_close(s)));
}

void StreamWantRead(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  lsquic_stream_t* s = StreamFromArgs(args);
  if (s == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  int want = args[1]->BooleanValue(isolate) ? 1 : 0;
  args.GetReturnValue().Set(
      Integer::New(isolate, lsquic_stream_wantread(s, want)));
}

void StreamWantWrite(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  lsquic_stream_t* s = StreamFromArgs(args);
  if (s == nullptr) {
    args.GetReturnValue().Set(Integer::New(isolate, -1));
    return;
  }
  int want = args[1]->BooleanValue(isolate) ? 1 : 0;
  args.GetReturnValue().Set(
      Integer::New(isolate, lsquic_stream_wantwrite(s, want)));
}

}  // namespace

void RegisterStreamMethods(Local<Context> context, Local<Object> target) {
  SetMethod(context, target, "streamRead", StreamRead);
  SetMethod(context, target, "streamWrite", StreamWrite);
  SetMethod(context, target, "streamShutdown", StreamShutdown);
  SetMethod(context, target, "streamClose", StreamClose);
  SetMethod(context, target, "streamWantRead", StreamWantRead);
  SetMethod(context, target, "streamWantWrite", StreamWantWrite);
}

void RegisterStreamExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(StreamRead);
  registry->Register(StreamWrite);
  registry->Register(StreamShutdown);
  registry->Register(StreamClose);
  registry->Register(StreamWantRead);
  registry->Register(StreamWantWrite);
}

}  // namespace quic
}  // namespace socketsecurity
}  // namespace node
