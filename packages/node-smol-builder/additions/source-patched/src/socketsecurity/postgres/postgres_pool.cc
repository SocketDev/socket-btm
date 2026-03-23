#include "socketsecurity/postgres/postgres_pool.h"
#include <algorithm>
#include <chrono>

namespace node {
namespace socketsecurity {
namespace postgres {

// PooledConnection implementation.

PooledConnection::PooledConnection(PGconn* conn)
    : conn_(conn),
      state_(ConnectionState::kIdle),
      created_at_(std::chrono::steady_clock::now()),
      last_used_at_(std::chrono::steady_clock::now()) {}

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
      last_used_at_(other.last_used_at_) {
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

  return new PooledConnection(pg_conn);
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

  // Remove from active list.
  auto it = std::find(active_connections_.begin(),
                      active_connections_.end(),
                      conn);
  if (it != active_connections_.end()) {
    active_connections_.erase(it);
  }

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
  {
    std::lock_guard<std::mutex> lock(mutex_);
    statement_sql_[name] = query;
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
