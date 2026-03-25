/**
 * PostgreSQL Async Bindings
 *
 * Provides async query execution using libuv thread pool.
 * This complements the sync bindings for non-blocking database operations.
 */

#include "socketsecurity/postgres/postgres_binding.h"
#include "env-inl.h"
#include "node_internals.h"
#include "threadpoolwork-inl.h"
#include "util-inl.h"
#include <libpq-fe.h>
#include <memory>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace postgres {

using v8::Array;
using v8::ArrayBuffer;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::Global;
using v8::HandleScope;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Uint32;
using v8::Uint8Array;
using v8::Value;

/**
 * Async query work request.
 * Encapsulates all data needed for async query execution.
 */
class QueryAsyncWork : public ThreadPoolWork {
 public:
  QueryAsyncWork(Environment* env,
                 PostgresPool* pool,
                 std::string query,
                 std::vector<std::string> params,
                 bool use_bigint,
                 Local<Function> callback)
      : ThreadPoolWork(env, "postgres.query"),
        pool_(pool),
        query_(std::move(query)),
        params_(std::move(params)),
        use_bigint_(use_bigint),
        result_(nullptr),
        error_message_() {
    callback_.Reset(env->isolate(), callback);
  }

  ~QueryAsyncWork() override {
    if (result_ != nullptr) {
      PQclear(result_);
    }
  }

  // Run in thread pool.
  void DoThreadPoolWork() override {
    // Build param pointers.
    std::vector<const char*> param_values(params_.size());
    for (size_t i = 0; i < params_.size(); ++i) {
      if (params_[i].empty() && params_[i].data() == nullptr) {
        param_values[i] = nullptr;  // NULL value.
      } else {
        param_values[i] = params_[i].c_str();
      }
    }

    // Execute query.
    if (params_.empty()) {
      result_ = pool_->Execute(query_.c_str());
    } else {
      result_ = pool_->ExecuteParams(
          query_.c_str(),
          static_cast<int>(params_.size()),
          nullptr,  // Let Postgres infer types.
          param_values.data(),
          nullptr,  // Text format lengths.
          nullptr,  // Text format.
          0);       // Text result.
    }

    if (result_ == nullptr) {
      error_message_ = "Query execution failed";
    } else {
      ExecStatusType status = PQresultStatus(result_);
      if (status == PGRES_FATAL_ERROR) {
        error_message_ = PQresultErrorMessage(result_);
        // Extract detailed error info.
        const char* code = PQresultErrorField(result_, PG_DIAG_SQLSTATE);
        const char* detail = PQresultErrorField(result_, PG_DIAG_MESSAGE_DETAIL);
        const char* hint = PQresultErrorField(result_, PG_DIAG_MESSAGE_HINT);
        const char* table = PQresultErrorField(result_, PG_DIAG_TABLE_NAME);
        const char* constraint = PQresultErrorField(result_, PG_DIAG_CONSTRAINT_NAME);

        if (code) error_code_ = code;
        if (detail) error_detail_ = detail;
        if (hint) error_hint_ = hint;
        if (table) error_table_ = table;
        if (constraint) error_constraint_ = constraint;
      }
    }
  }

