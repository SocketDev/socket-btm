// ============================================================================
// postgres_binding.h -- Header for the PostgreSQL V8 binding layer
// ============================================================================
//
// C++ HEADER FILES (.h) vs SOURCE FILES (.cc)
//   ".h" files declare classes and method signatures (like a table of
//   contents).  ".cc" files contain the implementations.  This header
//   is included by postgres_binding.cc and postgres_async.cc.
//
// WHAT THIS FILE DECLARES
//   PostgresBinding -- the class that wires PostgresPool (the connection
//   pool) into Node.js so JavaScript code can run SQL queries.
//
//   This is a PostgreSQL client built in C++ using libpq (the official
//   Postgres C library that ships with every PostgreSQL installation).
//
// WHY C++ INSTEAD OF JAVASCRIPT
//   Pure-JS Postgres drivers (like "pg") parse the Postgres wire protocol
//   in JavaScript, which means every query result goes through JS string
//   and object allocation.  This implementation uses libpq's C-level
//   parsing and converts directly to V8 objects, skipping the JS
//   intermediate step.  The connection pool also lives in C++ so it can
//   be shared safely across async operations.
//
// HOW JAVASCRIPT USES THIS
//   JS calls `internalBinding('smol_postgres')` which returns an object
//   with methods like createPool, executeSync, prepareSync,
//   executePreparedAsync, etc.  A JS wrapper class (not in this file)
//   provides a friendlier API on top of these raw bindings.
//
// KEY C++ CONCEPTS USED HERE
//   PGresult*
//     -- A pointer to a libpq query result.  Contains rows, columns,
//        error messages, etc.  Must be freed with PQclear() when done.
//
//   std::unordered_map<uint32_t, std::unique_ptr<PostgresPool>> pools_
//     -- A hash map from pool ID to pool object.  JS passes numeric IDs
//        (not raw pointers) for safety.
//
//   v8::FunctionCallbackInfo<Value>& args
//     -- Every C++ function callable from JS receives its arguments
//        through this object.
// ============================================================================
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

  // Pool storage (keyed by pool ID). Thread-local so each Worker gets its own.
  static thread_local std::unordered_map<uint32_t, std::unique_ptr<PostgresPool>> pools_;
  static thread_local uint32_t next_pool_id_;
};

// Async bindings (implemented in postgres_async.cc).
void InitializeAsyncBindings(v8::Local<v8::Object> target,
                             v8::Local<v8::Context> context,
                             Environment* env);

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_POSTGRES_POSTGRES_BINDING_H_
