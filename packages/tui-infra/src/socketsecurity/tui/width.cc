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

// Decode one UTF-8 codepoint starting at `p`. Returns the codepoint
// and advances `p` by 1-4 bytes. Malformed sequences yield U+FFFD
// and advance 1 byte.
inline uint32_t DecodeUtf8(const char*& p, const char* end) {
  const uint8_t b0 = static_cast<uint8_t>(*p);
  if ((b0 & 0x80) == 0) {
    ++p;
    return b0;
  }
  if ((b0 & 0xe0) == 0xc0 && p + 1 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    if ((b1 & 0xc0) == 0x80) {
      p += 2;
      return ((b0 & 0x1fu) << 6) | (b1 & 0x3fu);
    }
  }
  if ((b0 & 0xf0) == 0xe0 && p + 2 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    const uint8_t b2 = static_cast<uint8_t>(*(p + 2));
    if ((b1 & 0xc0) == 0x80 && (b2 & 0xc0) == 0x80) {
      p += 3;
      return ((b0 & 0x0fu) << 12) | ((b1 & 0x3fu) << 6) | (b2 & 0x3fu);
    }
  }
  if ((b0 & 0xf8) == 0xf0 && p + 3 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    const uint8_t b2 = static_cast<uint8_t>(*(p + 2));
    const uint8_t b3 = static_cast<uint8_t>(*(p + 3));
    if ((b1 & 0xc0) == 0x80 && (b2 & 0xc0) == 0x80 && (b3 & 0xc0) == 0x80) {
      p += 4;
      return ((b0 & 0x07u) << 18) | ((b1 & 0x3fu) << 12) |
             ((b2 & 0x3fu) << 6) | (b3 & 0x3fu);
    }
  }
  ++p;
  return 0xfffd;
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
  // Zero-width first (smaller table; sparser hits but cheap when no
  // hit). Wide check next.
  if (InRangeTable(cp, kZeroWidthRanges, kZeroWidthRangesCount)) {
    return 0;
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
