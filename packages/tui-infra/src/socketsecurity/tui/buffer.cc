// CellBuffer.
//
// Mirrors socket-stuie's OpenTUI buffer-methods.zig surface trimmed to
// what the diff renderer needs.

#include "tui/buffer.hpp"

#include <algorithm>
#include <cstddef>

#include "tui/utf8.hpp"

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

void CellBuffer::DrawText(uint32_t x, uint32_t y, const char* utf8,
                          size_t length, uint8_t fg_r, uint8_t fg_g,
                          uint8_t fg_b, uint8_t bg_r, uint8_t bg_g,
                          uint8_t bg_b, uint8_t attrs) {
  if (y >= height_ || x >= width_ || length == 0 || utf8 == nullptr) {
    return;
  }
  const char* p = utf8;
  const char* const end = utf8 + length;

  // Hoist the style fields out of the loop — they're the same for
  // every cell. Only the codepoint changes per iteration. Compiler
  // can keep the partial Cell in registers.
  Cell c{};
  c.fg_r = fg_r;
  c.fg_g = fg_g;
  c.fg_b = fg_b;
  c.bg_r = bg_r;
  c.bg_g = bg_g;
  c.bg_b = bg_b;
  c.attrs = attrs;

  // Row offset is loop-invariant. Pre-compute the row's base pointer
  // and walk by one cell each step instead of recomputing IndexOf
  // (which does y * width_) per character.
  Cell* row = &cells_[static_cast<size_t>(y) * width_ + x];
  const uint32_t col_end = width_ - x;
  uint32_t col = 0;
  while (p < end && col < col_end) {
    c.codepoint = DecodeUtf8(p, end);
    row[col] = c;
    ++col;
  }
}

}  // namespace tui
