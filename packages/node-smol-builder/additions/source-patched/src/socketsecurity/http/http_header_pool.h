#ifndef SRC_SOCKETSECURITY_HTTP_PERF_HTTP_HEADER_POOL_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_HTTP_HEADER_POOL_H_

#include "v8.h"
#include "node.h"
#include "env.h"

namespace node {
namespace socketsecurity {
namespace http_perf {

// Pre-allocated header pool for common HTTP headers.
// Reduces memory allocations during response header construction.
class HttpHeaderPool {
 public:
  explicit HttpHeaderPool(Environment* env);
  ~HttpHeaderPool();

  // Get a pre-allocated header name string.
  // Returns nullptr if not in pool.
  v8::Local<v8::String> GetHeaderName(const char* name) const;

  // Get a pre-allocated header value string for common values.
  // Returns nullptr if not in pool.
  v8::Local<v8::String> GetHeaderValue(const char* value) const;

  // Initialize the pool with common headers.
  void Initialize();

 private:
  Environment* env_;

  // Pre-allocated header name strings.
  v8::Eternal<v8::String> content_type_;
  v8::Eternal<v8::String> content_length_;
  v8::Eternal<v8::String> connection_;
  v8::Eternal<v8::String> date_;
  v8::Eternal<v8::String> server_;
  v8::Eternal<v8::String> cache_control_;
  v8::Eternal<v8::String> etag_;
  v8::Eternal<v8::String> last_modified_;
  v8::Eternal<v8::String> transfer_encoding_;
  v8::Eternal<v8::String> vary_;

  // Pre-allocated header value strings.
  v8::Eternal<v8::String> application_json_;
  v8::Eternal<v8::String> text_plain_;
  v8::Eternal<v8::String> keep_alive_;
  v8::Eternal<v8::String> close_;
  v8::Eternal<v8::String> chunked_;
  v8::Eternal<v8::String> no_cache_;
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_HTTP_HEADER_POOL_H_
