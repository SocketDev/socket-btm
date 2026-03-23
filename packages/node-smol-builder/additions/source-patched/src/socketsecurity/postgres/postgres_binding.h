#ifndef SRC_SOCKETSECURITY_POSTGRES_POSTGRES_BINDING_H_
#define SRC_SOCKETSECURITY_POSTGRES_POSTGRES_BINDING_H_

#include "env.h"
#include "v8.h"
#include "socketsecurity/postgres/postgres_pool.h"
#include <memory>

namespace node {

class ExternalReferenceRegistry;

namespace socketsecurity {
namespace postgres {

// Node.js binding for PostgresPool.
// Exposes connection pooling with prepared statement caching to JavaScript.
class PostgresBinding {
 public:
  static void Initialize(
    v8::Local<v8::Context> context,
    v8::Local<v8::Object> target,
    Environment* env);

  // Access pools for async operations.
  static std::unordered_map<uint32_t, std::unique_ptr<PostgresPool>>& GetPools();

  static void RegisterExternalReferences(ExternalReferenceRegistry* registry);

 private:
  // Pool management.
  static void CreatePool(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void DestroyPool(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void GetPoolStats(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Synchronous query execution (for simple operations).
  static void ExecuteSync(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ExecuteParamsSync(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Prepared statements.
  static void PrepareSync(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ExecutePreparedSync(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Connection acquisition (for transaction support).
  static void AcquireConnection(const v8::FunctionCallbackInfo<v8::Value>& args);
  static void ReleaseConnection(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Result parsing helpers.
  static v8::Local<v8::Value> ParseResult(
    Environment* env,
    PGresult* result);
  static v8::Local<v8::Array> ParseRows(
    Environment* env,
    PGresult* result);

  // Pool storage (keyed by pool ID).
  static std::unordered_map<uint32_t, std::unique_ptr<PostgresPool>> pools_;
  static uint32_t next_pool_id_;
};

// Async bindings (implemented in postgres_async.cc).
void InitializeAsyncBindings(v8::Local<v8::Object> target,
                             v8::Local<v8::Context> context,
                             Environment* env);

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_POSTGRES_POSTGRES_BINDING_H_
