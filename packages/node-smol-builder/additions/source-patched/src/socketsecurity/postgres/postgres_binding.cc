// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

#include "socketsecurity/postgres/postgres_binding.h"
#include "env-inl.h"
#include "node_external_reference.h"
#include "node_internals.h"
#include "util-inl.h"
#include <cstring>

namespace node {
namespace socketsecurity {
namespace postgres {

using v8::Array;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::HandleScope;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Uint32;
using v8::Value;

// Static member definitions.
std::unordered_map<uint32_t, std::unique_ptr<PostgresPool>> PostgresBinding::pools_;
uint32_t PostgresBinding::next_pool_id_ = 1;

void PostgresBinding::Initialize(
    Local<Context> context,
    Local<Object> target,
    Environment* env) {
  Isolate* isolate = env->isolate();
  HandleScope scope(isolate);

  // Pool management.
  SetMethod(context, target, "createPool", CreatePool);
  SetMethod(context, target, "destroyPool", DestroyPool);
  SetMethod(context, target, "getPoolStats", GetPoolStats);

  // Synchronous query execution (fast path, avoids async overhead).
  SetMethod(context, target, "executeSync", ExecuteSync);
  SetMethod(context, target, "executeParamsSync", ExecuteParamsSync);
  SetMethod(context, target, "executePreparedSync", ExecutePreparedSync);

  // Prepared statements.
  SetMethod(context, target, "prepareSync", PrepareSync);

  // Connection management.
  SetMethod(context, target, "acquireConnection", AcquireConnection);
  SetMethod(context, target, "releaseConnection", ReleaseConnection);

  // Async bindings (from postgres_async.cc).
  InitializeAsyncBindings(target, context, env);
}

void PostgresBinding::CreatePool(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Config object required").ToLocalChecked()));
    return;
  }

  Local<Object> config_obj = args[0].As<Object>();

  // Extract config values.
  PostgresPool::Config config;

  Local<Value> conn_str_val;
  if (config_obj->Get(context,
      String::NewFromUtf8(isolate, "connectionString").ToLocalChecked())
      .ToLocal(&conn_str_val) && conn_str_val->IsString()) {
    String::Utf8Value utf8(isolate, conn_str_val);
    config.connection_string = *utf8;
  } else {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "connectionString required").ToLocalChecked()));
    return;
  }

  Local<Value> min_val;
  if (config_obj->Get(context,
      String::NewFromUtf8(isolate, "minConnections").ToLocalChecked())
      .ToLocal(&min_val) && min_val->IsNumber()) {
    config.min_connections = static_cast<size_t>(
      min_val->Uint32Value(context).FromMaybe(2));
  }

  Local<Value> max_val;
  if (config_obj->Get(context,
      String::NewFromUtf8(isolate, "maxConnections").ToLocalChecked())
      .ToLocal(&max_val) && max_val->IsNumber()) {
    config.max_connections = static_cast<size_t>(
      max_val->Uint32Value(context).FromMaybe(10));
  }

  Local<Value> timeout_val;
  if (config_obj->Get(context,
      String::NewFromUtf8(isolate, "connectTimeoutMs").ToLocalChecked())
      .ToLocal(&timeout_val) && timeout_val->IsNumber()) {
    config.connect_timeout_ms = static_cast<int>(
      timeout_val->Int32Value(context).FromMaybe(10000));
  }

  // Create pool.
  auto pool = std::make_unique<PostgresPool>(config);
  if (!pool->Initialize()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Failed to initialize pool").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = next_pool_id_++;
  pools_[pool_id] = std::move(pool);

  args.GetReturnValue().Set(Uint32::New(isolate, pool_id));
}

void PostgresBinding::DestroyPool(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsUint32()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it != pools_.end()) {
    pools_.erase(it);
    args.GetReturnValue().Set(Boolean::New(isolate, true));
  } else {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
  }
}

void PostgresBinding::GetPoolStats(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsUint32()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  PostgresPool* pool = it->second.get();
  Local<Object> stats = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  stats->Set(context,
    String::NewFromUtf8(isolate, "idle").ToLocalChecked(),
    Uint32::New(isolate, static_cast<uint32_t>(pool->GetIdleCount()))).Check();

  stats->Set(context,
    String::NewFromUtf8(isolate, "active").ToLocalChecked(),
    Uint32::New(isolate, static_cast<uint32_t>(pool->GetActiveCount()))).Check();

  stats->Set(context,
    String::NewFromUtf8(isolate, "total").ToLocalChecked(),
    Uint32::New(isolate, static_cast<uint32_t>(pool->GetTotalCount()))).Check();

  stats->Set(context,
    String::NewFromUtf8(isolate, "healthy").ToLocalChecked(),
    Boolean::New(isolate, pool->IsHealthy())).Check();

  args.GetReturnValue().Set(stats);
}

