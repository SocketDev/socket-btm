// ============================================================================
// ilp_binding.h -- Header (declarations) for the ILP V8 binding layer
// ============================================================================
//
// C++ HEADER FILES (.h) vs SOURCE FILES (.cc)
//   In C++, code is split into two kinds of files:
//     - ".h" (header) files declare what exists: class names, method
//       signatures, data types. Think of them as a table of contents.
//     - ".cc" (source) files contain the actual implementation.
//   Other files #include a header to learn about the classes inside it,
//   then the linker connects everything together at build time.
//
// WHAT THIS FILE DECLARES
//   IlpBinding -- the class that wires the ILP encoder and TCP transport
//   into Node.js so JavaScript code can call them.
//
//   ILP (Influx Line Protocol) is a compact text format for sending
//   time-series data (e.g. sensor readings, stock prices) to databases
//   like QuestDB and InfluxDB.  Each row looks like:
//
//     tableName,symbol1=val1 field1=123i,field2=4.5 1625000000000000000\n
//     ^table    ^tags        ^columns                ^timestamp (nanos)
//
// HOW JAVASCRIPT USES THIS
//   JS calls `internalBinding('smol_ilp')` which returns an object with
//   methods like createSender, table, symbol, floatColumn, flush, etc.
//   Those methods are defined in ilp_binding.cc.
//   The user-facing API lives in lib/internal/socketsecurity/ilp.js
//   (the Sender class), which wraps these raw C++ bindings with
//   validation and a fluent builder interface.
//
// KEY C++ CONCEPTS USED HERE
//   v8::FunctionCallbackInfo<Value>& args
//     -- Every C++ function callable from JS receives its arguments
//        through this object.  args[0], args[1], etc. are the JS values.
//
//   std::unique_ptr<T>
//     -- A smart pointer that automatically deletes the object it points
//        to when it goes out of scope.  Prevents memory leaks.
//
//   std::unordered_map<K, V>
//     -- A hash map (like a JS Map/Object), here mapping sender IDs to
//        their state objects.
// ============================================================================
#ifndef SRC_SOCKETSECURITY_ILP_ILP_BINDING_H_
#define SRC_SOCKETSECURITY_ILP_ILP_BINDING_H_

#include "env.h"
#include "v8.h"
#include "socketsecurity/ilp/ilp_encoder.h"
#include "socketsecurity/ilp/ilp_transport.h"
#include <memory>
#include <unordered_map>

namespace node {

class ExternalReferenceRegistry;

namespace socketsecurity {
namespace ilp {

// Node.js binding for ILP (InfluxDB Line Protocol) client.
// Provides high-performance time-series data ingestion.
class IlpBinding {
 public:
  static void Initialize(
    v8::Local<v8::Context> context,
    v8::Local<v8::Object> target,
    Environment* env);
  static void RegisterExternalReferences(ExternalReferenceRegistry* registry);

  // Sender state — public for fast call free functions.
  struct SenderState {
    std::unique_ptr<IlpEncoder> encoder;
    std::unique_ptr<IlpTransport> transport;
    size_t rows_buffered = 0;
    size_t rows_sent = 0;
    size_t bytes_sent = 0;
  };

  static SenderState* GetSender(uint32_t id);

 private:
  // Sender lifecycle.
  static void CreateSender(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void DestroySender(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Connect(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Close(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Row building (slow paths).
  static void Table(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Symbol(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void StringColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SlowBoolColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void IntColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void SlowFloatColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void TimestampColumn(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Row termination.
  static void At(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void AtNow(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Flush and stats.
  static void Flush(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetStats(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Clear(const v8::FunctionCallbackInfo<v8::Value>& args);

  static thread_local std::unordered_map<uint32_t, std::unique_ptr<SenderState>> senders_;
  static thread_local uint32_t next_sender_id_;

  static TimestampUnit ParseTimestampUnit(v8::Isolate* isolate, v8::Local<v8::Value> val);
};

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_ILP_ILP_BINDING_H_
