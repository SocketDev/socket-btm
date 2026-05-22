// UTF-8 decode / scan primitives — shared by buffer.cc, width.cc,
// and renderables.cc. Header-only so each consumer's compiler can
// inline the small functions and apply call-site-specific
// optimizations (in particular: the ASCII fast path tends to fold
// into the caller's loop, eliminating the function-call overhead
// entirely).
//
// Functions:
//
//   DecodeUtf8(p, end) -> uint32_t codepoint
//     Decodes one codepoint starting at `p` and advances `p` by 1-4
//     bytes. Malformed sequences yield U+FFFD and advance by 1 byte.
//     The malformed-input handling matches the WHATWG decode-error
//     replacement behavior (no exceptions, forward progress
//     guaranteed).
//
//   Utf8ByteLen(p, end) -> size_t bytes
//     Returns the byte length of the codepoint starting at `p`
//     without decoding it. Used by callers that need to slice raw
//     UTF-8 bytes (e.g. word-wrap line builders) without paying the
//     codepoint-assembly cost.
//
// Performance:
//   - ASCII path is one byte read + bit test + early return. The
//     compiler routinely inlines and unrolls this into vectorized
//     scanning loops at the caller.
//   - Multi-byte paths walk one branch per length class; the
//     branches are sorted by frequency (2-byte → 3-byte → 4-byte)
//     so common European / CJK input hits the early branches.
//   - No allocations, no exceptions, no global state.

#ifndef TUI_INFRA_UTF8_HPP_
#define TUI_INFRA_UTF8_HPP_

#include <cstddef>
#include <cstdint>

namespace tui {

inline uint32_t DecodeUtf8(const char*& p, const char* end) {
  if (p >= end) {
    return 0;
  }
  const uint8_t b0 = static_cast<uint8_t>(*p);
  // ASCII fast path — single byte, no continuation bytes to check.
  if ((b0 & 0x80) == 0) {
    ++p;
    return b0;
  }
  // 2-byte sequence: 110xxxxx 10xxxxxx.
  if ((b0 & 0xe0) == 0xc0 && p + 1 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    if ((b1 & 0xc0) == 0x80) {
      p += 2;
      return ((b0 & 0x1fu) << 6) | (b1 & 0x3fu);
    }
  }
  // 3-byte sequence: 1110xxxx 10xxxxxx 10xxxxxx.
  if ((b0 & 0xf0) == 0xe0 && p + 2 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    const uint8_t b2 = static_cast<uint8_t>(*(p + 2));
    if ((b1 & 0xc0) == 0x80 && (b2 & 0xc0) == 0x80) {
      p += 3;
      return ((b0 & 0x0fu) << 12) | ((b1 & 0x3fu) << 6) | (b2 & 0x3fu);
    }
  }
  // 4-byte sequence: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx.
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
  // Malformed input — return U+FFFD and advance by 1 byte to
  // guarantee forward progress on every iteration.
  ++p;
  return 0xfffd;
}

inline size_t Utf8ByteLen(const char* p, const char* end) {
  if (p >= end) {
    return 0;
  }
  const uint8_t b0 = static_cast<uint8_t>(*p);
  if ((b0 & 0x80) == 0) {
    return 1;
  }
  if ((b0 & 0xe0) == 0xc0) {
    return 2;
  }
  if ((b0 & 0xf0) == 0xe0) {
    return 3;
  }
  if ((b0 & 0xf8) == 0xf0) {
    return 4;
  }
  return 1;
}

}  // namespace tui

#endif  // TUI_INFRA_UTF8_HPP_
