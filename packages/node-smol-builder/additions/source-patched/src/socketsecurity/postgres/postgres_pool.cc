// ============================================================================
// postgres_pool.cc -- PostgreSQL connection pool implementation
// ============================================================================
//
// WHAT THIS FILE DOES
//   Implements PooledConnection (a single database connection wrapper)
//   and PostgresPool (a thread-safe pool of connections).
//
//   The pool pattern:
//     1. Initialize() creates min_connections upfront.
//     2. Acquire() hands out an idle connection (or creates one if room).
//     3. The caller runs queries via libpq on the connection.
//     4. Release() resets the connection and returns it to the idle list.
//     5. EvictStaleConnections() removes connections that have been idle
//        too long or exceeded their max lifetime.
//
// WHY IT EXISTS (C++ instead of pure JS)
//   The pool is called from both the main JS thread (sync queries in
//   postgres_binding.cc) and background libuv threads (async queries in
//   postgres_async.cc).  C++ mutexes provide correct synchronization
//   that would be difficult and error-prone in pure JS.  Additionally,
//   libpq's PGconn handles are C pointers that must be managed in C++.
//
// HOW JAVASCRIPT USES THIS
//   JS never touches PostgresPool directly.  The binding layer
//   (postgres_binding.cc) owns pools keyed by numeric ID.  When JS
//   calls binding.executeSync(poolId, sql), the binding looks up the
//   pool and calls pool->Execute(sql).
//
// PREPARED STATEMENT RE-PREPARATION
//   Prepared statements are per-connection in Postgres.  If connection A
//   prepared "getUser" but later dies, connection B does not know about
//   "getUser".  The pool solves this by keeping a pool-level map
//   (statement_sql_) of statement name -> SQL text.  When
//   ExecutePrepared() gets a connection that lacks the statement, it
//   re-prepares transparently using the stored SQL text.
//
// KEY C++ CONCEPTS USED HERE
//   PQconnectdb(connStr)
//     -- Opens a new TCP connection to Postgres.  Returns PGconn*.
//
//   PQexec(conn, sql) / PQexecParams / PQexecPrepared
//     -- libpq functions that send SQL to Postgres and return PGresult*.
//
//   std::lock_guard<std::mutex>
//     -- RAII lock: acquires mutex in constructor, releases in
//        destructor.  Guarantees the mutex is released even if an
//        exception occurs (though Node.js disables C++ exceptions).
//
//   std::deque (double-ended queue)
//     -- Used for idle_connections_ because we take from the front
//        (oldest connection first) and add to the back (most recently
//        used last), which helps EvictStaleConnections remove the
//        least-recently-used connections first.
// ============================================================================

#include "socketsecurity/postgres/postgres_pool.h"
#include <algorithm>
#include <atomic>
#include <new>
#include <chrono>

