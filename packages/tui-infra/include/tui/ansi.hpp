// Public surface for tui-infra ANSI emit primitives.
//
// 1:1 C++ port of OpenTUI's `ansi.zig` (Zig source vendored into
// socket-stuie's @opentui/core fork at packages/core/upstream/opentui/
// packages/core/src/zig/ansi.zig). The Zig file defines:
//
//   pub const ANSI = struct {
//       pub const reset             = "\x1b[0m";
//       pub const clear             = "\x1b[2J";
//       ...
//       pub fn cursorPosition(...) ...   // CUP — ESC[<row>;<col>H
//       pub fn fgRgbTrue(...) ...        // SGR FG — ESC[38;2;r;g;bm
//       pub fn bgRgbTrue(...) ...        // SGR BG — ESC[48;2;r;g;bm
//       pub fn moveToOutput(...) ...     // CUP into caller buffer
//       pub fn fgColorOutput(...) ...    // SGR into caller buffer
//       pub fn bgColorOutput(...) ...    // SGR into caller buffer
//       pub fn applyAttributesOutputWriter(...) ...  // SGR attrs
//   };
//
// The constants are byte-identical to OpenTUI's. The cold-path
// `std::string`-returning builders mirror `cursorPosition` / `fgRgbTrue`
// / `bgRgbTrue`. The hot-path writers (Write* functions) match the
// `*Output` writers in semantics — write into a caller-provided buffer
// and return bytes written. Per-frame flush uses the hot-path writers
// exclusively to avoid heap traffic.
//
// Wire-protocol references:
//   xterm Control Sequences:
//     https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
//     - #h2-CSI-Ps-_-Ps-H  (CUP — cursor position)
//     - #h2-Character-Attributes-_SGR_  (SGR)
//   VT100 — DEC STD 070 / ECMA-48
//
// API split:
//   1. Constants — fixed escape sequences for cursor/screen state.
//   2. Cold-path builders — return std::string; called once per setup
//      (banner, alt-screen switch, etc.). NOT the per-frame path.
//   3. Hot-path writers — write into caller-provided char* buffer,
//      return bytes written. These are the V8 FastApi targets — JS
//      hands us a Uint8Array, we fill it without allocation.

#ifndef TUI_INFRA_ANSI_HPP_
#define TUI_INFRA_ANSI_HPP_

#include <cstddef>
#include <cstdint>
#include <string>

namespace tui {

// ── Constants ──────────────────────────────────────────────────────
// All terminate with '\0' so JS-side `Buffer.from(constant)` works.
// Defined inline so `sizeof(kX)` is a compile-time constant at every
// callsite (was extern-declared as incomplete array; sizeof on an
// incomplete type doesn't compile).

inline constexpr char kReset[] = "\x1b[0m";
inline constexpr char kClear[] = "\x1b[2J";
inline constexpr char kHome[] = "\x1b[H";
inline constexpr char kClearAndHome[] = "\x1b[H\x1b[2J";
inline constexpr char kHideCursor[] = "\x1b[?25l";
inline constexpr char kShowCursor[] = "\x1b[?25h";
inline constexpr char kSwitchToAltScreen[] = "\x1b[?1049h";
inline constexpr char kSwitchToMainScreen[] = "\x1b[?1049l";
inline constexpr char kBracketedPasteStart[] = "\x1b[200~";
inline constexpr char kBracketedPasteEnd[] = "\x1b[201~";
inline constexpr char kBracketedPasteSet[] = "\x1b[?2004h";
inline constexpr char kBracketedPasteReset[] = "\x1b[?2004l";
inline constexpr char kResetBackground[] = "\x1b[49m";
inline constexpr char kResetForeground[] = "\x1b[39m";
inline constexpr char kEraseBelowCursor[] = "\x1b[J";
inline constexpr char kNextLine[] = "\x1b[E";

inline constexpr char kBold[] = "\x1b[1m";
inline constexpr char kDim[] = "\x1b[2m";
inline constexpr char kItalic[] = "\x1b[3m";
inline constexpr char kUnderline[] = "\x1b[4m";
inline constexpr char kBlink[] = "\x1b[5m";
inline constexpr char kInverse[] = "\x1b[7m";
inline constexpr char kHidden[] = "\x1b[8m";
inline constexpr char kStrikethrough[] = "\x1b[9m";

// ── Cold-path builders ─────────────────────────────────────────────
// Allocate a std::string. Use for one-shot setup / teardown writes
// (banner, screen-switch). NOT for the per-frame render loop.

// Move cursor to (row, col), 1-indexed (CUP — ESC[<row>;<col>H).
std::string CursorPosition(uint16_t row, uint16_t col);

// Cursor move followed by erase-to-end-of-screen.
std::string MoveCursorAndClear(uint16_t row, uint16_t col);

// Scroll the viewport up/down by N lines (SU/SD — ESC[<n>S, ESC[<n>T).
std::string ScrollDown(uint16_t lines);
std::string ScrollUp(uint16_t lines);

// 24-bit truecolor SGR — ESC[38;2;<r>;<g>;<b>m / ESC[48;2;<r>;<g>;<b>m.
// OpenTUI emits truecolor exclusively (no 256-color path).
std::string SetFgRgb(uint8_t r, uint8_t g, uint8_t b);
std::string SetBgRgb(uint8_t r, uint8_t g, uint8_t b);

// ── Hot-path writers (FastApi candidates) ──────────────────────────
// Write into caller-provided buffer. Buffer must be at least the
// kMax* size for that function. Return bytes written.
//
// Called per-cell-change in the renderer flush loop. V8 FastApi
// inlines these so the JS↔C++ boundary cost approaches zero.

constexpr size_t kMaxCursorPositionLen = 14;  // ESC[65535;65535H = 14 bytes
constexpr size_t kMaxRgbSgrLen = 20;          // ESC[38;2;255;255;255m
constexpr size_t kMaxAttrRunLen = 26;         // ESC[1;2;3;4;5;7;8;9m = 18; pad to 26

size_t WriteCursorPosition(char* dst, uint16_t row, uint16_t col);
size_t WriteFgRgb(char* dst, uint8_t r, uint8_t g, uint8_t b);
size_t WriteBgRgb(char* dst, uint8_t r, uint8_t g, uint8_t b);

// Apply a bitfield of attributes. Matches OpenTUI's ansi.zig
// TextAttributes layout (see TextAttributes namespace below).
size_t WriteAttributes(char* dst, uint8_t attrs);

// ── TextAttributes mirror ──────────────────────────────────────────
// 1:1 with socket-stuie/packages/core/upstream/opentui/packages/core/
//   src/zig/ansi.zig:186 `pub const TextAttributes = struct { ... }`.
// Bit positions must stay in sync with the Zig source.

namespace TextAttributes {
constexpr uint8_t kNone = 0;
constexpr uint8_t kBold = 1 << 0;
constexpr uint8_t kDim = 1 << 1;
constexpr uint8_t kItalic = 1 << 2;
constexpr uint8_t kUnderline = 1 << 3;
constexpr uint8_t kBlink = 1 << 4;
constexpr uint8_t kInverse = 1 << 5;
constexpr uint8_t kHidden = 1 << 6;
constexpr uint8_t kStrikethrough = 1 << 7;
}  // namespace TextAttributes

}  // namespace tui

#endif  // TUI_INFRA_ANSI_HPP_
