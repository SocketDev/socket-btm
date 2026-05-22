// String width implementation.
//
// Codepoint classification uses two sorted [lo, hi]-range tables
// generated from the Unicode 17.0.0 data files (width_data.cc):
//
//   - kWideRanges      → EAW W/F ∪ Emoji_Presentation
//   - kZeroWidthRanges → controls + combining + format + variation
//                        selectors + tags
//
// Lookup is binary search per codepoint. The ASCII fast path (most
// terminal output) skips the searches entirely and runs at memory
// bandwidth.

#include "tui/width.hpp"

#include <cstddef>
#include <cstdint>

#include "tui/utf8.hpp"

namespace tui {

extern const uint32_t kWideRanges[][2];
extern const uint32_t kZeroWidthRanges[][2];
extern const size_t kWideRangesCount;
extern const size_t kZeroWidthRangesCount;

namespace {

// Binary search a [lo, hi] sorted range table for cp. Returns true
// iff cp falls within any of the ranges.
inline bool InRangeTable(uint32_t cp, const uint32_t (*table)[2],
                         size_t count) {
  size_t lo = 0;
  size_t hi = count;
  while (lo < hi) {
    const size_t mid = lo + (hi - lo) / 2;
    const uint32_t r_lo = table[mid][0];
    const uint32_t r_hi = table[mid][1];
    if (cp < r_lo) {
      hi = mid;
    } else if (cp > r_hi) {
      lo = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

}  // namespace

uint32_t CodepointWidth(uint32_t cp) {
  // ASCII fast path — most terminal output is plain ASCII.
  if (cp < 0x80) {
    if (cp < 0x20 || cp == 0x7f) {
      return 0;  // C0 controls + DEL
    }
    return 1;
  }

  // Zero-width first. The table is small (13 ranges); binary search
  // is ~4 iterations worst case. Most non-ASCII codepoints are not
  // zero-width, so the search exits fast through a non-match.
  if (InRangeTable(cp, kZeroWidthRanges, kZeroWidthRangesCount)) {
    return 0;
  }

  // BMP fast path: the first wide-range entry is U+1100 (Hangul
  // Jamo). Any codepoint below that — Latin Extended, IPA, Greek,
  // Cyrillic, Hebrew, Arabic, Devanagari, etc. — is width 1 by
  // definition once we've ruled out zero-width above. Skipping the
  // ~7-iteration binary search saves cycles on the dominant
  // non-ASCII codepath (Western European text, accents, smart
  // quotes).
  if (cp < 0x1100) {
    return 1;
  }

  if (InRangeTable(cp, kWideRanges, kWideRangesCount)) {
    return 2;
  }
  return 1;
}

uint32_t StringWidth(const char* utf8, size_t length) {
  if (utf8 == nullptr || length == 0) {
    return 0;
  }
  uint32_t total = 0;
  const char* p = utf8;
  const char* const end = utf8 + length;

  // ASCII fast path: scan run of bytes < 0x80 with a tight loop.
  // Any non-ASCII byte falls through to the per-codepoint path.
  while (p < end) {
    const uint8_t b = static_cast<uint8_t>(*p);
    if (b < 0x80) {
      if (b < 0x20 || b == 0x7f) {
        // Control char — zero width.
      } else {
        total += 1;
      }
      ++p;
      continue;
    }
    // Non-ASCII: decode + lookup.
    const uint32_t cp = DecodeUtf8(p, end);
    total += CodepointWidth(cp);
  }

  return total;
}

}  // namespace tui
