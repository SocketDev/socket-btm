#include "socketsecurity/http-perf/mimalloc_allocator.h"
#include <cstdlib>
#include <cstring>

// Note: This is a stub implementation that checks for mimalloc at runtime.
// To enable mimalloc:
// 1. Install mimalloc: apt-get install libmimalloc-dev
// 2. Link with -lmimalloc or use LD_PRELOAD
// 3. Uncomment #include <mimalloc.h> below
//
// #include <mimalloc.h>

namespace node {
namespace socketsecurity {
namespace http_perf {

MimallocArrayBufferAllocator::MimallocArrayBufferAllocator()
    : stats_{0, 0, 0, 0},
      use_mimalloc_(IsMimallocAvailable()) {
}

MimallocArrayBufferAllocator::~MimallocArrayBufferAllocator() {
}

bool MimallocArrayBufferAllocator::IsMimallocAvailable() {
  // Check if mimalloc is available at runtime.
  // In production, mimalloc can be enabled via LD_PRELOAD:
  //   LD_PRELOAD=/usr/lib/libmimalloc.so node dist/index.js
  //
  // Or by linking at build time.

  // TODO: Check for mimalloc symbols.
  // return (dlsym(RTLD_DEFAULT, "mi_malloc") != nullptr);

  return false;  // Stub: mimalloc not available yet.
}

void* MimallocArrayBufferAllocator::Allocate(size_t length) {
  stats_.allocations++;
  stats_.bytes_allocated += length;

  if (use_mimalloc_) {
    // Use mimalloc for allocation.
    // void* ptr = mi_calloc(1, length);
    // return ptr;
  }

  // Fallback to standard malloc + zero.
  void* ptr = std::malloc(length);
  if (ptr) {
    std::memset(ptr, 0, length);
  }
  return ptr;
}

void* MimallocArrayBufferAllocator::AllocateUninitialized(size_t length) {
  stats_.allocations++;
  stats_.bytes_allocated += length;

  if (use_mimalloc_) {
    // Use mimalloc for uninitialized allocation.
    // return mi_malloc(length);
  }

  // Fallback to standard malloc.
  return std::malloc(length);
}

void MimallocArrayBufferAllocator::Free(void* data, size_t length) {
  if (!data) return;

  stats_.frees++;
  stats_.bytes_freed += length;

  if (use_mimalloc_) {
    // Use mimalloc for free.
    // mi_free(data);
    // return;
  }

  // Fallback to standard free.
  std::free(data);
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
