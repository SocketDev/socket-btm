// Cell — single terminal cell carrying a codepoint plus its style.
//
// Mirrors socket-stuie/packages/core/upstream/opentui/packages/core/src/
// zig/buffer-methods.zig `Cell` POD layout, but slimmed down to ASCII-RGB
// (no float color, no alpha). The CellBuffer holds a contiguous array
// of these; the Renderer's flush loop diffs cell-by-cell against the
// previous frame and emits ANSI only for changed cells.
//
// Memory layout: 12 bytes per cell. Compact enough that a 200×60 grid
// (12k cells) fits in ~144 KB — well below any L1 cache, so diffing a
// full frame is bandwidth-bound on memory, not on cycles.

#ifndef TUI_INFRA_CELL_HPP_
#define TUI_INFRA_CELL_HPP_

#include <cstdint>

namespace tui {

struct Cell {
  uint32_t codepoint = U' ';  // U+0020 (SPACE) is the canonical "empty" cell.
  uint8_t fg_r = 0;
  uint8_t fg_g = 0;
  uint8_t fg_b = 0;
  uint8_t bg_r = 0;
  uint8_t bg_g = 0;
  uint8_t bg_b = 0;
  uint8_t attrs = 0;  // Bitfield — matches TextAttributes in ansi.hpp.

  bool operator==(const Cell& other) const noexcept {
    return codepoint == other.codepoint && fg_r == other.fg_r &&
           fg_g == other.fg_g && fg_b == other.fg_b && bg_r == other.bg_r &&
           bg_g == other.bg_g && bg_b == other.bg_b && attrs == other.attrs;
  }

  bool operator!=(const Cell& other) const noexcept {
    return !(*this == other);
  }
};

}  // namespace tui

#endif  // TUI_INFRA_CELL_HPP_
