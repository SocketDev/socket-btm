// CellBuffer — width × height grid of Cell.
//
// Tier 2 surface. Mirrors socket-stuie/packages/core/upstream/opentui/
// packages/core/src/zig/renderer.zig OptimizedBuffer trimmed down to the
// minimum the diff renderer needs: storage + the most-used drawing
// primitives (Set, Fill, DrawText). SIMD color matrices, alpha blending,
// scissor stacks, and hit-test grids live in OpenTUI's full surface but
// aren't on the Tier 2 critical path — they land later or stay
// JS-side.

#ifndef TUI_INFRA_BUFFER_HPP_
#define TUI_INFRA_BUFFER_HPP_

#include <cstddef>
#include <cstdint>
#include <vector>

#include "tui/cell.hpp"

namespace tui {

class CellBuffer {
 public:
  CellBuffer() = default;
  CellBuffer(uint32_t width, uint32_t height) { Resize(width, height); }

  uint32_t Width() const noexcept { return width_; }
  uint32_t Height() const noexcept { return height_; }
  const Cell* Data() const noexcept { return cells_.data(); }

  // Resize the grid. Existing content is discarded — callers redraw
  // after resize. Idempotent when width/height already match.
  void Resize(uint32_t width, uint32_t height);

  // Fill every cell with `fill`. Used for full-frame clears between
  // frames.
  void Clear(const Cell& fill);

  // Set a single cell. Out-of-bounds writes are silently dropped — the
  // renderer's draw primitives clip, and the Set surface itself just
  // mirrors the upstream Zig behavior of returning early.
  void Set(uint32_t x, uint32_t y, const Cell& cell);

  Cell Get(uint32_t x, uint32_t y) const;

  // Fill a rectangle with a single cell. Clips at the buffer bounds.
  void FillRect(uint32_t x, uint32_t y, uint32_t w, uint32_t h,
                const Cell& cell);

  // Draw a UTF-8 string starting at (x, y). Each codepoint becomes one
  // cell carrying the supplied fg/bg/attrs. ASCII and basic multi-byte
  // UTF-8 are supported; combining characters and wide chars (CJK,
  // emoji) count as a single cell each — proper grapheme width handling
  // is a Tier 3 follow-up.
  void DrawText(uint32_t x, uint32_t y, const char* utf8, size_t length,
                uint8_t fg_r, uint8_t fg_g, uint8_t fg_b, uint8_t bg_r,
                uint8_t bg_g, uint8_t bg_b, uint8_t attrs);

 private:
  uint32_t width_ = 0;
  uint32_t height_ = 0;
  std::vector<Cell> cells_;

  size_t IndexOf(uint32_t x, uint32_t y) const noexcept {
    return static_cast<size_t>(y) * width_ + x;
  }
};

}  // namespace tui

#endif  // TUI_INFRA_BUFFER_HPP_
