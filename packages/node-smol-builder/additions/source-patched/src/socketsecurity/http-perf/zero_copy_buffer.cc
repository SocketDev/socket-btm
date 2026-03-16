#include "zero_copy_buffer.h"
#include "node_internals.h"
#include "util-inl.h"
#include <cstdlib>
#include <cstring>

namespace node {
namespace socketsecurity {
namespace http_perf {

using v8::HandleScope;
using v8::Isolate;
using v8::Local;
using v8::String;

ZeroCopyBuffer::ZeroCopyBuffer(Environment* env) : env_(env) {}

ZeroCopyBuffer::~ZeroCopyBuffer() {
  // Free all pooled buffers.
  for (char* buffer : buffer_pool_) {
    free(buffer);
  }
  buffer_pool_.clear();
}

Local<String> ZeroCopyBuffer::CreateExternalString(
    const char* data,
    size_t length) {
  Isolate* isolate = env_->isolate();
  HandleScope scope(isolate);

  // Create external string resource.
  ExternalStringResource* resource =
    new ExternalStringResource(data, length, this);

  // Create external string (zero-copy, backed by resource).
  Local<String> str =
    String::NewExternalOneByte(isolate, resource).ToLocalChecked();

  return str;
}

char* ZeroCopyBuffer::AcquireBuffer(size_t size) {
  // Only use pool for standard-sized buffers.
  if (size != kBufferSize) {
    return static_cast<char*>(malloc(size));
  }

  // Reuse from pool if available.
  if (!buffer_pool_.empty()) {
    char* buffer = buffer_pool_.back();
    buffer_pool_.pop_back();
    return buffer;
  }

  // Pool empty: allocate new buffer.
  return static_cast<char*>(malloc(kBufferSize));
}

void ZeroCopyBuffer::ReleaseBuffer(char* buffer) {
  if (buffer == nullptr) {
    return;
  }

  // Don't grow pool beyond max size.
  if (buffer_pool_.size() >= kMaxPoolSize) {
    free(buffer);
    return;
  }

  // Return to pool.
  buffer_pool_.push_back(buffer);
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
