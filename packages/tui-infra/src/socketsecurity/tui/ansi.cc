// ANSI emit primitives — scaffold.
//
// Implementations land in Tier 1 (task #328). Constants are defined
// here so the binding can reference them at link-time. Cold-path
// builders + hot-path writers are stubs (return empty / zero).
//
// Lockstep reference: socket-stuie's OpenTUI fork
// (opentui/packages/core/src/zig/ansi.zig, 268 LOC) — the per-cell
// hot path our binding ports against. See packages/tui-infra/README.md
// for the three-tier plan.

#include "tui/ansi.hpp"

namespace tui {

// ── Constants ──────────────────────────────────────────────────────

const char kReset[] = "\x1b[0m";
const char kClear[] = "\x1b[2J";
const char kHome[] = "\x1b[H";
const char kClearAndHome[] = "\x1b[H\x1b[2J";
const char kHideCursor[] = "\x1b[?25l";
const char kShowCursor[] = "\x1b[?25h";
const char kSwitchToAltScreen[] = "\x1b[?1049h";
const char kSwitchToMainScreen[] = "\x1b[?1049l";
const char kBracketedPasteStart[] = "\x1b[200~";
const char kBracketedPasteEnd[] = "\x1b[201~";
const char kBracketedPasteSet[] = "\x1b[?2004h";
const char kBracketedPasteReset[] = "\x1b[?2004l";
const char kResetBackground[] = "\x1b[49m";
const char kResetForeground[] = "\x1b[39m";
const char kEraseBelowCursor[] = "\x1b[J";
const char kNextLine[] = "\x1b[E";

const char kBold[] = "\x1b[1m";
const char kDim[] = "\x1b[2m";
const char kItalic[] = "\x1b[3m";
const char kUnderline[] = "\x1b[4m";
const char kBlink[] = "\x1b[5m";
const char kInverse[] = "\x1b[7m";
const char kHidden[] = "\x1b[8m";
const char kStrikethrough[] = "\x1b[9m";

// ── Cold-path builders ─────────────────────────────────────────────

std::string CursorPosition(uint16_t row, uint16_t col) {
  // TODO(tier1): "\x1b[<row>;<col>H"
  (void)row;
  (void)col;
  return {};
}

std::string MoveCursorAndClear(uint16_t row, uint16_t col) {
  // TODO(tier1): CursorPosition(row, col) + kEraseBelowCursor
  (void)row;
  (void)col;
  return {};
}

std::string ScrollDown(uint16_t lines) {
  // TODO(tier1): "\x1b[<lines>T"
  (void)lines;
  return {};
}

std::string ScrollUp(uint16_t lines) {
  // TODO(tier1): "\x1b[<lines>S"
  (void)lines;
  return {};
}

std::string SetFgRgb(uint8_t r, uint8_t g, uint8_t b) {
  // TODO(tier1): "\x1b[38;2;<r>;<g>;<b>m"
  (void)r;
  (void)g;
  (void)b;
  return {};
}

std::string SetBgRgb(uint8_t r, uint8_t g, uint8_t b) {
  // TODO(tier1): "\x1b[48;2;<r>;<g>;<b>m"
  (void)r;
  (void)g;
  (void)b;
  return {};
}

// ── Hot-path writers ───────────────────────────────────────────────

size_t WriteCursorPosition(char* dst, uint16_t row, uint16_t col) {
  // TODO(tier1): hand-rolled u16→ASCII writer per
  // additions/source-patched/src/socketsecurity/temporal/ixdtf_writer.cc
  // pattern. Output: "\x1b[<row>;<col>H". Max 12 bytes.
  (void)dst;
  (void)row;
  (void)col;
  return 0;
}

size_t WriteFgRgb(char* dst, uint8_t r, uint8_t g, uint8_t b) {
  // TODO(tier1): "\x1b[38;2;<r>;<g>;<b>m". Max 20 bytes.
  (void)dst;
  (void)r;
  (void)g;
  (void)b;
  return 0;
}

size_t WriteBgRgb(char* dst, uint8_t r, uint8_t g, uint8_t b) {
  // TODO(tier1): "\x1b[48;2;<r>;<g>;<b>m". Max 20 bytes.
  (void)dst;
  (void)r;
  (void)g;
  (void)b;
  return 0;
}

size_t WriteAttributes(char* dst, uint8_t attrs) {
  // TODO(tier1): emit chained SGR sequences for set bits in `attrs`.
  // Bit layout per TextAttributes namespace in ansi.hpp. Max 32 bytes.
  (void)dst;
  (void)attrs;
  return 0;
}

}  // namespace tui
