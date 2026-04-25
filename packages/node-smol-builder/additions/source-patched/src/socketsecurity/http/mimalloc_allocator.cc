#include "socketsecurity/http/mimalloc_allocator.h"
#include <cstdlib>
#include <cstring>
#if defined(__linux__) || defined(__APPLE__)
#include <dlfcn.h>
#elif defined(_WIN32)
#include <windows.h>
#endif

// Note: This implementation uses runtime detection for mimalloc.
// To enable mimalloc:
// 1. Install mimalloc: apt-get install libmimalloc-dev
// 2. Use LD_PRELOAD: LD_PRELOAD=/usr/lib/libmimalloc.so node dist/index.js
//    OR link with -lmimalloc at build time
//
// When mimalloc is loaded via LD_PRELOAD, malloc/free are automatically
// redirected to mi_malloc/mi_free, so we don't need explicit calls.

namespace node {
namespace socketsecurity {
namespace http_perf {

MimallocArrayBufferAllocator::MimallocArrayBufferAllocator()
    : stats_{0, 0, 0, 0, IsMimallocAvailable()},
      use_mimalloc_(stats_.mimalloc_detected) {
}

MimallocArrayBufferAllocator::~MimallocArrayBufferAllocator() {
}

bool MimallocArrayBufferAllocator::IsMimallocAvailable() {
  // Check if mimalloc is available at runtime.
  // In production, mimalloc can be enabled via LD_PRELOAD:
  //   LD_PRELOAD=/usr/lib/libmimalloc.so node dist/index.js
  //
  // Or by linking at build time.

#if defined(__linux__) || defined(__APPLE__)
  // Check for mimalloc by explicitly loading the library.
  // More secure than RTLD_DEFAULT which could be spoofed.
  // Use RTLD_NOLOAD to check if already loaded without side effects.
  void* handle = dlopen("libmimalloc.so.2", RTLD_NOW | RTLD_NOLOAD);
  if (handle == nullptr) {
    handle = dlopen("libmimalloc.so", RTLD_NOW | RTLD_NOLOAD);
  }
#ifdef __APPLE__
  if (handle == nullptr) {
    handle = dlopen("libmimalloc.dylib", RTLD_NOW | RTLD_NOLOAD);
  }
#endif

  if (handle != nullptr) {
    // Verify multiple mimalloc-specific symbols to reduce false positives
    void* mi_malloc_sym = dlsym(handle, "mi_malloc");
    void* mi_free_sym = dlsym(handle, "mi_free");
    void* mi_version_sym = dlsym(handle, "mi_version");
    dlclose(handle);
    return (mi_malloc_sym != nullptr && mi_free_sym != nullptr && mi_version_sym != nullptr);
  }

  return false;
#elif defined(_WIN32)
  // Check for mimalloc DLL on Windows.
  // Note: On Windows, mimalloc uses redirect DLL for malloc interposition.
  // We check if the DLL is loaded rather than if malloc is redirected.
  HMODULE module = GetModuleHandleA("mimalloc.dll");
  if (module == NULL) {
    module = GetModuleHandleA("mimalloc-redirect.dll");
  }
  if (module == NULL) {
    // Try versioned name
    module = GetModuleHandleA("mimalloc-2.dll");
  }
  return (module != NULL);
#else
  return false;  // Platform not supported for runtime detection.
#endif
}

void* MimallocArrayBufferAllocator::Allocate(size_t length) {
  stats_.allocations++;
  stats_.bytes_allocated += length;

  // When mimalloc is loaded (LD_PRELOAD or linked), malloc is automatically
  // redirected to mi_malloc. We don't need explicit mi_* calls.
  // The use_mimalloc_ flag is informational for stats/logging.

  // Allocate zero-initialized memory.
  void* ptr = std::calloc(1, length);
  return ptr;
}

void* MimallocArrayBufferAllocator::AllocateUninitialized(size_t length) {
  stats_.allocations++;
  stats_.bytes_allocated += length;

  // When mimalloc is loaded (LD_PRELOAD or linked), malloc is automatically
  // redirected to mi_malloc. We don't need explicit mi_* calls.

  return std::malloc(length);
}

void MimallocArrayBufferAllocator::Free(void* data, size_t length) {
  if (!data) return;

  stats_.frees++;
  stats_.bytes_freed += length;

  // When mimalloc is loaded (LD_PRELOAD or linked), free is automatically
  // redirected to mi_free. We don't need explicit mi_* calls.
  std::free(data);
}

}  // namespace http_perf
}  // namespace socketsecurity
}  // namespace node
