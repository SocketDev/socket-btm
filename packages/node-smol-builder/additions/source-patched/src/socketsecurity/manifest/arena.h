// node:smol-manifest — Arena allocator.
//
// Bump-allocates from a chain of fixed-size chunks. All memory is
// freed at once when the Arena is destroyed; there is no individual
// free. Used to hold the intermediate parser state (raw entries, dep
// lists, suffix-stripped versions, interned strings) so that a parse
// of a large lockfile does zero `free()` calls during the hot loop.
//
// Lifetime contract: every `std::string_view` returned by methods on
// this arena or on the StringInterner that owns one of these is
// valid for the lifetime of the Arena. Borrowed views into the
// caller's input buffer are NOT touched by the arena — the parser
// uses arena-owned copies only for spans that must outlive the
// input (peer-stripped versions, normalized names, etc.). Read-only
// views into the caller's buffer can be returned directly without
// copying.
//
// Not thread-safe. Each parse creates its own Arena.

#ifndef SRC_SOCKETSECURITY_MANIFEST_ARENA_H_
#define SRC_SOCKETSECURITY_MANIFEST_ARENA_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string_view>
#include <vector>

namespace node {
namespace socketsecurity {
namespace manifest {

// Default chunk size: 64 KiB. Big enough that real lockfiles (median
// ~50k of intermediate strings for an 80k-line pnpm lockfile) fit in
// 2-4 chunks, small enough that small parses don't over-allocate.
inline constexpr size_t kArenaChunkSize = 64 * 1024;

// Maximum alignment we hand out. The arena bumps in `alignof(void*)`
// strides; any caller needing stricter alignment should use a
// dedicated allocator. All current callers are fine with pointer-
// aligned storage.
inline constexpr size_t kArenaAlignment = alignof(void*);

class Arena {
 public:
  Arena() = default;
  Arena(const Arena&) = delete;
  Arena& operator=(const Arena&) = delete;
  Arena(Arena&&) = default;
  Arena& operator=(Arena&&) = default;
  ~Arena() = default;

  // Allocate `bytes` of pointer-aligned storage. The returned pointer
  // is valid for the lifetime of the Arena. Allocations larger than
  // `kArenaChunkSize` get a dedicated chunk so they don't waste the
  // rest of the current chunk.
  char* Allocate(size_t bytes) {
    if (bytes == 0) {
      // Return a non-null sentinel so callers can distinguish "no
      // allocation needed" from "allocation failed." Pointing at the
      // current head is safe because we never write through a zero-
      // sized allocation.
      return head_;
    }
    // Round up to alignment.
    const size_t aligned =
        (bytes + (kArenaAlignment - 1)) & ~(kArenaAlignment - 1);
    if (aligned > remaining_) {
      AddChunk(aligned > kArenaChunkSize ? aligned : kArenaChunkSize);
    }
    char* p = head_;
    head_ += aligned;
    remaining_ -= aligned;
    bytes_used_ += aligned;
    return p;
  }

  // Copy `s` into the arena and return a view of the copy. Used when
  // the caller needs a string that must outlive the input buffer
  // (e.g. a synthesized canonical name, a peer-suffix-stripped
  // version). For read-only spans of the input buffer, the parser
  // returns the source view directly — no copy needed.
  std::string_view Copy(std::string_view s) {
    if (s.empty()) {
      return std::string_view{};
    }
    char* dst = Allocate(s.size());
    std::memcpy(dst, s.data(), s.size());
    return std::string_view(dst, s.size());
  }

  // Concatenate two views into the arena and return the joined view.
  // Used for `<name>@<version>` cycle-detection keys without forcing
  // each call site to manage its own scratch buffer.
  std::string_view Concat(std::string_view a, std::string_view b) {
    if (a.empty() && b.empty()) {
      return std::string_view{};
    }
    const size_t total = a.size() + b.size();
    char* dst = Allocate(total);
    if (!a.empty()) {
      std::memcpy(dst, a.data(), a.size());
    }
    if (!b.empty()) {
      std::memcpy(dst + a.size(), b.data(), b.size());
    }
    return std::string_view(dst, total);
  }

  // Bytes currently checked out via Allocate(). Excludes the
  // unused tail of the current chunk and any wholly-unused chunks.
  size_t BytesUsed() const { return bytes_used_; }

  // Total bytes reserved across all chunks. Always ≥ BytesUsed().
  // Useful for the asan/valgrind budget assertion in tests (peak
  // arena footprint should stay < 4× input size for typical
  // lockfiles).
  size_t BytesReserved() const { return bytes_reserved_; }

 private:
  void AddChunk(size_t size) {
    auto chunk = std::make_unique<char[]>(size);
    head_ = chunk.get();
    remaining_ = size;
    bytes_reserved_ += size;
    chunks_.push_back(std::move(chunk));
  }

  std::vector<std::unique_ptr<char[]>> chunks_;
  char* head_ = nullptr;
  size_t remaining_ = 0;
  size_t bytes_used_ = 0;
  size_t bytes_reserved_ = 0;
};

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_ARENA_H_
