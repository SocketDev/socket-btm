// ============================================================================
// postgres_pool.h -- Header for the PostgreSQL connection pool
// ============================================================================
//
// WHAT THIS FILE DECLARES
//   PooledConnection -- a single database connection with state tracking
//                       and a cache of prepared statements.
//   PostgresPool     -- manages a pool of PooledConnections.
//
// WHY A CONNECTION POOL?
//   Opening a new PostgreSQL connection is expensive (~100ms for TCP +
//   TLS + authentication).  A pool keeps several connections open and
//   reuses them.  When JS calls pool.Execute("SELECT ..."), the pool:
//     1. Grabs an idle connection (or creates a new one if under limit).
//     2. Runs the query on that connection.
//     3. Returns the connection to the idle list for the next caller.
//   This makes repeated queries fast (sub-millisecond overhead).
//
// PREPARED STATEMENTS
//   A prepared statement is a SQL query that has been parsed and planned
//   by Postgres once, then executed many times with different parameters.
//   Example:
//     PREPARE get_user AS SELECT * FROM users WHERE id = $1;
//     EXECUTE get_user(42);   -- fast, skips parsing
//     EXECUTE get_user(99);   -- fast again
//
//   The pool caches which statements have been prepared on each
//   connection.  If a connection dies and a new one takes its place,
//   the pool transparently re-prepares the statement on the new
//   connection (using the pool-level statement_sql_ map).
//
// THREAD SAFETY
//   All pool operations are guarded by mutex_.  The pool is called from
//   both the main JS thread (sync queries) and the libuv thread pool
//   (async queries from postgres_async.cc).
//
// KEY C++ CONCEPTS USED HERE
//   PGconn*
//     -- A libpq connection handle.  Represents one TCP connection to
//        the Postgres server.  Created by PQconnectdb(), freed by
//        PQfinish().
//
//   std::deque<std::unique_ptr<PooledConnection>> idle_connections_
//     -- A double-ended queue of idle connections.  Connections are
//        taken from the front (FIFO) and returned to the back.
//
//   std::mutex
//     -- A lock that ensures only one thread modifies the pool at a
//        time.  std::lock_guard<std::mutex> acquires the lock in its
//        constructor and releases it in its destructor (RAII pattern).
//
//   std::chrono::steady_clock
//     -- A monotonic clock for measuring idle time and connection
//        lifetime (never affected by system clock changes).
// ============================================================================
#ifndef SRC_SOCKETSECURITY_POSTGRES_POSTGRES_POOL_H_
#define SRC_SOCKETSECURITY_POSTGRES_POSTGRES_POOL_H_

#include "env.h"
#include "v8.h"
#include <libpq-fe.h>
#include <chrono>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace node {
namespace socketsecurity {
namespace postgres {

// Connection state tracking.
enum class ConnectionState {
  kIdle,
  kBusy,
  kDead
};

// A single pooled PostgreSQL connection.
class PooledConnection {
 public:
  explicit PooledConnection(PGconn* conn);
  ~PooledConnection();

  // Non-copyable.
  PooledConnection(const PooledConnection&) = delete;
  PooledConnection& operator=(const PooledConnection&) = delete;

  // Move semantics.
  PooledConnection(PooledConnection&& other) noexcept;
  PooledConnection& operator=(PooledConnection&& other) noexcept;

  PGconn* Get() const { return conn_; }
  ConnectionState GetState() const { return state_; }
  void SetState(ConnectionState state) { state_ = state; }

  // Unique identity token set at construction. Used by the JS binding
  // to detect stale External handles — if destroyPool() runs before
  // releaseConnection(), the raw pointer in the External is dangling
  // and an address-reuse could silently match a different connection's
  // new allocation. Token comparison rejects the mismatch.
  uint64_t GetToken() const { return token_; }

  // Check if connection is still valid.
  bool IsAlive() const;

  // Reset connection for reuse.
  bool Reset();

  // Get cached prepared statement handle.
  const char* GetPreparedStatement(const std::string& name) const;
  void CachePreparedStatement(const std::string& name, const std::string& sql);

