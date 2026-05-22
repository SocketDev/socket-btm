// ANSI emit primitives.
//
// Lockstep reference: socket-stuie's OpenTUI fork
// (opentui/packages/core/src/zig/ansi.zig). Cold-path builders return
// std::string for one-shot setup/teardown writes; hot-path writers
// fill caller-provided char buffers without allocation so they can be
// targeted by V8 FastApi from node:smol-tui.

#include "tui/ansi.hpp"

#include <cstring>

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

namespace {

// Branchless u16→ASCII, returns digits written. Mirrors the
// ixdtf_writer.cc U32ToDigits pattern but writes into a caller buffer
// instead of a digit-array struct.
size_t WriteU16(char* dst, uint16_t value) {
  if (value < 10) {
    dst[0] = static_cast<char>('0' + value);
    return 1;
  }
  if (value < 100) {
    dst[0] = static_cast<char>('0' + (value / 10));
    dst[1] = static_cast<char>('0' + (value % 10));
    return 2;
  }
  if (value < 1000) {
    dst[0] = static_cast<char>('0' + (value / 100));
    dst[1] = static_cast<char>('0' + ((value / 10) % 10));
    dst[2] = static_cast<char>('0' + (value % 10));
    return 3;
  }
  if (value < 10000) {
    dst[0] = static_cast<char>('0' + (value / 1000));
    dst[1] = static_cast<char>('0' + ((value / 100) % 10));
    dst[2] = static_cast<char>('0' + ((value / 10) % 10));
    dst[3] = static_cast<char>('0' + (value % 10));
    return 4;
  }
  dst[0] = static_cast<char>('0' + (value / 10000));
  dst[1] = static_cast<char>('0' + ((value / 1000) % 10));
  dst[2] = static_cast<char>('0' + ((value / 100) % 10));
  dst[3] = static_cast<char>('0' + ((value / 10) % 10));
  dst[4] = static_cast<char>('0' + (value % 10));
  return 5;
}

// Specialized u8 → decimal emitter. uint8_t maxes out at 255, so the
// `< 1000`, `< 10000`, and `< 100000` cases from WriteU16 are dead
// code. Hard-coding the three branches (1/2/3 digit) saves ~3-4
// branches per call versus the generic u16 path.
//
// Per-cell RGB SGR writes call WriteU8 three times each (one per
// channel); on a 12 k-cell diff frame that's up to 36 k calls, so
// even the small branch savings add up.
inline size_t WriteU8(char* dst, uint8_t value) {
  if (value < 10) {
    dst[0] = static_cast<char>('0' + value);
    return 1;
  }
  if (value < 100) {
    dst[0] = static_cast<char>('0' + (value / 10));
    dst[1] = static_cast<char>('0' + (value % 10));
    return 2;
  }
  // 100..255: always 3 digits.
  dst[0] = static_cast<char>('0' + (value / 100));
  dst[1] = static_cast<char>('0' + ((value / 10) % 10));
  dst[2] = static_cast<char>('0' + (value % 10));
  return 3;
}

// Append a u16 as ASCII digits to a std::string. Used by cold-path
// builders. Worst case for a u16 is 5 digits.
void AppendU16(std::string& sink, uint16_t value) {
  char buf[5];
  size_t n = WriteU16(buf, value);
  sink.append(buf, n);
}

}  // namespace

// ── Cold-path builders ─────────────────────────────────────────────

std::string CursorPosition(uint16_t row, uint16_t col) {
  std::string out;
  out.reserve(kMaxCursorPositionLen);
  out.append("\x1b[", 2);
  AppendU16(out, row);
  out.push_back(';');
  AppendU16(out, col);
  out.push_back('H');
  return out;
}

std::string MoveCursorAndClear(uint16_t row, uint16_t col) {
  std::string out = CursorPosition(row, col);
  out.append(kEraseBelowCursor);
  return out;
}

std::string ScrollDown(uint16_t lines) {
  std::string out;
  out.reserve(8);
  out.append("\x1b[", 2);
  AppendU16(out, lines);
  out.push_back('T');
  return out;
}

std::string ScrollUp(uint16_t lines) {
  std::string out;
  out.reserve(8);
  out.append("\x1b[", 2);
  AppendU16(out, lines);
  out.push_back('S');
  return out;
}

