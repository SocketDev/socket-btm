#include "socketsecurity/http-perf/tcp_optimizations.h"

#ifndef _WIN32
#include <sys/socket.h>
#include <netinet/tcp.h>
#endif

namespace node {
namespace socketsecurity {
namespace http_perf {

bool TcpOptimizations::EnableTcpFastOpen(uv_tcp_t* handle, int queue_length) {
  uv_os_fd_t fd;
  if (uv_fileno(reinterpret_cast<uv_handle_t*>(handle), &fd) < 0) {
    return false;
  }

#ifdef __linux__
  // Linux: TCP_FASTOPEN with queue length.
  // Requires kernel 3.6+ (server), 3.13+ (client).
  if (setsockopt(fd, SOL_TCP, TCP_FASTOPEN, &queue_length,
                 sizeof(queue_length)) < 0) {
    // Graceful fallback if kernel doesn't support TFO.
    return false;
  }
  return true;
#elif defined(__APPLE__)
  // macOS: TCP_FASTOPEN with flag (10.11+).
  int enable = 1;
  if (setsockopt(fd, IPPROTO_TCP, TCP_FASTOPEN, &enable, sizeof(enable)) < 0) {
    return false;
  }
  return true;
#else
  // Unsupported platform.
  return false;
#endif
}

bool TcpOptimizations::EnableReusePort(uv_tcp_t* handle) {
  uv_os_fd_t fd;
  if (uv_fileno(reinterpret_cast<uv_handle_t*>(handle), &fd) < 0) {
    return false;
  }

#if defined(SO_REUSEPORT)
  // Enable SO_REUSEPORT for kernel-level load balancing.
  // Requires Linux 3.9+ or recent BSDs.
  int enable = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &enable, sizeof(enable)) < 0) {
    // Not supported on this platform.
    return false;
  }
  return true;
#else
  // SO_REUSEPORT not available.
  return false;
#endif
}

bool TcpOptimizations::EnableDeferAccept(uv_tcp_t* handle, int timeout_seconds) {
  uv_os_fd_t fd;
  if (uv_fileno(reinterpret_cast<uv_handle_t*>(handle), &fd) < 0) {
    return false;
  }

#ifdef TCP_DEFER_ACCEPT
  // Linux only: delay accept() until data arrives.
  if (setsockopt(fd, IPPROTO_TCP, TCP_DEFER_ACCEPT, &timeout_seconds,
                 sizeof(timeout_seconds)) < 0) {
    return false;
  }
  return true;
#else
  // Not supported on this platform.
  return false;
#endif
}

bool TcpOptimizations::EnableTcpNoDelay(uv_tcp_t* handle) {
  // Note: Node.js already enables TCP_NODELAY by default.
  // This is here for completeness.
  return uv_tcp_nodelay(handle, 1) == 0;
}

bool TcpOptimizations::SetSocketBufferSizes(uv_tcp_t* handle,
                                            int send_buffer_size,
                                            int recv_buffer_size) {
  bool success = true;

  // Use libuv's cross-platform buffer size API.
  if (send_buffer_size > 0) {
    int size = send_buffer_size;
    if (uv_send_buffer_size(reinterpret_cast<uv_handle_t*>(handle), &size) < 0) {
      success = false;
    }
  }

  if (recv_buffer_size > 0) {
    int size = recv_buffer_size;
    if (uv_recv_buffer_size(reinterpret_cast<uv_handle_t*>(handle), &size) < 0) {
      success = false;
    }
  }

  return success;
}

bool TcpOptimizations::EnableAll(uv_tcp_t* handle) {
  // Enable all recommended optimizations.
  // Gracefully handle failures (some may not be supported).

  bool tfo = EnableTcpFastOpen(handle);
  bool reuseport = EnableReusePort(handle);
  bool defer = EnableDeferAccept(handle);
  bool nodelay = EnableTcpNoDelay(handle);

  // Set buffer sizes to 256KB (optimal for high-throughput).
  bool buffers = SetSocketBufferSizes(handle, 262144, 262144);

  // Return true if at least some optimizations succeeded.
  return tfo || reuseport || defer || nodelay || buffers;
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
