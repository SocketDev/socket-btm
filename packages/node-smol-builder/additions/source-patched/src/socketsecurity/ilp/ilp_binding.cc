// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// ============================================================================
// ilp_binding.cc -- ILP V8 binding implementation
// ============================================================================
//
// WHAT THIS FILE DOES
//   Implements the C++ functions that JavaScript calls through
//   `internalBinding('smol_ilp')`.  Each function (CreateSender, Table,
//   Symbol, FloatColumn, Flush, etc.) validates its JS arguments,
//   converts them to C++ types, and delegates to IlpEncoder or
//   IlpTransport.
//
// WHY IT EXISTS (C++ instead of pure JS)
//   Hot-path column methods like boolColumn and floatColumn use the
//   V8 Fast API (see FastBoolColumn / FastFloatColumn below), which lets
//   V8 call C++ directly without creating JS stack frames or V8 handles.
//   This makes tight loops (thousands of rows) significantly faster.
//
// HOW JAVASCRIPT USES THIS
//   `internalBinding('smol_ilp')` returns the `target` object populated
//   by Initialize().  The Sender class in
//   lib/internal/socketsecurity/ilp.js calls these methods by ID:
//     binding().createSender(opts) => returns a uint32 sender ID
//     binding().table(id, name)
//     binding().floatColumn(id, name, value)  // fast-API path
//     binding().flush(id) => sends buffered data over TCP
//
// THE "SENDER" PATTERN
//   JS never holds a C++ pointer directly (that would be unsafe).
//   Instead, createSender returns a numeric ID. Every subsequent call
//   passes that ID, and GetSender() looks it up in a static hash map.
//   This is the same pattern Node.js uses for file descriptors.
//
// V8 FAST API
//   V8 Fast API lets frequently-called functions bypass the normal
//   FunctionCallbackInfo overhead.  Two functions use it here:
//     FastBoolColumn  -- receives (sender_id, name, bool_value) directly
//     FastFloatColumn -- receives (sender_id, name, double_value) directly
//   If the fast path cannot handle the call (e.g. sender not found), it
//   sets options.fallback = true and V8 retries via the slow path
//   (SlowBoolColumn / SlowFloatColumn).
//
// KEY V8/C++ CONCEPTS
//   Isolate*          -- A single V8 JS engine instance (one per thread).
//   HandleScope       -- A RAII guard that releases V8 object handles when
//                        it goes out of scope (prevents memory leaks).
//   Local<T>          -- A stack-scoped handle to a V8 heap object
//                        (like String, Object, etc.).  Only valid inside
//                        the current HandleScope.
//   FunctionCallbackInfo<Value>& args
//                      -- Contains the JS arguments and return-value slot.
//   SetMethod()       -- Registers a C++ function as a JS method on an
//                        object (target).
//   SetFastMethod()   -- Like SetMethod but also registers a Fast API
//                        overload.
// ============================================================================

#include "socketsecurity/ilp/ilp_binding.h"
#include "env-inl.h"
#include "node_debug.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "util-inl.h"
#include "v8-fast-api-calls.h"

