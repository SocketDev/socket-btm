// Suppress V8 Object::GetIsolate() deprecation from Node.js internal headers.
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"

// ============================================================================
// postgres_async.cc -- PostgreSQL asynchronous query execution
// ============================================================================
//
// WHAT THIS FILE DOES
//   Provides async versions of the Postgres query functions so that SQL
//   queries run on a background thread (libuv thread pool) instead of
//   blocking the main JS event loop.
//
//   One async work class is defined:
//     ExecutePreparedAsyncWork  -- runs a previously-prepared statement
//
//   It follows this pattern:
//     1. JS calls executePreparedAsync(poolId, name, params, bigint, cb)
//     2. C++ creates a work object, copying all JS data into C++ strings
//        (because V8 objects cannot be touched from background threads).
//     3. DoThreadPoolWork() runs on a libuv worker thread -- calls libpq
//        to execute the query.
//     4. AfterThreadPoolWork() runs back on the main thread -- converts
//        the PGresult to V8 objects and calls the JS callback(err, result).
//
// WHY IT EXISTS (async vs the sync bindings in postgres_binding.cc)
//   Sync queries block the event loop while Postgres processes the SQL.
//   For fast queries (<1ms) that is acceptable, but slow queries (joins,
//   aggregations) would freeze the entire Node.js process.  Async queries
//   offload the wait to a background thread, keeping the event loop free.
//
// HOW JAVASCRIPT USES THIS
//   internalBinding('smol_postgres').executePreparedAsync(
//     poolId, 'getUser', ['42'], false, (err, result) => { ... }
//   );
//
// TYPE CONVERSION
//   Postgres types (identified by OID numbers) are converted to JS types:
//     OID 16  (BOOL)    => true / false
//     OID 20  (INT8)    => BigInt (if use_bigint flag set) or Number/String
//     OID 21  (INT2)    => Number
//     OID 23  (INT4)    => Number
//     OID 700 (FLOAT4)  => Number
//     OID 701 (FLOAT8)  => Number
//     OID 1700 (NUMERIC)=> String (to preserve arbitrary precision)
//     OID 17  (BYTEA)   => Uint8Array (binary data, decoded from hex)
//     Everything else   => String
//
// KEY C++ CONCEPTS USED HERE
//   ThreadPoolWork (from Node.js internals)
//     -- Base class for work that runs on the libuv thread pool.
//        Override DoThreadPoolWork() for the background task and
//        AfterThreadPoolWork() for the callback on the main thread.
//
//   Global<Function> callback_
//     -- A persistent reference to a JS function that survives garbage
//        collection until we explicitly .Reset() it.  Local<> handles
//        only live within a HandleScope and cannot be stored on the heap.
//
//   v8::ArrayBuffer / v8::Uint8Array
//     -- Used to return Postgres BYTEA (binary) columns as typed arrays
//        instead of hex strings, for efficient binary handling in JS.
// ============================================================================

#include "socketsecurity/postgres/postgres_binding.h"
#include "env-inl.h"
#include "node_internals.h"
#include "threadpoolwork-inl.h"
#include "util-inl.h"
#include <libpq-fe.h>
#include <memory>
#include <new>
#include <string>
#include <vector>

