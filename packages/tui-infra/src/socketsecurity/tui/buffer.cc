// CellBuffer — Tier 2 implementation.
//
// Mirrors socket-stuie's OpenTUI buffer-methods.zig surface trimmed to
// what the diff renderer needs.

#include "tui/buffer.hpp"

#include <algorithm>
#include <cstddef>

namespace tui {

void CellBuffer::Resize(uint32_t width, uint32_t height) {
  if (width_ == width && height_ == height) {
    return;
  }
  width_ = width;
  height_ = height;
  cells_.assign(static_cast<size_t>(width) * height, Cell{});
}

void CellBuffer::Clear(const Cell& fill) {
  std::fill(cells_.begin(), cells_.end(), fill);
}

void CellBuffer::Set(uint32_t x, uint32_t y, const Cell& cell) {
  if (x >= width_ || y >= height_) {
    return;
  }
  cells_[IndexOf(x, y)] = cell;
}

Cell CellBuffer::Get(uint32_t x, uint32_t y) const {
  if (x >= width_ || y >= height_) {
    return Cell{};
  }
  return cells_[IndexOf(x, y)];
}

void CellBuffer::FillRect(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                          const Cell& cell) {
  if (x >= width_ || y >= height_) {
    return;
  }
  const uint32_t x_end = std::min(x + w, width_);
  const uint32_t y_end = std::min(y + h, height_);
  for (uint32_t row = y; row < y_end; ++row) {
    Cell* p = &cells_[IndexOf(x, row)];
    for (uint32_t col = x; col < x_end; ++col, ++p) {
      *p = cell;
    }
  }
}

namespace {

// Decode one UTF-8 codepoint starting at p. Returns the codepoint and
// advances p by the byte count. Malformed sequences are replaced with
// U+FFFD and the byte stream advances by 1 to make forward progress.
uint32_t DecodeUtf8(const char*& p, const char* end) {
  if (p >= end) {
    return 0;
  }
  const uint8_t b0 = static_cast<uint8_t>(*p);
  // ASCII fast path.
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
  // Malformed — replacement char, advance one byte.
  ++p;
  return 0xfffd;
}

}  // namespace

void CellBuffer::DrawText(uint32_t x, uint32_t y, const char* utf8,
                          size_t length, uint8_t fg_r, uint8_t fg_g,
                          uint8_t fg_b, uint8_t bg_r, uint8_t bg_g,
                          uint8_t bg_b, uint8_t attrs) {
  if (y >= height_ || x >= width_ || length == 0 || utf8 == nullptr) {
    return;
  }
  const char* p = utf8;
  const char* end = utf8 + length;
  uint32_t col = x;
  while (p < end && col < width_) {
    Cell c{};
    c.codepoint = DecodeUtf8(p, end);
    c.fg_r = fg_r;
    c.fg_g = fg_g;
    c.fg_b = fg_b;
    c.bg_r = bg_r;
    c.bg_g = bg_g;
    c.bg_b = bg_b;
    c.attrs = attrs;
    cells_[IndexOf(col, y)] = c;
    ++col;
  }
}

}  // namespace tui