  // Run in main thread after work completes.
  void AfterThreadPoolWork(int status) override {
    Environment* env = this->env();
    Isolate* isolate = env->isolate();
    HandleScope handle_scope(isolate);
    Local<Context> context = env->context();
    Context::Scope context_scope(context);

    Local<Value> argv[2];

    if (!error_message_.empty()) {
      // Create error object with PostgreSQL details.
      Local<Object> error_obj = Object::New(isolate);
      error_obj->Set(context,
          String::NewFromUtf8(isolate, "message").ToLocalChecked(),
          String::NewFromUtf8(isolate, error_message_.c_str()).ToLocalChecked()).Check();

      if (!error_code_.empty()) {
        error_obj->Set(context,
            String::NewFromUtf8(isolate, "code").ToLocalChecked(),
            String::NewFromUtf8(isolate, error_code_.c_str()).ToLocalChecked()).Check();
      }
      if (!error_detail_.empty()) {
        error_obj->Set(context,
            String::NewFromUtf8(isolate, "detail").ToLocalChecked(),
            String::NewFromUtf8(isolate, error_detail_.c_str()).ToLocalChecked()).Check();
      }
      if (!error_hint_.empty()) {
        error_obj->Set(context,
            String::NewFromUtf8(isolate, "hint").ToLocalChecked(),
            String::NewFromUtf8(isolate, error_hint_.c_str()).ToLocalChecked()).Check();
      }
      if (!error_table_.empty()) {
        error_obj->Set(context,
            String::NewFromUtf8(isolate, "table").ToLocalChecked(),
            String::NewFromUtf8(isolate, error_table_.c_str()).ToLocalChecked()).Check();
      }
      if (!error_constraint_.empty()) {
        error_obj->Set(context,
            String::NewFromUtf8(isolate, "constraint").ToLocalChecked(),
            String::NewFromUtf8(isolate, error_constraint_.c_str()).ToLocalChecked()).Check();
      }

      argv[0] = error_obj;
      argv[1] = v8::Undefined(isolate);
    } else {
      argv[0] = v8::Undefined(isolate);
      argv[1] = ParseResultToJS(env, result_, use_bigint_);
    }

    Local<Function> callback = callback_.Get(isolate);
    MaybeLocal<Value> result = callback->Call(context, v8::Undefined(isolate), 2, argv);

    // If callback throws exception, we're already in cleanup phase
    // Let Node.js handle the exception rather than crashing with ToLocalChecked()
    if (result.IsEmpty()) {
      // Exception was thrown and will be handled by Node.js
      // Continue cleanup safely
    }

    delete this;
  }

 private:
  // Helper to decode PostgreSQL BYTEA hex format to Uint8Array
  static Local<Value> DecodeBytea(Isolate* isolate, const char* value) {
    size_t value_len = std::strlen(value);
    if (value_len < 2 || value[0] != '\\' || value[1] != 'x') {
      // Not hex format - return as string
      return String::NewFromUtf8(isolate, value).ToLocalChecked();
    }

    size_t hex_len = value_len - 2;

    // Validate: hex string must have even length and reasonable size
    if (hex_len % 2 != 0 || hex_len > 200000000) {  // Max 100MB binary
      return String::NewFromUtf8(isolate, value).ToLocalChecked();
    }

    size_t byte_len = hex_len / 2;
    std::unique_ptr<uint8_t[]> bytes(new uint8_t[byte_len]);

    // Decode and validate hex characters
    auto is_hex = [](char c) {
      return (c >= '0' && c <= '9') ||
             (c >= 'a' && c <= 'f') ||
             (c >= 'A' && c <= 'F');
    };

    for (size_t i = 0; i < byte_len; i++) {
      const char* hex = value + 2 + (i * 2);

      if (!is_hex(hex[0]) || !is_hex(hex[1])) {
        // Invalid hex - fall back to string
        return String::NewFromUtf8(isolate, value).ToLocalChecked();
      }

      int high = (hex[0] >= 'a') ? (hex[0] - 'a' + 10) :
                 (hex[0] >= 'A') ? (hex[0] - 'A' + 10) : (hex[0] - '0');
      int low = (hex[1] >= 'a') ? (hex[1] - 'a' + 10) :
                (hex[1] >= 'A') ? (hex[1] - 'A' + 10) : (hex[1] - '0');
      bytes[i] = static_cast<uint8_t>((high << 4) | low);
    }

    // Create backing store
    std::unique_ptr<v8::BackingStore> backing = ArrayBuffer::NewBackingStore(
        bytes.get(), byte_len,
        [](void* data, size_t, void*) { delete[] static_cast<uint8_t*>(data); },
        nullptr);

    // Validate BackingStore was created successfully
    if (!backing) {
      return String::NewFromUtf8(isolate, value).ToLocalChecked();
    }

    Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, std::move(backing));
    if (ab.IsEmpty()) {
      return String::NewFromUtf8(isolate, value).ToLocalChecked();
    }

