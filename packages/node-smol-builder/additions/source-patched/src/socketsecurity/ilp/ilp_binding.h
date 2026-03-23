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

 private:
  // Sender lifecycle.
  static void CreateSender(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void DestroySender(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Connect(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Close(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Row building.
  static void Table(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Symbol(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void StringColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void BoolColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void IntColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void FloatColumn(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void TimestampColumn(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Row termination.
  static void At(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void AtNow(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Flush and stats.
  static void Flush(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetStats(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void Clear(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Internal sender state.
  struct SenderState {
    std::unique_ptr<IlpEncoder> encoder;
    std::unique_ptr<IlpTransport> transport;
    size_t rows_buffered = 0;
    size_t rows_sent = 0;
    size_t bytes_sent = 0;
  };

  static std::unordered_map<uint32_t, std::unique_ptr<SenderState>> senders_;
  static uint32_t next_sender_id_;

  static SenderState* GetSender(uint32_t id);
  static TimestampUnit ParseTimestampUnit(v8::Isolate* isolate, v8::Local<v8::Value> val);
};

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_ILP_ILP_BINDING_H_
