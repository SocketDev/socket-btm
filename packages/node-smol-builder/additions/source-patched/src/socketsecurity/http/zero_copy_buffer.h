#ifndef SRC_SOCKETSECURITY_HTTP_PERF_ZERO_COPY_BUFFER_H_
#define SRC_SOCKETSECURITY_HTTP_PERF_ZERO_COPY_BUFFER_H_

#include "env.h"
#include "v8.h"
#include <vector>

namespace node {
namespace socketsecurity {
namespace http_perf {

// Zero-copy buffer management for HTTP responses.
// Uses external V8 strings backed by pre-allocated memory pools.
class ZeroCopyBuffer {
 public:
  explicit ZeroCopyBuffer(Environment* env);
  ~ZeroCopyBuffer();

  // Create external string backed by pooled memory (zero-copy).
  v8::Local<v8::String> CreateExternalString(
    const char* data,
    size_t length);

  // Acquire buffer from pool. Returns nullptr on malloc failure — callers MUST null-check.
  char* AcquireBuffer(size_t size);

  // Release buffer back to pool.
  void ReleaseBuffer(char* buffer);

  // Get pool statistics.
  size_t GetPoolSize() const { return buffer_pool_.size(); }

 private:
  Environment* env_;

  // Buffer pool (reusable memory blocks).
  static const size_t kBufferSize = 65536; // 64KB buffers
  static const size_t kMaxPoolSize = 256;  // Max 16MB pooled

  std::vector<char*> buffer_pool_;

  // External string resource for zero-copy.
  class ExternalStringResource : public v8::String::ExternalOneByteStringResource {
   public:
    ExternalStringResource(const char* data, size_t length, ZeroCopyBuffer* pool)
      : data_(data), length_(length), pool_(pool) {}

    ~ExternalStringResource() override {
      // Release buffer back to pool.
      if (pool_ && data_) {
        pool_->ReleaseBuffer(const_cast<char*>(data_));
      }
    }

    const char* data() const override { return data_; }
    size_t length() const override { return length_; }

   private:
    const char* data_;
    size_t length_;
    ZeroCopyBuffer* pool_;
  };
};

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_HTTP_PERF_ZERO_COPY_BUFFER_H_