  // Timestamp tracking.
  std::chrono::steady_clock::time_point GetCreatedAt() const { return created_at_; }
  std::chrono::steady_clock::time_point GetLastUsedAt() const { return last_used_at_; }
  void TouchLastUsed() {
    last_used_at_ = std::chrono::steady_clock::now();
  }

 private:
  PGconn* conn_;
  ConnectionState state_;
  std::unordered_map<std::string, std::string> prepared_statements_;
  std::chrono::steady_clock::time_point created_at_;
  std::chrono::steady_clock::time_point last_used_at_;
  uint64_t token_;
};

// High-performance connection pool with prepared statement caching.
class PostgresPool {
 public:
  struct Config {
    std::string connection_string;
    size_t min_connections = 2;
    size_t max_connections = 10;
    int connect_timeout_ms = 10000;
    int idle_timeout_ms = 60000;
    int max_lifetime_ms = 3600000;
  };

  explicit PostgresPool(const Config& config);
  ~PostgresPool();

  // Non-copyable.
  PostgresPool(const PostgresPool&) = delete;
  PostgresPool& operator=(const PostgresPool&) = delete;

  // Initialize pool with minimum connections.
  bool Initialize();

  // Acquire a connection from the pool.
  // Returns nullptr if pool is exhausted and max connections reached.
  PooledConnection* Acquire();

  // Release a connection back to the pool.
  void Release(PooledConnection* conn);

  // Release variant that validates an identity token under the pool's
  // mutex BEFORE dereferencing `conn`. The V8 binding passes a token
  // captured at Acquire time; if destroyPool() ran between acquire and
  // release, the raw pointer is freed and reading `conn->GetToken()`
  // on the binding thread would be UB. This variant scans
  // active_connections_ under lock and only touches `conn` if the
  // token matches a live entry. Returns true on success, false on
  // stale-pointer (no-op).
  bool ReleaseByToken(PooledConnection* conn, uint64_t expected_token);

  // Execute a simple query (no parameters).
  PGresult* Execute(const char* query);

  // Execute with parameters (binary protocol for efficiency).
  PGresult* ExecuteParams(
    const char* query,
    int nParams,
    const Oid* paramTypes,
    const char* const* paramValues,
    const int* paramLengths,
    const int* paramFormats,
    int resultFormat);

  // Prepare a statement for repeated execution.
  // Stores SQL text at pool level so any connection can re-prepare.
  bool Prepare(
    const char* name,
    const char* query,
    int nParams,
    const Oid* paramTypes);

  // Execute a prepared statement.
  // If the acquired connection does not have the statement prepared,
  // it will be re-prepared transparently using the pool-level SQL map.
  PGresult* ExecutePrepared(
    const char* name,
    int nParams,
    const char* const* paramValues,
    const int* paramLengths,
    const int* paramFormats,
    int resultFormat);

  // Pool statistics.
  size_t GetIdleCount() const;
  size_t GetActiveCount() const;
  size_t GetTotalCount() const;

  // Health check.
  bool IsHealthy() const;

 private:
  PooledConnection* CreateConnection();
  void DestroyConnection(PooledConnection* conn);
  void EvictStaleConnections();

  Config config_;
  std::deque<std::unique_ptr<PooledConnection>> idle_connections_;
  std::vector<PooledConnection*> active_connections_;
  mutable std::mutex mutex_;
  bool initialized_ = false;
  // Pool-level map of statement_name -> sql_text so any connection can
  // re-prepare a statement that was originally prepared on a different one.
  // Bounded via kMaxStatementCacheSize so long-running processes with
  // dynamic SQL don't leak unbounded. Eviction is FIFO (order_ carries
  // insertion order); evicted names are not DEALLOCATED on live connections
  // because tracking per-conn liveness across the whole pool is expensive
  // and the JS adapter's 500-entry LRU avoids reusing evicted names anyway.
  static constexpr size_t kMaxStatementCacheSize = 500;
  std::unordered_map<std::string, std::string> statement_sql_;
  std::deque<std::string> statement_sql_order_;
};

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_POSTGRES_POSTGRES_POOL_H_
