// ANSI emit primitives — scaffold.
//
// Implementations land in the Tier 1 PR. This file exists so the
// node-smol additions/source-patched copy step picks up the directory
// before any real code is here.
//
// Lockstep reference: socket-stuie's OpenTUI lib/ansi.ts
// (https://github.com/anomalyco/opentui/blob/main/lib/ansi.ts).

#include "tui/ansi.hpp"

namespace tui {

std::string CursorPosition(uint16_t row, uint16_t col) {
  // TODO(tier1): "\x1b[<row>;<col>H"
  (void)row;
  (void)col;
  return {};
}

std::string CursorHide() {
  // TODO(tier1): return "\x1b[?25l";
  return {};
}

std::string CursorShow() {
  // TODO(tier1): return "\x1b[?25h";
  return {};
}

std::string ClearScreen(uint8_t mode) {
  // TODO(tier1): "\x1b[<mode>J"
  (void)mode;
  return {};
}

std::string SetGraphic(std::string_view params) {
  // TODO(tier1): "\x1b[<params>m"
  (void)params;
  return {};
}

}  // namespace tui
