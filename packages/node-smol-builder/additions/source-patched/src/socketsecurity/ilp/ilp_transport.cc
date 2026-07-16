// ============================================================================
// ilp_transport.cc -- ILP TCP transport implementation
// ============================================================================
//
// WHAT THIS FILE DOES
//   Manages a TCP socket connection to an ILP-compatible time-series
//   database and sends the raw bytes produced by IlpEncoder.  It
//   handles DNS resolution, non-blocking connect with timeout,
//   TCP_NODELAY for low latency, and optional io_uring acceleration
//   on Linux.
//
// WHY IT EXISTS (C++ instead of pure JS)
//   Node.js's net module uses libuv under the hood and has overhead per
//   write (event-loop tick, Buffer allocation, etc.).  This transport
//   sends the encoder's buffer directly via the OS send() call -- a
//   single copy from user space to kernel space.  On Linux, io_uring
//   further reduces overhead by batching sends without system-call
//   context switches.
//
// HOW JAVASCRIPT USES THIS
//   IlpTransport is owned by IlpBinding::SenderState.  When JS calls
//   flush(), IlpBinding::Flush reads the encoder buffer and calls
//   transport->Send(data, len).
//
// CONNECTION LIFECYCLE
//   1. Connect()  -- resolves host via getaddrinfo, creates a TCP socket,
//                    connects with a timeout, enables TCP_NODELAY.
//   2. Send()     -- sends data, retrying on EINTR/EAGAIN.  On Linux
//                    with io_uring, large writes (>4KB) go through the
//                    ring for better throughput.
//   3. Close()    -- shuts down the socket and cleans up io_uring.
//
// KEY C++ CONCEPTS USED HERE
//   struct addrinfo
//     -- The result of DNS resolution.  Contains IP addresses the host
//        name resolved to.  We try each address until one connects.
//
//   BSD_CLOSE_SOCK / BSD_GET_SOCK_ERROR / BsdSetNonBlocking
//     -- Cross-platform wrappers from bsdsock_compat.h.  Windows uses
//        Winsock (closesocket, WSAGetLastError), Unix uses POSIX
//        (close, errno).  These macros hide the difference.
//
//   io_uring (Linux only)
//     -- A kernel ring buffer for async I/O.  io_uring_prep_send() puts
//        a send request on the submission queue, io_uring_submit() tells
//        the kernel, and io_uring_wait_cqe() waits for completion.
//        Falls back to regular send() on macOS/Windows/old Linux.
// ============================================================================

#include "socketsecurity/ilp/ilp_transport.h"

#include <cerrno>
#include <cstring>

#ifdef HAVE_IOURING
#include <liburing.h>
#endif

// Use BSD socket compatibility layer from build-infra.
// Provides: socket_handle_t, BSD_GET_SOCK_ERROR(), BSD_CLOSE_SOCK(), etc.
// Already included via ilp_transport.h -> bsdsock_compat.h

