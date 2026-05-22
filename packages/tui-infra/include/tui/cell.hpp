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
  // Explicit reserved byte to eliminate the trailing padding the
  // compiler would otherwise insert (4 + 7 = 11 bytes natural,
  // padded to 12 for alignof(uint32_t)). Making the padding an
  // explicitly-zero member means C++20's defaulted operator==
  // emits an optimal memcmp of 12 bytes (1×8-byte cmp + 1×4-byte
  // cmp on x86-64 / ARM64) instead of the 8 chained byte compares
  // the hand-rolled member-wise version generated.
  //
  // The reserved byte is also a forward-compat slot for a future
  // 9th attr bit (e.g. `kReverseFg`) without bumping struct size.
  uint8_t reserved = 0;

  // Defaulted == lets the compiler pick the optimal comparison
  // strategy. With all members trivially-comparable + zero padding
  // (via `reserved`), the compiler emits ~2 instructions instead
  // of 8 sequential byte cmps. Renderer::Flush's per-cell `cur ==
  // old` is the hottest comparison in the codebase — 12k cells per
  // 200×60 frame.
  bool operator==(const Cell&) const noexcept = default;
};

}  // namespace tui

#endif  // TUI_INFRA_CELL_HPP_
