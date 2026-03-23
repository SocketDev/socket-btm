#ifndef SRC_SOCKETSECURITY_ILP_ILP_TRANSPORT_H_
#define SRC_SOCKETSECURITY_ILP_ILP_TRANSPORT_H_

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

// Cross-platform BSD socket compatibility (socket_handle_t, SOCKET_HANDLE_INVALID).
#include "socketsecurity/build-infra/bsdsock_compat.h"

// Forward declare io_uring when available.
// Define HAVE_IOURING at build time when liburing is available.
#ifdef HAVE_IOURING
struct io_uring;
#endif

namespace node {
namespace socketsecurity {
namespace ilp {

// Transport configuration.
struct TransportConfig {
  std::string host = "localhost";
  uint16_t port = 9009;
  int connect_timeout_ms = 10000;
  int send_timeout_ms = 30000;
  size_t send_buffer_size = 65536;
  bool use_io_uring = true;  // Falls back to standard sockets if unavailable.
};

// High-performance TCP transport with optional io_uring acceleration.
// Cross-platform: Works on Windows (Winsock2), macOS (BSD sockets), Linux (POSIX + io_uring).
// io_uring is Linux-only; other platforms use standard sockets.
class IlpTransport {
 public:
  explicit IlpTransport(const TransportConfig& config);
  ~IlpTransport();

  // Non-copyable.
  IlpTransport(const IlpTransport&) = delete;
  IlpTransport& operator=(const IlpTransport&) = delete;

  // Connection management.
  bool Connect();
  void Close();
  bool Reconnect();

  // Send data synchronously.
  // Returns number of bytes sent, or -1 on error.
  ssize_t Send(const char* data, size_t len);

  // State queries.
  bool IsConnected() const { return connected_.load(std::memory_order_acquire); }
  bool IsIoUringAvailable() const { return io_uring_available_; }
  const char* LastError() const { return last_error_.c_str(); }

 private:
  bool ConnectSocket();
  void CloseSocket();

#ifdef HAVE_IOURING
  bool InitIoUring();
  void CleanupIoUring();
  ssize_t SendWithIoUring(const char* data, size_t len);
#endif

  ssize_t SendWithSocket(const char* data, size_t len);

  TransportConfig config_;
  socket_handle_t socket_fd_;
  std::atomic<bool> connected_;
  std::string last_error_;

#ifdef HAVE_IOURING
  io_uring* ring_;
  bool io_uring_available_;
  std::vector<char> send_buffer_;
#else
  static constexpr bool io_uring_available_ = false;
#endif

  mutable std::mutex send_mutex_;
};

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_ILP_ILP_TRANSPORT_H_