namespace node {
namespace socketsecurity {
namespace ilp {

IlpTransport::IlpTransport(const TransportConfig& config)
    : config_(config),
      socket_fd_(SOCKET_HANDLE_INVALID),
      connected_(false)
#ifdef HAVE_IOURING
      , ring_(nullptr)
      , io_uring_available_(false)
#endif
{
  BSD_ENSURE_WINSOCK_INIT();
}

IlpTransport::~IlpTransport() {
  Close();
}

bool IlpTransport::Connect() {
  std::lock_guard<std::mutex> lock(send_mutex_);

  if (connected_.load(std::memory_order_acquire)) {
    return true;
  }

  if (!ConnectSocket()) {
    return false;
  }

#ifdef HAVE_IOURING
  if (config_.use_io_uring) {
    io_uring_available_ = InitIoUring();
    if (io_uring_available_) {
      send_buffer_.resize(config_.send_buffer_size);
    }
  }
#endif

  connected_.store(true, std::memory_order_release);
  return true;
}

void IlpTransport::Close() {
  std::lock_guard<std::mutex> lock(send_mutex_);

  connected_.store(false, std::memory_order_release);

#ifdef HAVE_IOURING
  CleanupIoUring();
#endif

  CloseSocket();
}

bool IlpTransport::Reconnect() {
  Close();
  return Connect();
}

bool IlpTransport::ConnectSocket() {
  struct addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  hints.ai_protocol = IPPROTO_TCP;

  char port_str[16];
  std::snprintf(port_str, sizeof(port_str), "%u", config_.port);

  struct addrinfo* result = nullptr;
  int status = getaddrinfo(config_.host.c_str(), port_str, &hints, &result);
  if (status != 0) {
#ifdef _WIN32
    last_error_ = std::string("DNS resolution failed: error ") + std::to_string(status);
#else
    last_error_ = std::string("DNS resolution failed: ") + gai_strerror(status);
#endif
    return false;
  }

  for (struct addrinfo* p = result; p != nullptr; p = p->ai_next) {
#ifdef _WIN32
    SOCKET raw_sock = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
    if (raw_sock == INVALID_SOCKET) {
      continue;
    }
    socket_fd_ = static_cast<socket_handle_t>(raw_sock);
#else
    socket_fd_ = socket(p->ai_family, p->ai_socktype, p->ai_protocol);
    if (socket_fd_ == SOCKET_HANDLE_INVALID) {
      continue;
    }
#endif

    // Set non-blocking for connect with timeout.
    if (!BsdSetNonBlocking(socket_fd_, true)) {
      BSD_CLOSE_SOCK(socket_fd_);
      socket_fd_ = SOCKET_HANDLE_INVALID;
      continue;
    }

#ifdef _WIN32
    int conn_result = connect(BSD_SOCKET_CAST(socket_fd_), p->ai_addr, static_cast<int>(p->ai_addrlen));
    int last_err = BSD_GET_SOCK_ERROR();
    bool in_progress = (conn_result == SOCKET_ERROR && last_err == BSD_IN_PROGRESS);
#else
    int conn_result = connect(socket_fd_, p->ai_addr, p->ai_addrlen);
    int last_err = BSD_GET_SOCK_ERROR();
    bool in_progress = (conn_result < 0 && last_err == BSD_IN_PROGRESS);
#endif

    if (conn_result != 0 && !in_progress) {
      BSD_CLOSE_SOCK(socket_fd_);
      socket_fd_ = SOCKET_HANDLE_INVALID;
      continue;
    }

    if (in_progress) {
      // Wait for connection with timeout.
      int poll_result = BsdPollSocket(socket_fd_, POLLOUT, config_.connect_timeout_ms);
      if (poll_result <= 0) {
        BSD_CLOSE_SOCK(socket_fd_);
        socket_fd_ = SOCKET_HANDLE_INVALID;
        continue;
      }

      // Check for connection error.
      int error = 0;
      socklen_t len = sizeof(error);
      if (getsockopt(BSD_SOCKET_CAST(socket_fd_), SOL_SOCKET, SO_ERROR,
                     reinterpret_cast<char*>(&error), &len) < 0 || error != 0) {
        BSD_CLOSE_SOCK(socket_fd_);
        socket_fd_ = SOCKET_HANDLE_INVALID;
        continue;
      }
    }

    // Connection successful. Set back to blocking and configure.
    BsdSetNonBlocking(socket_fd_, false);

    // Enable TCP_NODELAY for low latency.
    int yes = 1;
    setsockopt(BSD_SOCKET_CAST(socket_fd_), IPPROTO_TCP, TCP_NODELAY,
               reinterpret_cast<const char*>(&yes), sizeof(yes));

    // Set send buffer size.
    int bufsize = static_cast<int>(config_.send_buffer_size);
    setsockopt(BSD_SOCKET_CAST(socket_fd_), SOL_SOCKET, SO_SNDBUF,
               reinterpret_cast<const char*>(&bufsize), sizeof(bufsize));

    freeaddrinfo(result);
    return true;
  }

  freeaddrinfo(result);
  last_error_ = "Failed to connect to any resolved address";
  return false;
}

void IlpTransport::CloseSocket() {
  if (socket_fd_ != SOCKET_HANDLE_INVALID) {
    BSD_CLOSE_SOCK(socket_fd_);
    socket_fd_ = SOCKET_HANDLE_INVALID;
  }
}

ssize_t IlpTransport::Send(const char* data, size_t len) {
  if (!connected_.load(std::memory_order_acquire)) {
    last_error_ = "Not connected";
    return -1;
  }

  std::lock_guard<std::mutex> lock(send_mutex_);

#ifdef HAVE_IOURING
  if (io_uring_available_) {
    return SendWithIoUring(data, len);
  }
#endif

  return SendWithSocket(data, len);
}

ssize_t IlpTransport::SendWithSocket(const char* data, size_t len) {
  size_t sent = 0;

  while (sent < len) {
#ifdef _WIN32
    int n = ::send(BSD_SOCKET_CAST(socket_fd_), data + sent, static_cast<int>(len - sent), 0);
#else
    ssize_t n = ::send(socket_fd_, data + sent, len - sent, MSG_NOSIGNAL);
#endif
    if (n < 0) {
      int last_err = BSD_GET_SOCK_ERROR();
      if (last_err == BSD_INTERRUPTED) {
        continue;
      }
      if (last_err == BSD_WOULD_BLOCK
#ifndef _WIN32
          || last_err == EWOULDBLOCK
#endif
      ) {
        // Wait for socket to become writable.
        int poll_result = BsdPollSocket(socket_fd_, POLLOUT, config_.send_timeout_ms);
        if (poll_result <= 0) {
          last_error_ = "Send timeout";
          connected_.store(false, std::memory_order_release);
          return -1;
        }
        continue;
      }
#ifdef _WIN32
      last_error_ = std::string("Send failed: error ") + std::to_string(last_err);
#else
      last_error_ = std::string("Send failed: ") + strerror(last_err);
#endif
      connected_.store(false, std::memory_order_release);
      return -1;
    }
    sent += static_cast<size_t>(n);
  }

  return static_cast<ssize_t>(sent);
}

#ifdef HAVE_IOURING

bool IlpTransport::InitIoUring() {
  // Node.js compiles with -fno-exceptions, so a throwing `new` aborts the
  // whole process on OOM. std::nothrow lets the caller degrade gracefully
  // back to the non-iouring path instead.
  ring_ = new (std::nothrow) io_uring;
  if (ring_ == nullptr) {
    return false;
  }

  // Initialize io_uring with small queue depth for ILP writes.
  int ret = io_uring_queue_init(64, ring_, 0);
  if (ret < 0) {
    delete ring_;
    ring_ = nullptr;
    return false;
  }

  // Register the socket file descriptor.
  int fd = static_cast<int>(socket_fd_);
  ret = io_uring_register_files(ring_, &fd, 1);
  if (ret < 0) {
    // File registration failed, but io_uring can still work.
    // Just won't have the optimization.
  }

  return true;
}

void IlpTransport::CleanupIoUring() {
  if (ring_ != nullptr) {
    io_uring_queue_exit(ring_);
    delete ring_;
    ring_ = nullptr;
  }
  io_uring_available_ = false;
}

ssize_t IlpTransport::SendWithIoUring(const char* data, size_t len) {
  // For small writes, use standard send to avoid io_uring overhead.
  if (len < 4096) {
    return SendWithSocket(data, len);
  }

  size_t sent = 0;

  while (sent < len) {
    size_t chunk = len - sent;
    if (chunk > send_buffer_.size()) {
      chunk = send_buffer_.size();
    }

    // Copy to aligned buffer for io_uring.
    std::memcpy(send_buffer_.data(), data + sent, chunk);

    // Submit send request.
    struct io_uring_sqe* sqe = io_uring_get_sqe(ring_);
    if (sqe == nullptr) {
      // SQ full, fall back to regular send.
      ssize_t n = SendWithSocket(data + sent, len - sent);
      if (n < 0) return -1;
      return static_cast<ssize_t>(sent) + n;
    }

    io_uring_prep_send(sqe, static_cast<int>(socket_fd_), send_buffer_.data(), chunk, MSG_NOSIGNAL);
    sqe->user_data = chunk;

    int ret = io_uring_submit(ring_);
    if (ret < 0) {
      last_error_ = "io_uring submit failed";
      return -1;
    }

    // Wait for completion.
    struct io_uring_cqe* cqe;
    ret = io_uring_wait_cqe(ring_, &cqe);
    if (ret < 0) {
      last_error_ = "io_uring wait failed";
      connected_.store(false, std::memory_order_release);
      return -1;
    }

    if (cqe->res < 0) {
      last_error_ = std::string("io_uring send failed: ") + strerror(-cqe->res);
      io_uring_cqe_seen(ring_, cqe);
      connected_.store(false, std::memory_order_release);
      return -1;
    }

    sent += static_cast<size_t>(cqe->res);
    io_uring_cqe_seen(ring_, cqe);
  }

  return static_cast<ssize_t>(sent);
}

#endif  // HAVE_IOURING

}  // namespace ilp
}  // namespace socketsecurity
}  // namespace node
