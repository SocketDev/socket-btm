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
