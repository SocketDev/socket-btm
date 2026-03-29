#ifndef SRC_SOCKETSECURITY_HTTP_PERF_HTTP_FAST_RESPONSE_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_HTTP_FAST_RESPONSE_H_

#include "v8.h"
#include "node.h"
#include "env.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

// Maximum size for stack-allocated response buffer.
// Matches the SINGLE_BUF_THRESHOLD in the JS layer (16KB).
static constexpr size_t kMaxResponseBuffer = 16384;

// Pre-computed static responses for common cases.
// These are written directly to the UV stream with zero allocation.
struct StaticResponse {
  const char* data;
  size_t length;
};

// Fast path for writing complete HTTP responses directly to the UV stream.
// Bypasses Node.js's Writable stream pipeline, Buffer allocation, and
// JavaScript function calls entirely. Uses uv_try_write() for a single
// synchronous syscall.
//
// Architecture (modeled after uWebSockets):
//   1. Build headers + body into a stack-allocated buffer
//   2. Get the UV stream handle from the JS socket's _handle
//   3. Call uv_try_write() — single syscall, zero heap allocation
class FastResponse {
 public:
  // Write complete JSON response (status + headers + body) via uv_try_write.
  // Returns true if the write succeeded, false if fallback to JS is needed.
  static bool WriteJson(
    Environment* env,
    v8::Local<v8::Object> socket,
    int status_code,
    const char* json_data,
    size_t json_length);

  // Write complete text response via uv_try_write.
  static bool WriteText(
    Environment* env,
    v8::Local<v8::Object> socket,
    int status_code,
    const char* text_data,
    size_t text_length);

  // Write complete binary response via uv_try_write.
  static bool WriteBinary(
    Environment* env,
    v8::Local<v8::Object> socket,
    int status_code,
    const uint8_t* data,
    size_t length,
    const char* content_type);

  // Write 304 Not Modified response (no body) via uv_try_write.
  static bool WriteNotModified(
    Environment* env,
    v8::Local<v8::Object> socket);

  // Write a pre-computed static response buffer via uv_try_write.
  // Used for HTTP_200_EMPTY, HTTP_404, HTTP_500, etc.
  static bool WritePrecomputed(
    Environment* env,
    v8::Local<v8::Object> socket,
    const char* data,
    size_t length);

 private:
  // Build complete HTTP response headers into buffer.
  // Returns number of bytes written, or 0 on failure.
  static size_t BuildHeaders(
    char* buffer,
    size_t buffer_size,
    int status_code,
    const char* content_type,
    size_t content_type_len,
    size_t content_length);

  // Get the uv_stream_t* from a JS socket object.
  // Goes through socket._handle -> StreamBase -> uv_stream_t.
  static uv_stream_t* GetUvStream(
    Environment* env,
    v8::Local<v8::Object> socket);

  // Write buffer directly to UV stream via uv_try_write.
  // Returns true if all bytes were written synchronously.
  static bool TryWrite(uv_stream_t* stream, const char* data, size_t length);

  // Write two buffers (headers + body) via uv_try_write with writev.
  static bool TryWrite2(uv_stream_t* stream,
                        const char* data1, size_t len1,
                        const char* data2, size_t len2);
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_HTTP_FAST_RESPONSE_H_
