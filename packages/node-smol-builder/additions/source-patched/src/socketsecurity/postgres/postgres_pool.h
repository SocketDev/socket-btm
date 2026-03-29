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
  std::unordered_map<std::string, std::string> statement_sql_;
};

}  // namespace postgres
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_POSTGRES_POSTGRES_POOL_H_