namespace node {
namespace socketsecurity {
namespace postgres {

// Monotonic identity-token counter. A 64-bit atomic so concurrent pool
// operations on different threads can't collide. Starts at 1 so token 0
// can be reserved for "no token" / default-constructed sentinel.
static std::atomic<uint64_t> g_next_conn_token{1};

// PooledConnection implementation.

PooledConnection::PooledConnection(PGconn* conn)
    : conn_(conn),
      state_(ConnectionState::kIdle),
      created_at_(std::chrono::steady_clock::now()),
      last_used_at_(std::chrono::steady_clock::now()),
      token_(g_next_conn_token.fetch_add(1, std::memory_order_relaxed)) {}

PooledConnection::~PooledConnection() {
  if (conn_ != nullptr) {
    PQfinish(conn_);
    conn_ = nullptr;
  }
}

PooledConnection::PooledConnection(PooledConnection&& other) noexcept
    : conn_(other.conn_),
      state_(other.state_),
      prepared_statements_(std::move(other.prepared_statements_)),
      created_at_(other.created_at_),
      last_used_at_(other.last_used_at_),
      token_(other.token_) {
  other.conn_ = nullptr;
  other.state_ = ConnectionState::kDead;
}

PooledConnection& PooledConnection::operator=(PooledConnection&& other) noexcept {
  if (this != &other) {
    if (conn_ != nullptr) {
      PQfinish(conn_);
    }
    conn_ = other.conn_;
    state_ = other.state_;
    prepared_statements_ = std::move(other.prepared_statements_);
    created_at_ = other.created_at_;
    last_used_at_ = other.last_used_at_;
    token_ = other.token_;
    other.conn_ = nullptr;
    other.state_ = ConnectionState::kDead;
  }
  return *this;
}

bool PooledConnection::IsAlive() const {
  if (conn_ == nullptr) {
    return false;
  }
  return PQstatus(conn_) == CONNECTION_OK;
}

bool PooledConnection::Reset() {
  if (conn_ == nullptr) {
    return false;
  }

  // Clear any pending results.
  PGresult* res = nullptr;
  while ((res = PQgetResult(conn_)) != nullptr) {
    PQclear(res);
  }

  // Check connection status.
  if (PQstatus(conn_) != CONNECTION_OK) {
    // Attempt reconnect.
    PQreset(conn_);
    if (PQstatus(conn_) != CONNECTION_OK) {
      return false;
    }
    // Clear prepared statement cache after reconnect.
    prepared_statements_.clear();
  }

  state_ = ConnectionState::kIdle;
  return true;
}

const char* PooledConnection::GetPreparedStatement(
    const std::string& name) const {
  auto it = prepared_statements_.find(name);
  if (it != prepared_statements_.end()) {
    return it->second.c_str();
  }
  return nullptr;
}

void PooledConnection::CachePreparedStatement(
    const std::string& name,
    const std::string& sql) {
  prepared_statements_[name] = sql;
}

// PostgresPool implementation.

PostgresPool::PostgresPool(const Config& config) : config_(config) {}

PostgresPool::~PostgresPool() {
  std::lock_guard<std::mutex> lock(mutex_);
  idle_connections_.clear();
  for (auto* conn : active_connections_) {
    delete conn;
  }
  active_connections_.clear();
}

bool PostgresPool::Initialize() {
  std::lock_guard<std::mutex> lock(mutex_);

  if (initialized_) {
    return true;
  }

  // Create minimum connections.
  for (size_t i = 0; i < config_.min_connections; ++i) {
    auto* conn = CreateConnection();
    if (conn != nullptr) {
      idle_connections_.push_back(std::unique_ptr<PooledConnection>(conn));
    }
  }

  initialized_ = !idle_connections_.empty();
  return initialized_;
}

PooledConnection* PostgresPool::CreateConnection() {
  // Build connection string with timeout.
  std::string conn_str = config_.connection_string;
  if (conn_str.find("connect_timeout") == std::string::npos) {
    conn_str += " connect_timeout=" +
                std::to_string(config_.connect_timeout_ms / 1000);
  }

  PGconn* pg_conn = PQconnectdb(conn_str.c_str());
  if (pg_conn == nullptr || PQstatus(pg_conn) != CONNECTION_OK) {
    if (pg_conn != nullptr) {
      PQfinish(pg_conn);
    }
    return nullptr;
  }

  // Enable binary protocol for efficiency.
  // Note: This is set per-query, not globally.

  auto* wrapper = new (std::nothrow) PooledConnection(pg_conn);
  if (wrapper == nullptr) {
    // Avoid leaking the libpq connection (holds a TCP socket fd + allocator
    // state) when the wrapper allocation OOMs. Repeated OOM without this
    // cleanup would exhaust the process's fd limit.
    PQfinish(pg_conn);
  }
  return wrapper;
}

void PostgresPool::DestroyConnection(PooledConnection* conn) {
  delete conn;
}

PooledConnection* PostgresPool::Acquire() {
  std::lock_guard<std::mutex> lock(mutex_);

  // Try to get an idle connection.
  while (!idle_connections_.empty()) {
    auto conn = std::move(idle_connections_.front());
    idle_connections_.pop_front();

    if (conn->IsAlive()) {
      conn->SetState(ConnectionState::kBusy);
      PooledConnection* raw_ptr = conn.release();
      active_connections_.push_back(raw_ptr);
      return raw_ptr;
    }
    // Connection is dead, discard it.
  }

  // No idle connections available.
  // Create new one if under max limit.
  size_t total = idle_connections_.size() + active_connections_.size();
  if (total < config_.max_connections) {
    auto* conn = CreateConnection();
    if (conn != nullptr) {
      conn->SetState(ConnectionState::kBusy);
      active_connections_.push_back(conn);
      return conn;
    }
  }

  // Pool exhausted.
  return nullptr;
}

void PostgresPool::Release(PooledConnection* conn) {
  if (conn == nullptr) {
    return;
  }

  std::lock_guard<std::mutex> lock(mutex_);

  // Remove from active list. If the connection doesn't belong to this pool
  // (not found in active_connections_), reject it to prevent cross-pool
  // pointer corruption from forged poolId values.
  auto it = std::find(active_connections_.begin(),
                      active_connections_.end(),
                      conn);
  if (it == active_connections_.end()) {
    return;  // Not our connection — ignore.
  }
  active_connections_.erase(it);

  // Reset and return to idle pool if healthy.
  if (conn->Reset()) {
    conn->TouchLastUsed();
    idle_connections_.push_back(std::unique_ptr<PooledConnection>(conn));
  } else {
    DestroyConnection(conn);
  }

  // Evict stale connections if pool is oversized.
  EvictStaleConnections();
}

bool PostgresPool::ReleaseByToken(PooledConnection* conn,
                                  uint64_t expected_token) {
  if (conn == nullptr) {
    return false;
  }
  std::lock_guard<std::mutex> lock(mutex_);

  // Under lock, find `conn` in our active list FIRST. If destroyPool()
  // ran between acquire and release, the raw pointer is freed and
  // std::find would be UB if we dereferenced. But list lookup compares
  // pointer identity without touching the underlying object.
  auto it = std::find(active_connections_.begin(),
                      active_connections_.end(),
                      conn);
  if (it == active_connections_.end()) {
    return false;
  }
  // Only NOW is it safe to dereference — the pointer is in our live
  // set, so the object hasn't been freed. Validate the token to catch
  // the address-reuse case (freed conn whose address was recycled into
  // a new PooledConnection in the same pool).
  if (conn->GetToken() != expected_token) {
    return false;
  }
  active_connections_.erase(it);
  if (conn->Reset()) {
    conn->TouchLastUsed();
    idle_connections_.push_back(std::unique_ptr<PooledConnection>(conn));
  } else {
    DestroyConnection(conn);
  }
  EvictStaleConnections();
  return true;
}

PGresult* PostgresPool::Execute(const char* query) {
  auto* conn = Acquire();
  if (conn == nullptr) {
    return nullptr;
  }

  PGresult* result = PQexec(conn->Get(), query);
  Release(conn);
  return result;
}

PGresult* PostgresPool::ExecuteParams(
    const char* query,
    int nParams,
    const Oid* paramTypes,
    const char* const* paramValues,
    const int* paramLengths,
    const int* paramFormats,
    int resultFormat) {
  auto* conn = Acquire();
  if (conn == nullptr) {
    return nullptr;
  }

  PGresult* result = PQexecParams(
    conn->Get(),
    query,
    nParams,
    paramTypes,
    paramValues,
    paramLengths,
    paramFormats,
    resultFormat);

  Release(conn);
  return result;
}

bool PostgresPool::Prepare(
    const char* name,
    const char* query,
    int nParams,
    const Oid* paramTypes) {
  // Store the SQL text at pool level so any connection can re-prepare later.
  // FIFO-evict once we hit the cap so a long-running process running
  // dynamic SQL can't grow the map indefinitely.
  {
    std::lock_guard<std::mutex> lock(mutex_);
    std::string name_str(name);
    auto existing = statement_sql_.find(name_str);
    if (existing == statement_sql_.end()) {
      while (statement_sql_order_.size() >= kMaxStatementCacheSize) {
        const std::string& evicted = statement_sql_order_.front();
        statement_sql_.erase(evicted);
        statement_sql_order_.pop_front();
      }
      statement_sql_order_.push_back(name_str);
    }
    statement_sql_[name_str] = query;
  }

  auto* conn = Acquire();
  if (conn == nullptr) {
    return false;
  }

  // Check if already prepared on this connection.
  if (conn->GetPreparedStatement(name) != nullptr) {
    Release(conn);
    return true;
  }

  PGresult* result = PQprepare(conn->Get(), name, query, nParams, paramTypes);
  bool success = PQresultStatus(result) == PGRES_COMMAND_OK;
  PQclear(result);

  if (success) {
    conn->CachePreparedStatement(name, query);
  }

  Release(conn);
  return success;
}

PGresult* PostgresPool::ExecutePrepared(
    const char* name,
    int nParams,
    const char* const* paramValues,
    const int* paramLengths,
    const int* paramFormats,
    int resultFormat) {
  auto* conn = Acquire();
  if (conn == nullptr) {
    return nullptr;
  }

  // If this connection does not have the statement prepared, re-prepare it.
  if (conn->GetPreparedStatement(name) == nullptr) {
    std::string sql_text;
    {
      std::lock_guard<std::mutex> lock(mutex_);
      auto it = statement_sql_.find(name);
      if (it != statement_sql_.end()) {
        sql_text = it->second;
      }
    }

    if (!sql_text.empty()) {
      PGresult* prep_result = PQprepare(
          conn->Get(), name, sql_text.c_str(), 0, nullptr);
      bool prep_ok = PQresultStatus(prep_result) == PGRES_COMMAND_OK;
      PQclear(prep_result);

      if (prep_ok) {
        conn->CachePreparedStatement(name, sql_text);
      } else {
        // Re-prepare failed; release and return error.
        Release(conn);
        return nullptr;
      }
    } else {
      // No SQL text found at pool level; cannot re-prepare.
      Release(conn);
      return nullptr;
    }
  }

  PGresult* result = PQexecPrepared(
    conn->Get(),
    name,
    nParams,
    paramValues,
    paramLengths,
    paramFormats,
    resultFormat);

  Release(conn);
  return result;
}

size_t PostgresPool::GetIdleCount() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return idle_connections_.size();
}

size_t PostgresPool::GetActiveCount() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return active_connections_.size();
}

size_t PostgresPool::GetTotalCount() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return idle_connections_.size() + active_connections_.size();
}

bool PostgresPool::IsHealthy() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return initialized_ && !idle_connections_.empty();
}

void PostgresPool::EvictStaleConnections() {
  auto now = std::chrono::steady_clock::now();
  auto idle_timeout = std::chrono::milliseconds(config_.idle_timeout_ms);
  auto max_lifetime = std::chrono::milliseconds(config_.max_lifetime_ms);

  // Remove connections that exceed idle timeout or max lifetime,
  // but keep at least min_connections.
  auto it = idle_connections_.begin();
  while (it != idle_connections_.end() &&
         idle_connections_.size() > config_.min_connections) {
    auto& conn = *it;
    auto idle_duration = now - conn->GetLastUsedAt();
    auto lifetime = now - conn->GetCreatedAt();

    if (idle_duration > idle_timeout || lifetime > max_lifetime) {
      it = idle_connections_.erase(it);
    } else {
      ++it;
    }
  }
}

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node
