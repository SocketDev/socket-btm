// Public surface for tui-infra ANSI emit primitives.
//
// Status: scaffold only — no implementations land until Tier 1 PR.
// node-smol's `node:smol-tui` binding will #include this header
// once the additions/source-patched wiring is hooked up.
//
// Spec / parity refs:
//   - OpenTUI lib/ansi.ts (upstream we lockstep against)
//   - VT100 / xterm SGR sequences:
//     https://invisible-island.net/xterm/ctlseqs/ctlseqs.html

#ifndef TUI_INFRA_ANSI_HPP_
#define TUI_INFRA_ANSI_HPP_

#include <cstdint>
#include <string>
#include <string_view>

namespace tui {

// Move cursor to (row, col), 1-indexed (CUP — ESC[<row>;<col>H).
std::string CursorPosition(uint16_t row, uint16_t col);

// Hide / show cursor (DECTCEM).
std::string CursorHide();
std::string CursorShow();

// Clear screen (ED — Erase in Display). `mode` per ANSI:
//   0: cursor → end of screen
//   1: start of screen → cursor
//   2: entire screen
std::string ClearScreen(uint8_t mode = 2);

// Set graphic rendition (SGR). Pass parameters as a list of uint8s;
// e.g. {38, 5, 27} for 256-color foreground index 27.
std::string SetGraphic(std::string_view params);

}  // namespace tui

#endif  // TUI_INFRA_ANSI_HPP_
