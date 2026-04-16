// ============================================================================
// fast_readable_stream.h -- Header for the WebStreams C++ read accelerator
// ============================================================================
//
// C++ HEADER FILES (.h) vs SOURCE FILES (.cc)
//   ".h" files declare classes and method signatures.  ".cc" files
//   implement them.  This header is included by fast_readable_stream.cc
//   and webstreams_binding.cc.
//
// WHAT THIS FILE DECLARES
//   FastReadableStreamAccelerator -- a C++ helper that provides a fast
//   synchronous read path for ReadableStream.
//
// WEBSTREAMS BACKGROUND
//   WebStreams (ReadableStream, WritableStream, TransformStream) are
//   standard Web Platform APIs for processing data in chunks.  Think of
//   a ReadableStream as a queue of data chunks that consumers read one
//   at a time.
//
//   The default JS implementation calls into microtasks/promises for
//   every chunk.  This C++ accelerator short-circuits that: when data
//   is already buffered in C++, ReadSync() returns it immediately
//   without going through the JS promise machinery.
//
// THE CHUNK CONCEPT
//   Each read from a ReadableStream returns a "chunk" object:
//     { value: <some data>, done: false }   -- normal chunk
//     { value: undefined,   done: true  }   -- stream ended
//   The StreamChunkPool (stream_chunk_pool.h) pre-allocates these
//   objects so we do not create a new JS object per read.
//
// BACKPRESSURE
//   When the reader is slower than the writer, the buffer grows.  This
//   accelerator only handles the simple "data ready" fast path.  Complex
//   backpressure signaling is delegated to the JS layer.
//
// KEY C++ CONCEPTS USED HERE
//   AsyncWrap
//     -- Node.js base class for C++ objects that participate in
//        async_hooks tracking.  Lets tools like diagnostics_channel
//        see these objects.
//
//   std::queue<v8::Global<v8::Value>> buffer_
//     -- A FIFO queue of persistent V8 references to buffered chunks.
//        Global<> (unlike Local<>) survives across HandleScopes and
//        prevents the garbage collector from collecting the values.
//
//   ASSIGN_OR_RETURN_UNWRAP
//     -- A Node.js macro that extracts the C++ object from args.This()
//        (the JS `this`).  Needed because JS wraps C++ objects in a
//        special V8 object with internal fields.
// ============================================================================
#ifndef SRC_SOCKETSECURITY_WEBSTREAMS_FAST_READABLE_STREAM_H_
#define SRC_SOCKETSECURITY_WEBSTREAMS_FAST_READABLE_STREAM_H_

#include "async_wrap.h"
#include "env.h"
#include "stream_base.h"
#include "socketsecurity/webstreams/stream_chunk_pool.h"
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