void PostgresBinding::ExecuteSync(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 2) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID and query required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value query(isolate, args[1]);
  PGresult* result = it->second->Execute(*query);

  if (result == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Query execution failed").ToLocalChecked()));
    return;
  }

  Local<Value> parsed = ParseResult(env, result);
  PQclear(result);

  args.GetReturnValue().Set(parsed);
}

void PostgresBinding::ExecuteParamsSync(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID, query, and params required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value query(isolate, args[1]);

  if (!args[2]->IsArray()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Params must be array").ToLocalChecked()));
    return;
  }

  Local<Array> params_arr = args[2].As<Array>();
  int nParams = static_cast<int>(params_arr->Length());

  // Convert params to C strings.
  std::vector<std::string> param_strings(nParams);
  std::vector<const char*> param_values(nParams);

  for (int i = 0; i < nParams; ++i) {
    Local<Value> val;
    if (params_arr->Get(context, i).ToLocal(&val)) {
      if (val->IsNullOrUndefined()) {
        param_values[i] = nullptr;
      } else {
        String::Utf8Value utf8(isolate, val);
        param_strings[i] = *utf8;
        param_values[i] = param_strings[i].c_str();
      }
    }
  }

  PGresult* result = it->second->ExecuteParams(
    *query,
    nParams,
    nullptr,  // Let Postgres infer types.
    param_values.data(),
    nullptr,  // Text format lengths.
    nullptr,  // Text format.
    0);  // Text result.

  if (result == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Query execution failed").ToLocalChecked()));
    return;
  }

  Local<Value> parsed = ParseResult(env, result);
  PQclear(result);

  args.GetReturnValue().Set(parsed);
}

void PostgresBinding::PrepareSync(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID, name, and query required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);
  String::Utf8Value query(isolate, args[2]);

  // Read paramTypes array from args[3] if provided.
  int nParams = 0;
  std::vector<Oid> param_types;
  if (args.Length() >= 4 && args[3]->IsArray()) {
    Local<Array> types_arr = args[3].As<Array>();
    nParams = static_cast<int>(types_arr->Length());
    param_types.resize(nParams);
    for (int i = 0; i < nParams; ++i) {
      Local<Value> val;
      if (types_arr->Get(context, i).ToLocal(&val) && val->IsNumber()) {
        param_types[i] = static_cast<Oid>(
          val->Uint32Value(context).FromMaybe(0));
      } else {
        param_types[i] = 0;  // Let Postgres infer type.
      }
    }
  }

  bool success = it->second->Prepare(
    *name, *query, nParams, nParams > 0 ? param_types.data() : nullptr);
  args.GetReturnValue().Set(Boolean::New(isolate, success));
}

void PostgresBinding::ExecutePreparedSync(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 3) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID, name, and params required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value name(isolate, args[1]);

  if (!args[2]->IsArray()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Params must be array").ToLocalChecked()));
    return;
  }

  Local<Array> params_arr = args[2].As<Array>();
  int nParams = static_cast<int>(params_arr->Length());

  std::vector<std::string> param_strings(nParams);
  std::vector<const char*> param_values(nParams);

  for (int i = 0; i < nParams; ++i) {
    Local<Value> val;
    if (params_arr->Get(context, i).ToLocal(&val)) {
      if (val->IsNullOrUndefined()) {
        param_values[i] = nullptr;
      } else {
        String::Utf8Value utf8(isolate, val);
        param_strings[i] = *utf8;
        param_values[i] = param_strings[i].c_str();
      }
    }
  }

  PGresult* result = it->second->ExecutePrepared(
    *name,
    nParams,
    param_values.data(),
    nullptr,
    nullptr,
    0);

  if (result == nullptr) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Prepared query execution failed").ToLocalChecked()));
    return;
  }

  Local<Value> parsed = ParseResult(env, result);
  PQclear(result);

  args.GetReturnValue().Set(parsed);
}

void PostgresBinding::AcquireConnection(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsUint32()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Pool ID required").ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    isolate->ThrowException(Exception::Error(
      String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  PooledConnection* conn = it->second->Acquire();
  if (conn == nullptr) {
    args.GetReturnValue().SetUndefined();
    return;
  }

  // Return connection pointer as external.
  Local<Object> conn_obj = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
  conn_obj->SetInternalField(0, v8::External::New(isolate, conn));
  conn_obj->Set(context,
    String::NewFromUtf8(isolate, "poolId").ToLocalChecked(),
    Uint32::New(isolate, pool_id)).Check();

  args.GetReturnValue().Set(conn_obj);
}

