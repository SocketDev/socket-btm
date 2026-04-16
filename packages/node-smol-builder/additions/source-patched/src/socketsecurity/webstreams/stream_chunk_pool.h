// ============================================================================
// stream_chunk_pool.h -- Header for the WebStreams chunk object pool
// ============================================================================
//
// WHAT THIS FILE DECLARES
//   StreamChunkPool -- pre-allocates and recycles { value, done } JS
//   objects so that every stream read does not create a brand-new object.
//
// WHY A CHUNK POOL?
//   Every time a ReadableStream reader calls read(), it expects a plain
//   JS object like { value: chunk, done: false }.  Creating a new object
//   per read means the garbage collector has to reclaim thousands of
//   short-lived objects per second.  The pool keeps up to 256 of these
//   objects around and resets their properties instead of creating new
//   ones -- similar to how a library recycles tote bags instead of
//   giving out new ones each time.
//
// HOW IT WORKS
//   AcquireChunk()
//     -- Pops a recycled chunk from the pool, or creates a new one if
//        the pool is empty.  Returns a plain JS object.
//   SetChunkValue(chunk, value, done)
//     -- Sets the chunk's `value` and `done` properties.
//   ReleaseChunk(chunk)
//     -- Resets the chunk to { value: undefined, done: false } and
//        pushes it back into the pool for reuse.
//
// WPT (Web Platform Tests) COMPATIBILITY
//   The WHATWG Streams spec says read() results must be plain objects,
//   not C++ wrapper objects.  That is why chunks are created with
//   Object::New() (a normal JS object) instead of a C++ class template.
//
// KEY C++ CONCEPTS USED HERE
//   std::vector<v8::Global<v8::Object>> pool_
//     -- A dynamic array of persistent references to recycled JS objects.
//        Global<> prevents the garbage collector from collecting them
//        while they sit in the pool.
//
//   kMaxPoolSize = 256
//     -- The maximum number of chunks kept in the pool.  Beyond this,
//        released chunks are simply discarded (garbage collected).
// ============================================================================
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
