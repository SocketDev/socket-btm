#ifndef SRC_SOCKETSECURITY_HTTP_PERF_HTTP_FAST_RESPONSE_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_HTTP_FAST_RESPONSE_H_

#include "v8.h"
#include "node.h"
#include "env.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

// Fast path for writing complete HTTP responses directly to socket.
// Bypasses Node.js HTTP stack for maximum performance on hot paths.
class FastResponse {
 public:
  // Write complete JSON response (status + headers + body) in single syscall.
  // Returns true if fast path was used, false if fallback needed.
  static bool WriteJson(
    Environment* env,
    v8::Local<v8::Object> socket,
    int status_code,
    const char* json_data,
    size_t json_length);

  // Write complete binary response (status + headers + body) in single syscall.
  // Used for tarball downloads.
  static bool WriteBinary(
    Environment* env,
    v8::Local<v8::Object> socket,
    int status_code,
    const uint8_t* data,
    size_t length,
    const char* content_type);

  // Write 304 Not Modified response (no body).
  static bool WriteNotModified(
    Environment* env,
    v8::Local<v8::Object> socket);

 private:
  // Build complete HTTP response in single buffer.
  static bool BuildResponse(
    char* buffer,
    size_t buffer_size,
    size_t* out_length,
    int status_code,
    const char* content_type,
    size_t content_length);
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_HTTP_FAST_RESPONSE_H_