namespace node {
namespace socketsecurity {
namespace ilp {

using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Uint32;
using v8::Value;
using v8::CFunction;
using v8::FastApiCallbackOptions;
using v8::FastOneByteString;

// Thread-local member definitions — each Worker thread gets its own sender map.
thread_local std::unordered_map<uint32_t, std::unique_ptr<IlpBinding::SenderState>> IlpBinding::senders_;
thread_local uint32_t IlpBinding::next_sender_id_ = 1;

// ============================================================================
// V8 Fast API paths for boolColumn and floatColumn
// ============================================================================

static void FastBoolColumn(Local<Value> receiver,
                           uint32_t sender_id,
                           const FastOneByteString& name,
                           bool value,
                           // NOLINTNEXTLINE(runtime/references)
                           FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ilp.boolColumn");
  IlpBinding::SenderState* state = IlpBinding::GetSender(sender_id);
  if (state == nullptr) {
    options.fallback = true;
    return;
  }
  state->encoder->BoolColumn(name.data, name.length, value);
}

static CFunction cf_fast_bool_column(CFunction::Make(FastBoolColumn));

static void FastFloatColumn(Local<Value> receiver,
                            uint32_t sender_id,
                            const FastOneByteString& name,
                            double value,
                            // NOLINTNEXTLINE(runtime/references)
                            FastApiCallbackOptions& options) {
  TRACK_V8_FAST_API_CALL("smol_ilp.floatColumn");
  IlpBinding::SenderState* state = IlpBinding::GetSender(sender_id);
  if (state == nullptr) {
    options.fallback = true;
    return;
  }
  state->encoder->FloatColumn(name.data, name.length, value);
}

static CFunction cf_fast_float_column(CFunction::Make(FastFloatColumn));

void IlpBinding::Initialize(
    Local<Context> context,
    Local<Object> target,
    Environment* env) {
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  // Sender lifecycle.
  SetMethod(context, target, "createSender", CreateSender);
  SetMethod(context, target, "destroySender", DestroySender);
  SetMethod(context, target, "connect", Connect);
  SetMethod(context, target, "close", Close);

  // Row building.
  SetMethod(context, target, "table", Table);
  SetMethod(context, target, "symbol", Symbol);
  SetMethod(context, target, "stringColumn", StringColumn);
  SetFastMethod(context, target, "boolColumn", SlowBoolColumn, &cf_fast_bool_column);
  SetMethod(context, target, "intColumn", IntColumn);
  SetFastMethod(context, target, "floatColumn", SlowFloatColumn, &cf_fast_float_column);
  SetMethod(context, target, "timestampColumn", TimestampColumn);

  // Row termination.
  SetMethod(context, target, "at", At);
  SetMethod(context, target, "atNow", AtNow);

  // Flush and stats.
  SetMethod(context, target, "flush", Flush);
  SetMethod(context, target, "getStats", GetStats);
  SetMethod(context, target, "clear", Clear);
}

IlpBinding::SenderState* IlpBinding::GetSender(uint32_t id) {
  auto it = senders_.find(id);
  if (it == senders_.end()) {
    return nullptr;
  }
  return it->second.get();
}

TimestampUnit IlpBinding::ParseTimestampUnit(Isolate* isolate, Local<Value> val) {
  if (!val->IsString()) {
    return TimestampUnit::kNanoseconds;
  }

  String::Utf8Value unit(isolate, val);
  if (strcmp(*unit, "us") == 0 || strcmp(*unit, "micro") == 0) {
    return TimestampUnit::kMicroseconds;
  }
  if (strcmp(*unit, "ms") == 0 || strcmp(*unit, "milli") == 0) {
    return TimestampUnit::kMilliseconds;
  }
  if (strcmp(*unit, "s") == 0 || strcmp(*unit, "sec") == 0) {
    return TimestampUnit::kSeconds;
  }
  return TimestampUnit::kNanoseconds;
}

void IlpBinding::CreateSender(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  TransportConfig config;
  size_t encoder_max_size = 104857600;  // 100MB default

  if (args.Length() >= 1 && args[0]->IsObject()) {
    Local<Object> opts = args[0].As<Object>();

    Local<Value> host_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "host"))
        .ToLocal(&host_val) && host_val->IsString()) {
      String::Utf8Value utf8(isolate, host_val);
      config.host = *utf8;
    }

