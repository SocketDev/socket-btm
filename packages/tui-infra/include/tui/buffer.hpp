// CellBuffer — width × height grid of Cell.
//
// 1:1 port of the storage + draw primitives from OpenTUI's
// `OptimizedBuffer`:
//
//   opentui/packages/core/src/zig/renderer.zig
//     pub const OptimizedBuffer = struct {
//         cells: []Cell,
//         height: u32,
//         width: u32,
//         pub fn drawText(...) void
//         pub fn fillRect(...) void
//         pub fn set(...) void
//         ...
//     };
//
// Trimmed to the minimum the diff renderer needs: storage + the most-
// used drawing primitives (Set, Fill, DrawText). OpenTUI's full surface
// adds:
//   - SIMD color matrices and alpha blending (renderer.zig blendCell)
//   - Scissor stacks (renderer.zig clipStack)
//   - Hit-test grids (renderer.zig hitTestGrid)
//   - Floating-point colors and per-cell shaders
// These aren't on the critical path for the common terminal-grid case;
// they stay JS-side or in a follow-up port.

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
  // is a follow-up.
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
