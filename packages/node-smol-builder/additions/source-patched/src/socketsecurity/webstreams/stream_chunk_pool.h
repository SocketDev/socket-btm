#ifndef SRC_SOCKETSECURITY_WEBSTREAMS_STREAM_CHUNK_POOL_H_
#define SRC_SOCKETSECURITY_WEBSTREAMS_STREAM_CHUNK_POOL_H_

#include "env.h"
#include "v8.h"
#include <vector>

namespace node {
namespace socketsecurity {
namespace webstreams {

// Object pool for stream chunks to reduce allocations.
// Each chunk is a reusable { value, done } object.
//
// WPT Compatibility: Chunks must be plain objects, not C++ wrappers.
class StreamChunkPool {
 public:
  explicit StreamChunkPool(Environment* env);
  ~StreamChunkPool();

  // Acquire chunk from pool (or create new).
  v8::Local<v8::Object> AcquireChunk();

  // Release chunk back to pool.
  void ReleaseChunk(v8::Local<v8::Object> chunk);

  // Set chunk data (reuses object, WPT-compatible).
  static void SetChunkValue(
    Environment* env,
    v8::Local<v8::Object> chunk,
    v8::Local<v8::Value> value,
    bool done);

  // Get pool statistics.
  size_t GetPoolSize() const { return pool_.size(); }

  // Clear pool (for testing).
  void Clear();

 private:
  Environment* env_;
  static const size_t kMaxPoolSize = 256;
  std::vector<v8::Global<v8::Object>> pool_;

  // Statistics.
  size_t acquired_ = 0;
  size_t released_ = 0;
};

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_WEBSTREAMS_STREAM_CHUNK_POOL_H_