    Local<Value> port_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "port"))
        .ToLocal(&port_val) && port_val->IsNumber()) {
      config.port = static_cast<uint16_t>(port_val->Uint32Value(context).FromMaybe(9009));
    }

    Local<Value> timeout_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "connectTimeoutMs"))
        .ToLocal(&timeout_val) && timeout_val->IsNumber()) {
      config.connect_timeout_ms = static_cast<int>(
        timeout_val->Int32Value(context).FromMaybe(10000));
    }

    Local<Value> send_timeout_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "sendTimeoutMs"))
        .ToLocal(&send_timeout_val) && send_timeout_val->IsNumber()) {
      config.send_timeout_ms = static_cast<int>(
        send_timeout_val->Int32Value(context).FromMaybe(30000));
    }

    Local<Value> buf_size_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "bufferSize"))
        .ToLocal(&buf_size_val) && buf_size_val->IsNumber()) {
      config.send_buffer_size = static_cast<size_t>(
        buf_size_val->Uint32Value(context).FromMaybe(65536));
    }

    Local<Value> use_uring_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "useIoUring"))
        .ToLocal(&use_uring_val) && use_uring_val->IsBoolean()) {
      config.use_io_uring = use_uring_val->BooleanValue(isolate);
    }

    Local<Value> max_buf_val;
    if (opts->Get(context, FIXED_ONE_BYTE_STRING(isolate, "maxBufferSize"))
        .ToLocal(&max_buf_val) && max_buf_val->IsNumber()) {
      encoder_max_size = static_cast<size_t>(
        max_buf_val->IntegerValue(context).FromMaybe(104857600));
    }
  }

  auto state = std::make_unique<SenderState>();
  state->encoder = std::make_unique<IlpEncoder>(config.send_buffer_size, encoder_max_size);
  state->transport = std::make_unique<IlpTransport>(config);

  uint32_t id = next_sender_id_++;
  senders_[id] = std::move(state);

  args.GetReturnValue().Set(Uint32::New(isolate, id));
}

void IlpBinding::DestroySender(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsUint32()) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = senders_.find(id);
  if (it != senders_.end()) {
    it->second->transport->Close();
    senders_.erase(it);
    args.GetReturnValue().Set(Boolean::New(isolate, true));
  } else {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
  }
}

void IlpBinding::Connect(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  bool success = state->transport->Connect();
  if (!success) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, state->transport->LastError()).ToLocalChecked()));
    return;
  }

  args.GetReturnValue().Set(Boolean::New(isolate, true));
}

void IlpBinding::Close(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state != nullptr) {
    state->transport->Close();
  }
}

void IlpBinding::Table(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  state->encoder->Table(*name, name.length());
}

void IlpBinding::Symbol(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  String::Utf8Value value(isolate, args[2]);
  state->encoder->Symbol(*name, name.length(), *value, value.length());
}

void IlpBinding::StringColumn(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  String::Utf8Value value(isolate, args[2]);
  state->encoder->StringColumn(*name, name.length(), *value, value.length());
}

void IlpBinding::SlowBoolColumn(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  bool value = args[2]->BooleanValue(isolate);
  state->encoder->BoolColumn(*name, name.length(), value);
}


void IlpBinding::IntColumn(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  int64_t value;
  if (args[2]->IsBigInt()) {
    bool lossless;
    value = args[2].As<v8::BigInt>()->Int64Value(&lossless);
    if (!lossless) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "BigInt value does not fit in int64").ToLocalChecked()));
      return;
    }
  } else {
    value = static_cast<int64_t>(args[2]->IntegerValue(context).FromMaybe(0));
  }
  state->encoder->IntColumn(*name, name.length(), value);
}

void IlpBinding::SlowFloatColumn(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  double value = args[2]->NumberValue(context).FromMaybe(0.0);
  state->encoder->FloatColumn(*name, name.length(), value);
}


void IlpBinding::TimestampColumn(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  int64_t value;
  if (args[2]->IsBigInt()) {
    bool lossless;
    value = args[2].As<v8::BigInt>()->Int64Value(&lossless);
    if (!lossless) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "BigInt value does not fit in int64").ToLocalChecked()));
      return;
    }
  } else {
    value = static_cast<int64_t>(args[2]->IntegerValue(context).FromMaybe(0));
  }

  TimestampUnit unit = TimestampUnit::kMicroseconds;
  if (args.Length() >= 4) {
    unit = ParseTimestampUnit(isolate, args[3]);
  }

  state->encoder->TimestampColumn(*name, name.length(), value, unit);
}

