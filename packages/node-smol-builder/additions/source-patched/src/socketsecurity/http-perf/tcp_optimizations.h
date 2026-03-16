#ifndef SRC_SOCKETSECURITY_HTTP_PERF_TCP_OPTIMIZATIONS_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_TCP_OPTIMIZATIONS_H_

#include "env.h"
#include "uv.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

// TCP socket optimizations for high performance.
class TcpOptimizations {
 public:
  // Enable TCP Fast Open (TFO) on server socket.
  // Reduces connection latency by 4-41% (1 RTT elimination).
  static bool EnableTcpFastOpen(uv_tcp_t* handle, int queue_length = 100);

  // Enable SO_REUSEPORT for multi-core load balancing.
  // Enables kernel-level connection distribution across cores.
  // Improves throughput by 15-25% on multi-core systems.
  static bool EnableReusePort(uv_tcp_t* handle);

  // Enable TCP_DEFER_ACCEPT to delay accept() until data arrives.
  // Reduces CPU cycles for connections that never send data.
  // 5-10% CPU reduction under attack scenarios.
  static bool EnableDeferAccept(uv_tcp_t* handle, int timeout_seconds = 30);

  // Enable TCP_NODELAY to disable Nagle's algorithm.
  // Reduces latency for small packets (already enabled by Node.js).
  static bool EnableTcpNoDelay(uv_tcp_t* handle);

  // Configure socket send/receive buffer sizes.
  static bool SetSocketBufferSizes(uv_tcp_t* handle,
                                   int send_buffer_size,
                                   int recv_buffer_size);

  // Enable all recommended TCP optimizations.
  static bool EnableAll(uv_tcp_t* handle);
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_TCP_OPTIMIZATIONS_H_
