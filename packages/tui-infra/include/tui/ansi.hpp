// Public surface for tui-infra ANSI emit primitives.
//
// Status: scaffold + declarations only. Implementations land in Tier 1.
// node-smol's `node:smol-tui` binding will #include this header once the
// additions/source-patched wiring is in place.
//
// Lockstep refs:
//   - js-temporal/temporal-polyfill ← unrelated (the temporal-infra
//     analog of this header is temporal/CalendarBackend.hpp)
//   - socket-stuie's OpenTUI fork (Zig surface):
//     opentui/packages/core/src/zig/ansi.zig — the per-cell hot path
//     `ANSI.moveToOutput / fgColorOutput / bgColorOutput /
//      applyAttributesOutputWriter`
//   - VT100 / xterm SGR sequences:
//     https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
//
// API split:
//   1. Constants — fixed escape sequences for cursor/screen state.
//   2. Cold-path builders — return std::string; called once per setup.
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

extern const char kReset[];                // ESC[0m
extern const char kClear[];                // ESC[2J
extern const char kHome[];                 // ESC[H
extern const char kClearAndHome[];         // ESC[H ESC[2J
extern const char kHideCursor[];           // ESC[?25l
extern const char kShowCursor[];           // ESC[?25h
extern const char kSwitchToAltScreen[];    // ESC[?1049h
extern const char kSwitchToMainScreen[];   // ESC[?1049l
extern const char kBracketedPasteStart[];  // ESC[200~
extern const char kBracketedPasteEnd[];    // ESC[201~
extern const char kBracketedPasteSet[];    // ESC[?2004h
extern const char kBracketedPasteReset[];  // ESC[?2004l
extern const char kResetBackground[];      // ESC[49m
extern const char kResetForeground[];      // ESC[39m
extern const char kEraseBelowCursor[];     // ESC[J
extern const char kNextLine[];             // ESC[E

extern const char kBold[];                 // ESC[1m
extern const char kDim[];                  // ESC[2m
extern const char kItalic[];               // ESC[3m
extern const char kUnderline[];            // ESC[4m
extern const char kBlink[];                // ESC[5m
extern const char kInverse[];              // ESC[7m
extern const char kHidden[];               // ESC[8m
extern const char kStrikethrough[];        // ESC[9m

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

constexpr size_t kMaxCursorPositionLen = 12;  // ESC[65535;65535H
constexpr size_t kMaxRgbSgrLen = 20;          // ESC[38;2;255;255;255m
constexpr size_t kMaxAttrRunLen = 32;         // worst-case multi-attr SGR

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
