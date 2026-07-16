// node:smol-manifest — string interning.
//
// Deduplicates strings within a single parse. Real lockfiles repeat
// package names heavily: a 200-package monorepo's pnpm-lock.yaml has
// ~500 unique names referenced ~5000 times. Interning collapses that
// to 500 arena copies and 4500 view-equality returns.
//
// Borrowed views: the caller is free to pass a view into the input
// buffer; the interner only copies into the arena on first
// encounter. Subsequent calls with views that compare equal (memcmp)
// return the canonical arena-owned view.
//
// Not thread-safe. Each parse creates its own Arena + StringInterner.

#ifndef SRC_SOCKETSECURITY_MANIFEST_INTERN_H_
#define SRC_SOCKETSECURITY_MANIFEST_INTERN_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include <cstdint>
#include <string_view>
#include <unordered_map>

#include "arena.h"

namespace node {
namespace socketsecurity {
namespace manifest {

// FNV-1a is a deliberate choice over std::hash<string_view>:
//   1. Deterministic across runs (no random seed) — bench fixtures
//      reproduce. std::hash on libc++ randomizes by default.
//   2. Fast for short keys (median name length 8–20 chars).
//   3. Stable cross-platform; the hash is part of the parser's
//      observable behavior only via iteration order, but having a
//      fixed hash makes test fixtures portable.
struct Fnv1aHash {
  size_t operator()(std::string_view s) const noexcept {
    // 64-bit FNV-1a.
    constexpr uint64_t kOffsetBasis = 0xcbf29ce484222325ULL;
    constexpr uint64_t kPrime = 0x100000001b3ULL;
    uint64_t h = kOffsetBasis;
    for (unsigned char c : s) {
      h ^= c;
      h *= kPrime;
    }
    return static_cast<size_t>(h);
  }
};

class StringInterner {
 public:
  // `arena` must outlive this interner. The interner does not own
  // the arena because the parser holds the arena and uses it for
  // both interned strings and other intermediate allocations.
  explicit StringInterner(Arena* arena) : arena_(arena) {}
  StringInterner(const StringInterner&) = delete;
  StringInterner& operator=(const StringInterner&) = delete;

  // Return the canonical view for `s`. The first call with a given
  // value copies it into the arena and stores the view; subsequent
  // calls with equal content return that same view.
  std::string_view Intern(std::string_view s) {
    if (s.empty()) {
      // Don't allocate for empty — return the same canonical empty
      // view every time.
      return std::string_view{};
    }
    auto it = map_.find(s);
    if (it != map_.end()) {
      return it->second;
    }
    // First sighting: copy into arena, insert under the arena-owned
    // key (so the map_'s stored key remains valid after the caller's
    // input buffer goes away).
    std::string_view canonical = arena_->Copy(s);
    map_.emplace(canonical, canonical);
    return canonical;
  }

  // Number of distinct strings interned so far. Test diagnostic.
  size_t UniqueCount() const { return map_.size(); }

 private:
  Arena* arena_;
  // map's keys ARE the arena-owned views; map's values are the same
  // views (kept separately so future map types can return a different
  // canonical form, e.g. a normalized version). Today value == key
  // for every entry.
  std::unordered_map<std::string_view, std::string_view, Fnv1aHash> map_;
};

}  // namespace manifest
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS
#endif  // SRC_SOCKETSECURITY_MANIFEST_INTERN_H_