namespace node {
namespace socketsecurity {
namespace postgres {

using v8::Array;
using v8::ArrayBuffer;
using v8::BigInt;
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
using v8::Null;
using v8::String;
using v8::Uint32;
using v8::Uint8Array;
using v8::Value;

/**
 * Async prepared statement execution.
 */
class ExecutePreparedAsyncWork : public ThreadPoolWork {
 public:
  ExecutePreparedAsyncWork(Environment* env,
                           std::shared_ptr<PostgresPool> pool,
                           std::string stmt_name,
                           std::vector<std::string> params,
                           std::vector<bool> is_null,
                           bool use_bigint,
                           Local<Function> callback)
      : ThreadPoolWork(env, "postgres.executePrepared"),
        pool_(std::move(pool)),
        stmt_name_(std::move(stmt_name)),
        params_(std::move(params)),
        is_null_(std::move(is_null)),
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
    // See comment in the Execute variant above — cap at libpq's int16
    // nParams limit so a hostile caller can't OOM-abort this worker.
    if (params_.size() > 65535) {
      error_message_ = "Too many query parameters (limit: 65535)";
      return;
    }
    std::vector<const char*> param_values(params_.size());
    for (size_t i = 0; i < params_.size(); ++i) {
      // libpq treats nullptr as SQL NULL, empty-string as ''. JS
      // null/undefined must map to NULL, not empty string, or NOT NULL /
      // UNIQUE / FK constraints are silently violated.
      param_values[i] = is_null_[i] ? nullptr : params_[i].c_str();
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
      Local<Object> error_obj = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
      // Postgres server error messages are emitted in the server's
      // lc_messages locale, not guaranteed UTF-8. A hostile or
      // misconfigured server (zh_CN.GBK, de_DE.ISO-8859-1, …) can send
      // bytes that fail UTF-8 validation — fall back to a fixed ASCII
      // message so a bad error doesn't abort the isolate via
      // ToLocalChecked and turn recoverable SQL failures into process
      // kills.
      Local<String> msg_str;
      if (!String::NewFromUtf8(isolate, error_message_.c_str()).ToLocal(&msg_str)) {
        msg_str = FIXED_ONE_BYTE_STRING(isolate, "database error (non-UTF-8 message)");
      }
      error_obj->Set(context,
          FIXED_ONE_BYTE_STRING(isolate, "message"),
          msg_str).Check();
      if (!error_code_.empty()) {
        // SQLSTATE is five ASCII characters in practice, but treat
        // defensively: fall back to empty string on encoding failure.
        Local<String> code_str;
        if (!String::NewFromUtf8(isolate, error_code_.c_str()).ToLocal(&code_str)) {
          code_str = String::Empty(isolate);
        }
        error_obj->Set(context,
            FIXED_ONE_BYTE_STRING(isolate, "code"),
            code_str).Check();
      }
      argv[0] = error_obj;
      argv[1] = v8::Undefined(isolate);
    } else {
      argv[0] = v8::Undefined(isolate);
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
    // Turns a libpq PGresult into a JS array of row-objects.
    Isolate* isolate = env->isolate();
    Local<Context> context = env->context();

    Local<Object> obj = Object::New(isolate, Null(isolate), nullptr, nullptr, 0);
    ExecStatusType status = PQresultStatus(result);

    if (status == PGRES_TUPLES_OK) {
      int nrows = PQntuples(result);
      int ncols = PQnfields(result);

      // Column names and row values come from libpq as raw bytes in
      // the session's client_encoding. Non-UTF-8 encodings, BYTEA-as-
      // text casts, or corrupted rows produce bytes that fail UTF-8
      // validation — fall back to empty-string (columns) or Null
      // (values) so one malformed cell can't abort the isolate and
      // take down every concurrent query. Same policy as the sync
      // binding in postgres_binding.cc.
      Local<Array> columns = Array::New(isolate, ncols);
      for (int c = 0; c < ncols; ++c) {
        Local<String> col_str;
        if (!String::NewFromUtf8(isolate, PQfname(result, c)).ToLocal(&col_str)) {
          col_str = String::Empty(isolate);
        }
        columns->Set(context, c, col_str).Check();
      }
      obj->Set(context,
          FIXED_ONE_BYTE_STRING(isolate, "columns"),
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
              case 21:
              case 23:
                // INT2/INT4 — always fits in JS Number without loss.
                val = Number::New(isolate, std::strtoll(value, nullptr, 10));
                break;
              case 20: {
                // INT8 (64-bit PostgreSQL BIGINT). Values above 2^53
                // silently lose precision when stored as an IEEE 754
                // double (JS Number). The class-level `use_bigint_`
                // flag, set via the `useBigint` 4th arg to
                // queryParamsAsync, lets callers opt into a BigInt
                // return so user_id = 9007199254740993 survives a
                // round trip. Previously this flag was stored but
                // never consulted — every BIGINT read was a silent
                // off-by-one above 2^53.
                const int64_t v64 = std::strtoll(value, nullptr, 10);
                if (use_bigint_) {
                  val = BigInt::New(isolate, v64);
                } else {
                  val = Number::New(isolate, static_cast<double>(v64));
                }
                break;
              }
              case 700:
              case 701:
                val = Number::New(isolate, std::strtod(value, nullptr));
                break;
              default: {
                Local<String> s;
                if (!String::NewFromUtf8(isolate, value).ToLocal(&s)) {
                  val = v8::Null(isolate);
                } else {
                  val = s;
                }
                break;
              }
            }
          }
          row->Set(context, c, val).Check();
        }
        rows->Set(context, r, row).Check();
      }
      obj->Set(context,
          FIXED_ONE_BYTE_STRING(isolate, "rows"),
          rows).Check();
      obj->Set(context,
          FIXED_ONE_BYTE_STRING(isolate, "rowCount"),
          Integer::New(isolate, nrows)).Check();
    }