    // Success - release ownership to backing store
    bytes.release();
    return Uint8Array::New(ab, 0, byte_len);
  }

  Local<Value> ParseResultToJS(Environment* env, PGresult* result, bool use_bigint) {
    Isolate* isolate = env->isolate();
    Local<Context> context = env->context();

    ExecStatusType status = PQresultStatus(result);
    Local<Object> obj = Object::New(isolate);

    if (status == PGRES_TUPLES_OK) {
      int nrows = PQntuples(result);
      int ncols = PQnfields(result);

      // Get column names.
      Local<Array> columns = Array::New(isolate, ncols);
      for (int c = 0; c < ncols; ++c) {
        const char* name = PQfname(result, c);
        columns->Set(context, c,
            String::NewFromUtf8(isolate, name).ToLocalChecked()).Check();
      }
      obj->Set(context,
          String::NewFromUtf8(isolate, "columns").ToLocalChecked(),
          columns).Check();

      // Parse rows as value arrays (for efficiency).
      Local<Array> rows = Array::New(isolate, nrows);
      for (int r = 0; r < nrows; ++r) {
        Local<Array> row = Array::New(isolate, ncols);

        for (int c = 0; c < ncols; ++c) {
          Local<Value> val;

          if (PQgetisnull(result, r, c)) {
            val = v8::Null(isolate);
          } else {
            const char* value = PQgetvalue(result, r, c);
            Oid type = PQftype(result, c);

            // Type conversion with BigInt support.
            switch (type) {
              case 16:  // BOOL
                val = Boolean::New(isolate, value[0] == 't');
                break;
              case 20:  // INT8 (bigint)
                if (use_bigint) {
                  int64_t int_val = std::strtoll(value, nullptr, 10);
                  val = v8::BigInt::New(isolate, int_val);
                } else {
                  double d = std::strtod(value, nullptr);
                  if (d > 9007199254740991.0 || d < -9007199254740991.0) {
                    // Return as string for safety.
                    val = String::NewFromUtf8(isolate, value).ToLocalChecked();
                  } else {
                    val = Number::New(isolate, d);
                  }
                }
                break;
              case 21:  // INT2
              case 23:  // INT4
                val = Number::New(isolate, std::strtol(value, nullptr, 10));
                break;
              case 700:  // FLOAT4
              case 701:  // FLOAT8
                val = Number::New(isolate, std::strtod(value, nullptr));
                break;
              case 1700:  // NUMERIC
                // Return as string to preserve precision.
                val = String::NewFromUtf8(isolate, value).ToLocalChecked();
                break;
              case 114:   // JSON
              case 3802:  // JSONB
                // Parse JSON if possible, otherwise return string.
                // For now, return string and let JS parse.
                val = String::NewFromUtf8(isolate, value).ToLocalChecked();
                break;
              case 17:  // BYTEA
                // PostgreSQL returns BYTEA in hex format: \x<hex digits>
                // Decode to Uint8Array for efficient binary handling.
                val = DecodeBytea(isolate, value);
                break;
              default:
                val = String::NewFromUtf8(isolate, value).ToLocalChecked();
                break;
            }
          }

          row->Set(context, c, val).Check();
        }

        rows->Set(context, r, row).Check();
      }

      obj->Set(context,
          String::NewFromUtf8(isolate, "rows").ToLocalChecked(),
          rows).Check();
      obj->Set(context,
          String::NewFromUtf8(isolate, "rowCount").ToLocalChecked(),
          Integer::New(isolate, nrows)).Check();
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

  PostgresPool* pool_;
  std::string query_;
  std::vector<std::string> params_;
  bool use_bigint_;
  PGresult* result_;
  std::string error_message_;
  std::string error_code_;
  std::string error_detail_;
  std::string error_hint_;
  std::string error_table_;
  std::string error_constraint_;
  Global<Function> callback_;
};

/**
 * Async prepared statement execution.
 */
class ExecutePreparedAsyncWork : public ThreadPoolWork {
 public:
  ExecutePreparedAsyncWork(Environment* env,
                           PostgresPool* pool,
                           std::string stmt_name,
                           std::vector<std::string> params,
                           bool use_bigint,
                           Local<Function> callback)
      : ThreadPoolWork(env, "postgres.executePrepared"),
        pool_(pool),
        stmt_name_(std::move(stmt_name)),
        params_(std::move(params)),
        use_bigint_(use_bigint),
        result_(nullptr) {
    callback_.Reset(env->isolate(), callback);
  }

  ~ExecutePreparedAsyncWork() override {
    if (result_ != nullptr) {
      PQclear(result_);
    }
  }

  void DoThreadPoolWork() override {
    std::vector<const char*> param_values(params_.size());
    for (size_t i = 0; i < params_.size(); ++i) {
      param_values[i] = params_[i].c_str();
    }

    result_ = pool_->ExecutePrepared(
        stmt_name_.c_str(),
        static_cast<int>(params_.size()),
        param_values.data(),
        nullptr,
        nullptr,
        0);

    if (result_ == nullptr) {
      error_message_ = "Prepared statement execution failed";
    } else {
      ExecStatusType status = PQresultStatus(result_);
      if (status == PGRES_FATAL_ERROR) {
        error_message_ = PQresultErrorMessage(result_);
        const char* code = PQresultErrorField(result_, PG_DIAG_SQLSTATE);
        if (code) error_code_ = code;
      }
    }
  }

  void AfterThreadPoolWork(int status) override {
    Environment* env = this->env();
    Isolate* isolate = env->isolate();
    HandleScope handle_scope(isolate);
    Local<Context> context = env->context();
    Context::Scope context_scope(context);

    Local<Value> argv[2];

    if (!error_message_.empty()) {
      Local<Object> error_obj = Object::New(isolate);
      error_obj->Set(context,
          String::NewFromUtf8(isolate, "message").ToLocalChecked(),
          String::NewFromUtf8(isolate, error_message_.c_str()).ToLocalChecked()).Check();
      if (!error_code_.empty()) {
        error_obj->Set(context,
            String::NewFromUtf8(isolate, "code").ToLocalChecked(),
            String::NewFromUtf8(isolate, error_code_.c_str()).ToLocalChecked()).Check();
      }
      argv[0] = error_obj;
      argv[1] = v8::Undefined(isolate);
    } else {
      argv[0] = v8::Undefined(isolate);
      // Reuse the parsing logic from QueryAsyncWork.
      argv[1] = ParseResultToJS(env, result_);
    }

    Local<Function> callback = callback_.Get(isolate);
    MaybeLocal<Value> result = callback->Call(context, v8::Undefined(isolate), 2, argv);

    // If callback throws exception, we're already in cleanup phase
    // Let Node.js handle the exception rather than crashing with ToLocalChecked()
    if (result.IsEmpty()) {
      // Exception was thrown and will be handled by Node.js
      // Continue cleanup safely
    }

    delete this;
  }

 private:
  Local<Value> ParseResultToJS(Environment* env, PGresult* result) {
    // Same as QueryAsyncWork::ParseResultToJS but simplified.
    Isolate* isolate = env->isolate();
    Local<Context> context = env->context();

    Local<Object> obj = Object::New(isolate);
    ExecStatusType status = PQresultStatus(result);

    if (status == PGRES_TUPLES_OK) {
      int nrows = PQntuples(result);
      int ncols = PQnfields(result);

      Local<Array> columns = Array::New(isolate, ncols);
      for (int c = 0; c < ncols; ++c) {
        columns->Set(context, c,
            String::NewFromUtf8(isolate, PQfname(result, c)).ToLocalChecked()).Check();
      }
      obj->Set(context,
          String::NewFromUtf8(isolate, "columns").ToLocalChecked(),
          columns).Check();

      Local<Array> rows = Array::New(isolate, nrows);
      for (int r = 0; r < nrows; ++r) {
        Local<Array> row = Array::New(isolate, ncols);
        for (int c = 0; c < ncols; ++c) {
          Local<Value> val;
          if (PQgetisnull(result, r, c)) {
            val = v8::Null(isolate);
          } else {
            const char* value = PQgetvalue(result, r, c);
            Oid type = PQftype(result, c);
            switch (type) {
              case 16:
                val = Boolean::New(isolate, value[0] == 't');
                break;
              case 20:
              case 21:
              case 23:
                val = Number::New(isolate, std::strtoll(value, nullptr, 10));
                break;
              case 700:
              case 701:
                val = Number::New(isolate, std::strtod(value, nullptr));
                break;
              default:
                val = String::NewFromUtf8(isolate, value).ToLocalChecked();
                break;
            }
          }
          row->Set(context, c, val).Check();
        }
        rows->Set(context, r, row).Check();
      }
      obj->Set(context,
          String::NewFromUtf8(isolate, "rows").ToLocalChecked(),
          rows).Check();
      obj->Set(context,
          String::NewFromUtf8(isolate, "rowCount").ToLocalChecked(),
          Integer::New(isolate, nrows)).Check();
    }

    return obj;
  }

  PostgresPool* pool_;
  std::string stmt_name_;
  std::vector<std::string> params_;
  bool use_bigint_;
  PGresult* result_;
  std::string error_message_;
  std::string error_code_;
  Global<Function> callback_;
};

// Async binding methods.

void ExecutePreparedAsync(const FunctionCallbackInfo<Value>& args) {
  Environment* env = Environment::GetCurrent(args);
  Isolate* isolate = env->isolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 5) {
    isolate->ThrowException(Exception::TypeError(
        String::NewFromUtf8(isolate,
            "Pool ID, statement name, params, bigint flag, and callback required")
            .ToLocalChecked()));
    return;
  }

  uint32_t pool_id = args[0]->Uint32Value(context).FromMaybe(0);
  auto it = PostgresBinding::GetPools().find(pool_id);
  if (it == PostgresBinding::GetPools().end()) {
    isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate, "Pool not found").ToLocalChecked()));
    return;
  }

  String::Utf8Value stmt_name(isolate, args[1]);

  if (!args[2]->IsArray()) {
    isolate->ThrowException(Exception::TypeError(
        String::NewFromUtf8(isolate, "Params must be array").ToLocalChecked()));
    return;
  }

  Local<Array> params_arr = args[2].As<Array>();
  std::vector<std::string> params(params_arr->Length());
  for (uint32_t i = 0; i < params_arr->Length(); ++i) {
    Local<Value> val;
    if (params_arr->Get(context, i).ToLocal(&val) && !val->IsNullOrUndefined()) {
      String::Utf8Value utf8(isolate, val);
      params[i] = *utf8;
    }
  }

  bool use_bigint = args[3]->BooleanValue(isolate);

  if (!args[4]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(
        String::NewFromUtf8(isolate, "Callback must be a function").ToLocalChecked()));
    return;
  }

  Local<Function> callback = args[4].As<Function>();

  auto* work = new ExecutePreparedAsyncWork(
      env,
      it->second.get(),
      *stmt_name,
      std::move(params),
      use_bigint,
      callback);

  work->ScheduleWork();
}

void InitializeAsyncBindings(Local<Object> target,
                             Local<Context> context,
                             Environment* env) {
  SetMethod(context, target, "executePreparedAsync", ExecutePreparedAsync);
}

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node
