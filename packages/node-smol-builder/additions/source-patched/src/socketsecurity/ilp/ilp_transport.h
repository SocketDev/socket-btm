// ============================================================================
// ilp_transport.h -- Header for the ILP TCP transport layer
// ============================================================================
//
// WHAT THIS FILE DECLARES
//   IlpTransport -- manages a TCP socket connection to an ILP-compatible
//   database (QuestDB, InfluxDB, etc.) and sends encoded line-protocol
//   data over the wire.
//
// WHY C++ INSTEAD OF JAVASCRIPT
//   The transport needs precise control over:
//     - Non-blocking connect with timeout (to avoid hanging).
//     - TCP_NODELAY (disable Nagle's algorithm for low-latency writes).
//     - io_uring on Linux (a kernel API that submits I/O without
//       system-call overhead -- can double throughput for large writes).
//   None of these are exposed through Node.js's net module at the level
//   of control needed here.
//
// HOW JAVASCRIPT USES THIS
//   IlpTransport is not exposed to JS directly.  IlpBinding owns one
//   transport per "sender".  When JS calls flush(), the binding calls
//   transport->Send(encoder->Data(), encoder->Size()).
//
// KEY C++ CONCEPTS USED HERE
//   socket_handle_t
//     -- A cross-platform type for a raw OS socket (int on Unix, SOCKET
//        on Windows).  Comes from bsdsock_compat.h.
//
//   std::atomic<bool> connected_
//     -- A thread-safe boolean.  The send path checks this without
//        locking the mutex, which is safe because atomics guarantee
//        visibility across threads.
//
//   std::mutex send_mutex_
//     -- Ensures only one thread sends at a time (important when
//        auto-flush timers fire concurrently with manual flushes).
//
//   io_uring (Linux only)
//     -- A modern Linux kernel API for asynchronous I/O.  Instead of
//        calling send() (which involves a system call each time),
//        io_uring lets you submit a batch of sends and the kernel
//        processes them without context switches.  Falls back to
//        regular send() on macOS/Windows or older Linux kernels.
// ============================================================================
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