    return obj;
  }

  // Owning ref so an in-flight worker keeps the pool alive even if
  // JS concurrently destroyPool(id). The map entry is dropped
  // immediately; the pool itself is destroyed when the last holder
  // releases its shared_ptr. Prevents UAF on PGconn* during libpq call.
  std::shared_ptr<PostgresPool> pool_;
  std::string stmt_name_;
  std::vector<std::string> params_;
  // Parallel flags so the worker thread can distinguish SQL NULL
  // (libpq wants nullptr) from empty-string ('' literal). Without this
  // `params_[i] = ""` would silently violate NOT NULL / UNIQUE / FK.
  std::vector<bool> is_null_;
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
  // Utf8Value internal allocation can fail and leave *utf8 nullptr;
  // constructing std::string from nullptr is UB / SIGSEGV.
  if (*stmt_name == nullptr) {
    isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate,
            "Out of memory encoding prepared statement name").ToLocalChecked()));
    return;
  }

  if (!args[2]->IsArray()) {
    isolate->ThrowException(Exception::TypeError(
        String::NewFromUtf8(isolate, "Params must be array").ToLocalChecked()));
    return;
  }

  Local<Array> params_arr = args[2].As<Array>();
  // Cap params_arr->Length() BEFORE allocating the std::vector. A JS
  // caller passing `new Array(100_000_000)` would otherwise bad_alloc
  // the vector(size) constructor and std::terminate the process under
  // -fno-exceptions. The worker thread has its own 65535 cap but that's
  // too late — allocation happens here on the V8 thread.
  if (params_arr->Length() > 65535) {
    isolate->ThrowException(Exception::RangeError(
        String::NewFromUtf8(isolate,
            "Too many query parameters (limit: 65535)").ToLocalChecked()));
    return;
  }
  std::vector<std::string> params(params_arr->Length());
  std::vector<bool> is_null(params_arr->Length(), false);
  for (uint32_t i = 0; i < params_arr->Length(); ++i) {
    Local<Value> val;
    if (!params_arr->Get(context, i).ToLocal(&val) ||
        val->IsNullOrUndefined()) {
      // Treat Get-failure (Proxy trap) as NULL too — safer than
      // passing empty-string which silently violates NOT NULL/UNIQUE/FK.
      is_null[i] = true;
      continue;
    }
    String::Utf8Value utf8(isolate, val);
    // Guard against OOM during UTF-8 encoding — *utf8 can be nullptr.
    if (*utf8 == nullptr) {
      isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate,
              "Out of memory encoding query parameter").ToLocalChecked()));
      return;
    }
    params[i] = *utf8;
  }

  bool use_bigint = args[3]->BooleanValue(isolate);

  if (!args[4]->IsFunction()) {
    isolate->ThrowException(Exception::TypeError(
        String::NewFromUtf8(isolate, "Callback must be a function").ToLocalChecked()));
    return;
  }

  Local<Function> callback = args[4].As<Function>();

  auto* work = new (std::nothrow) ExecutePreparedAsyncWork(
      env,
      it->second,
      *stmt_name,
      std::move(params),
      std::move(is_null),
      use_bigint,
      callback);
  if (!work) {
    isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(isolate,
            "Out of memory: failed to allocate async query work").ToLocalChecked()));
    return;
  }

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

#pragma GCC diagnostic pop