void IlpBinding::At(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  int64_t timestamp;
  if (args[1]->IsBigInt()) {
    bool lossless;
    timestamp = args[1].As<v8::BigInt>()->Int64Value(&lossless);
    if (!lossless) {
      isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate, "BigInt timestamp does not fit in int64").ToLocalChecked()));
      return;
    }
  } else {
    timestamp = static_cast<int64_t>(args[1]->IntegerValue(context).FromMaybe(0));
  }

  TimestampUnit unit = TimestampUnit::kNanoseconds;
  if (args.Length() >= 3) {
    unit = ParseTimestampUnit(isolate, args[2]);
  }

  state->encoder->At(timestamp, unit);
  state->rows_buffered++;
}

void IlpBinding::AtNow(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  state->encoder->AtNow();
  state->rows_buffered++;
}

void IlpBinding::Flush(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  if (state->encoder->Empty()) {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
    return;
  }

  // Check for buffer overflow before sending.
  if (state->encoder->HasOverflowed()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Buffer overflow - maximum size exceeded").ToLocalChecked()));
    return;
  }

  if (!state->transport->IsConnected()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Not connected").ToLocalChecked()));
    return;
  }

  ssize_t sent = state->transport->Send(
    state->encoder->Data(), state->encoder->Size());

  if (sent < 0) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, state->transport->LastError()).ToLocalChecked()));
    return;
  }

  state->rows_sent += state->rows_buffered;
  state->bytes_sent += sent;
  state->rows_buffered = 0;
  state->encoder->Clear();

  args.GetReturnValue().Set(Boolean::New(isolate, true));
}

void IlpBinding::GetStats(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }

  Local<Object> stats = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "rowsBuffered"),
    Number::New(isolate, static_cast<double>(state->rows_buffered))).Check();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "rowsSent"),
    Number::New(isolate, static_cast<double>(state->rows_sent))).Check();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "bytesSent"),
    Number::New(isolate, static_cast<double>(state->bytes_sent))).Check();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "bufferSize"),
    Number::New(isolate, static_cast<double>(state->encoder->Size()))).Check();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "connected"),
    Boolean::New(isolate, state->transport->IsConnected())).Check();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "ioUringAvailable"),
    Boolean::New(isolate, state->transport->IsIoUringAvailable())).Check();

  stats->Set(context,
    FIXED_ONE_BYTE_STRING(isolate, "hasOverflowed"),
    Boolean::New(isolate, state->encoder->HasOverflowed())).Check();

  args.GetReturnValue().Set(stats);
}

void IlpBinding::Clear(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1) {
    return;
  }

  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  SenderState* state = GetSender(id);
  if (state == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Sender not found").ToLocalChecked()));
    return;
  }
  state->encoder->Clear();
  state->rows_buffered = 0;
}

void IlpBinding::RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CreateSender);
  registry->Register(DestroySender);
  registry->Register(Connect);
  registry->Register(Close);
  registry->Register(Table);
  registry->Register(Symbol);
  registry->Register(StringColumn);
  registry->Register(SlowBoolColumn);
  registry->Register(cf_fast_bool_column);
  registry->Register(IntColumn);
  registry->Register(SlowFloatColumn);
  registry->Register(cf_fast_float_column);
  registry->Register(TimestampColumn);
  registry->Register(At);
  registry->Register(AtNow);
  registry->Register(Flush);
  registry->Register(GetStats);
  registry->Register(Clear);
}

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_ilp,
    node::socketsecurity::ilp::IlpBinding::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_ilp,
    node::socketsecurity::ilp::IlpBinding::RegisterExternalReferences)

#pragma GCC diagnostic pop