void PostgresBinding::ReleaseConnection(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsObject()) {
    isolate->ThrowException(Exception::TypeError(
      String::NewFromUtf8(isolate, "Connection object required").ToLocalChecked()));
    return;
  }

  Local<Object> conn_obj = args[0].As<Object>();

  Local<Value> pool_id_val;
  if (!conn_obj->Get(context,
      String::NewFromUtf8(isolate, "poolId").ToLocalChecked())
      .ToLocal(&pool_id_val)) {
    return;
  }

  uint32_t pool_id = pool_id_val->Uint32Value(context).FromMaybe(0);
  auto it = pools_.find(pool_id);
  if (it == pools_.end()) {
    return;
  }

  Local<Value> external = conn_obj->GetInternalField(0);
  if (!external->IsExternal()) {
    return;
  }

  PooledConnection* conn = static_cast<PooledConnection*>(
    external.As<v8::External>()->Value());

  it->second->Release(conn);
}

Local<Value> PostgresBinding::ParseResult(Environment* env, PGresult* result) {
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  ExecStatusType status = PQresultStatus(result);

  Local<Object> obj = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

  // Command status.
  const char* status_str = PQresStatus(status);
  obj->Set(context,
    String::NewFromUtf8(isolate, "status").ToLocalChecked(),
    String::NewFromUtf8(isolate, status_str).ToLocalChecked()).Check();

  if (status == PGRES_FATAL_ERROR || status == PGRES_NONFATAL_ERROR) {
    const char* error_msg = PQresultErrorMessage(result);
    obj->Set(context,
      String::NewFromUtf8(isolate, "error").ToLocalChecked(),
      String::NewFromUtf8(isolate, error_msg).ToLocalChecked()).Check();
  }

  if (status == PGRES_TUPLES_OK) {
    obj->Set(context,
      String::NewFromUtf8(isolate, "rows").ToLocalChecked(),
      ParseRows(env, result)).Check();

    obj->Set(context,
      String::NewFromUtf8(isolate, "rowCount").ToLocalChecked(),
      Integer::New(isolate, PQntuples(result))).Check();
  }

  if (status == PGRES_COMMAND_OK) {
    const char* affected = PQcmdTuples(result);
    if (affected && affected[0] != '\0') {
      obj->Set(context,
        String::NewFromUtf8(isolate, "rowsAffected").ToLocalChecked(),
        Integer::New(isolate, std::atoi(affected))).Check();
    }
  }

  return obj;
}

Local<Array> PostgresBinding::ParseRows(Environment* env, PGresult* result) {
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  int nrows = PQntuples(result);
  int ncols = PQnfields(result);

  Local<Array> rows = Array::New(isolate, nrows);

  // Get column names.
  std::vector<Local<String>> col_names(ncols);
  for (int c = 0; c < ncols; ++c) {
    const char* name = PQfname(result, c);
    col_names[c] = String::NewFromUtf8(isolate, name).ToLocalChecked();
  }

  for (int r = 0; r < nrows; ++r) {
    Local<Object> row = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);

    for (int c = 0; c < ncols; ++c) {
      Local<Value> val;

      if (PQgetisnull(result, r, c)) {
        val = v8::Null(isolate);
      } else {
        const char* value = PQgetvalue(result, r, c);
        Oid type = PQftype(result, c);

        // Basic type conversion.
        switch (type) {
          case 16:  // BOOL
            val = Boolean::New(isolate, value[0] == 't');
            break;
          case 20:  // INT8
          case 21:  // INT2
          case 23:  // INT4
            val = Number::New(isolate, std::strtoll(value, nullptr, 10));
            break;
          case 700:  // FLOAT4
          case 701:  // FLOAT8
          case 1700: // NUMERIC
            val = Number::New(isolate, std::strtod(value, nullptr));
            break;
          default:
            val = String::NewFromUtf8(isolate, value).ToLocalChecked();
            break;
        }
      }

      row->Set(context, col_names[c], val).Check();
    }

    rows->Set(context, r, row).Check();
  }

  return rows;
}

// Provide access to pools for async operations.
std::unordered_map<uint32_t, std::unique_ptr<PostgresPool>>&
PostgresBinding::GetPools() {
  return pools_;
}

// Forward declaration for async binding (implemented in postgres_async.cc).
void ExecutePreparedAsync(const v8::FunctionCallbackInfo<v8::Value>& args);

void PostgresBinding::RegisterExternalReferences(
    ExternalReferenceRegistry* registry) {
  // Pool management.
  registry->Register(CreatePool);
  registry->Register(DestroyPool);
  registry->Register(GetPoolStats);

  // Synchronous query execution.
  registry->Register(ExecuteSync);
  registry->Register(ExecuteParamsSync);
  registry->Register(ExecutePreparedSync);

  // Prepared statements.
  registry->Register(PrepareSync);

  // Connection management.
  registry->Register(AcquireConnection);
  registry->Register(ReleaseConnection);

  // Async bindings.
  registry->Register(ExecutePreparedAsync);
}

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_postgres,
    node::socketsecurity::postgres::PostgresBinding::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_postgres,
    node::socketsecurity::postgres::PostgresBinding::RegisterExternalReferences)
