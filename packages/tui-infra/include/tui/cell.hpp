// Cell — single terminal cell carrying a codepoint plus its style.
//
// Mirrors OpenTUI's `Cell` POD layout:
//   opentui/packages/core/src/zig/buffer-methods.zig
//     pub const Cell = struct {
//         attrs: u8,        // bitfield matching TextAttributes in ansi.zig
//         bg: RGB,          // 24-bit background
//         char: u32,        // unicode codepoint (UTF-8 collapsed)
//         fg: RGB,          // 24-bit foreground
//     };
//
// Slimmed from OpenTUI's full Cell (which carries float-valued colors
// for SIMD-friendly alpha compositing) to ASCII-RGB (uint8 channels, no
// alpha). The Renderer's flush loop diffs cell-by-cell against the
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