std::string SetFgRgb(uint8_t r, uint8_t g, uint8_t b) {
  std::string out;
  out.reserve(kMaxRgbSgrLen);
  out.append("\x1b[38;2;", 7);
  AppendU16(out, r);
  out.push_back(';');
  AppendU16(out, g);
  out.push_back(';');
  AppendU16(out, b);
  out.push_back('m');
  return out;
}

std::string SetBgRgb(uint8_t r, uint8_t g, uint8_t b) {
  std::string out;
  out.reserve(kMaxRgbSgrLen);
  out.append("\x1b[48;2;", 7);
  AppendU16(out, r);
  out.push_back(';');
  AppendU16(out, g);
  out.push_back(';');
  AppendU16(out, b);
  out.push_back('m');
  return out;
}

// ── Hot-path writers ───────────────────────────────────────────────

size_t WriteCursorPosition(char* dst, uint16_t row, uint16_t col) {
  // "\x1b[<row>;<col>H" — worst case ESC[65535;65535H = 12 bytes.
  char* p = dst;
  *p++ = '\x1b';
  *p++ = '[';
  p += WriteU16(p, row);
  *p++ = ';';
  p += WriteU16(p, col);
  *p++ = 'H';
  return static_cast<size_t>(p - dst);
}

size_t WriteFgRgb(char* dst, uint8_t r, uint8_t g, uint8_t b) {
  // "\x1b[38;2;<r>;<g>;<b>m" — worst case 20 bytes.
  char* p = dst;
  std::memcpy(p, "\x1b[38;2;", 7);
  p += 7;
  p += WriteU8(p, r);
  *p++ = ';';
  p += WriteU8(p, g);
  *p++ = ';';
  p += WriteU8(p, b);
  *p++ = 'm';
  return static_cast<size_t>(p - dst);
}

size_t WriteBgRgb(char* dst, uint8_t r, uint8_t g, uint8_t b) {
  // "\x1b[48;2;<r>;<g>;<b>m" — worst case 20 bytes.
  char* p = dst;
  std::memcpy(p, "\x1b[48;2;", 7);
  p += 7;
  p += WriteU8(p, r);
  *p++ = ';';
  p += WriteU8(p, g);
  *p++ = ';';
  p += WriteU8(p, b);
  *p++ = 'm';
  return static_cast<size_t>(p - dst);
}

size_t WriteAttributes(char* dst, uint8_t attrs) {
  // Emit a single chained SGR sequence: ESC[<n>;<n>;...m. attrs=0
  // resolves to the SGR reset (ESC[0m). Bit positions match Zig
  // upstream's TextAttributes struct so the wire format is identical
  // to OpenTUI output. Worst case: all 8 bits set + reset = 32 bytes.
  //
  // Iteration walks only SET bits via __builtin_ctz: typical cells
  // have 0-2 attrs set, so the loop runs 0-2 iterations instead of
  // the 8 unconditional iterations a bit-mask-scan loop would do.
  // For BOLD-only text (common case) that's 1 iteration vs 8.
  char* p = dst;
  *p++ = '\x1b';
  *p++ = '[';
  if (attrs == TextAttributes::kNone) {
    *p++ = '0';
    *p++ = 'm';
    return static_cast<size_t>(p - dst);
  }
  // SGR codes mirror the kBold/kDim/... constants above (1..5, 7..9).
  static constexpr uint8_t kSgrCode[8] = {1, 2, 3, 4, 5, 7, 8, 9};
  bool first = true;
  uint32_t bits = attrs;
  while (bits != 0) {
#if defined(__GNUC__) || defined(__clang__)
    const unsigned bit_idx = __builtin_ctz(bits);
#else
    // MSVC fallback: same semantics via _BitScanForward.
    unsigned long bit_idx_long;
    _BitScanForward(&bit_idx_long, bits);
    const unsigned bit_idx = static_cast<unsigned>(bit_idx_long);
#endif
    if (!first) {
      *p++ = ';';
    }
    first = false;
    p += WriteU8(p, kSgrCode[bit_idx]);
    // Clear the lowest set bit so the next __builtin_ctz finds the
    // next-higher set bit. `bits & (bits - 1)` is the canonical
    // branchless "clear lowest set bit" trick.
    bits &= bits - 1;
  }
  *p++ = 'm';
  return static_cast<size_t>(p - dst);
}

}  // namespace tui
