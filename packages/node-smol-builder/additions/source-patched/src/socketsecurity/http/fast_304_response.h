// ============================================================================
// fast_304_response.h — Optimized "304 Not Modified" response
// ============================================================================
//
// WHAT THIS FILE DOES
// Declares a class for sending HTTP 304 responses with an ETag header.
// A 304 ("Not Modified") tells the client: "nothing changed since you last
// asked — use your cached copy." It has no body, just headers. This is the
// cheapest possible HTTP response: ~60 bytes total.
//
// WHY IT EXISTS
// 304 responses are extremely common in package registries (where the same
// package metadata is requested repeatedly). Sending them through Node.js's
// full response pipeline wastes CPU on something that should be a few bytes.
// This class formats the 304 + ETag in a stack buffer and writes it directly
// to the socket with a single uv_write() call.
// ============================================================================

#ifndef SRC_SOCKETSECURITY_HTTP_PERF_FAST_304_RESPONSE_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_FAST_304_RESPONSE_H_

#include "env.h"
#include "v8.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

// Fast 304 Not Modified response.
class Fast304Response {
 public:
  // Send 304 response with ETag.
  static bool Write304(
      Environment* env,
      v8::Local<v8::Object> socket,
      const char* etag,
      size_t etag_length);

 private:
  // Pre-formatted 304 response template.
  static constexpr const char* kTemplate =
      "HTTP/1.1 304 Not Modified\r\n"
      "ETag: %s\r\n"
      "Cache-Control: public, max-age=3600\r\n"
      "\r\n";
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_FAST_304_RESPONSE_H_
