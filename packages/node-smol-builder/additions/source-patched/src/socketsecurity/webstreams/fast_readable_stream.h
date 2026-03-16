#ifndef SRC_SOCKETSECURITY_WEBSTREAMS_FAST_READABLE_STREAM_H_
#define SRC_SOCKETSECURITY_WEBSTREAMS_FAST_READABLE_STREAM_H_

#include "async_wrap.h"
#include "env.h"
#include "stream_base.h"
#include "stream_chunk_pool.h"
#include "v8.h"
#include <queue>

namespace node {
namespace socketsecurity {
namespace webstreams {

// Fast ReadableStream C++ accelerator.
// Provides fast paths for synchronous reads and batched operations.
//
// WPT Compatibility:
// - Does NOT replace JS FastReadableStream
// - Provides accelerator methods called by JS layer
// - Maintains WHATWG Streams API semantics
// - Delegates complex cases (backpressure, errors) to JS
class FastReadableStreamAccelerator : public AsyncWrap {
 public:
  FastReadableStreamAccelerator(
    Environment* env,
    v8::Local<v8::Object> object);
  ~FastReadableStreamAccelerator() override;

  // Create new accelerator.
  static void New(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Synchronous read fast path (when data buffered).
  // Returns chunk object or undefined if need async.
  static void ReadSync(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Enqueue data for reading (called by underlying source).
  static void Enqueue(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Close stream.
  static void Close(const v8::FunctionCallbackInfo<v8::Value>& args);

  // Check if data available for sync read.
  static void HasData(const v8::FunctionCallbackInfo<v8::Value>& args);

  SET_NO_MEMORY_INFO()
  SET_MEMORY_INFO_NAME(FastReadableStreamAccelerator)
  SET_SELF_SIZE(FastReadableStreamAccelerator)

 private:
  // Buffered chunks.
  std::queue<v8::Global<v8::Value>> buffer_;

  // Stream state.
  bool closed_ = false;
  bool errored_ = false;

  // Chunk pool.
  StreamChunkPool* chunk_pool_;
};

}  // namespace webstreams
}  // namespace socketsecurity
}  // namespace node

#endif  // SRC_SOCKETSECURITY_WEBSTREAMS_FAST_READABLE_STREAM_H_
