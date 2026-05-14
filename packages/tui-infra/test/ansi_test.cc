// Tier 1 self-contained test for tui::* ANSI emit primitives.
//
// Builds with system clang++ via scripts/test.mts. Hits both the cold-
// path (std::string builders) and hot-path (char* writers) so wire
// format and buffer-bounds contracts are covered.

#include "tui/ansi.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>

namespace {

int failures = 0;

void Expect(const std::string& actual, const char* expected,
            const char* label) {
  if (actual == expected) {
    return;
  }
  std::fprintf(stderr, "FAIL %s\n  want: ", label);
  for (char c : std::string(expected)) {
    if (c == '\x1b') std::fputs("\\e", stderr);
    else std::fputc(c, stderr);
  }
  std::fprintf(stderr, "\n  got:  ");
  for (char c : actual) {
    if (c == '\x1b') std::fputs("\\e", stderr);
    else std::fputc(c, stderr);
  }
  std::fputc('\n', stderr);
  ++failures;
}

void ExpectHot(size_t (*fn)(char*, uint16_t, uint16_t), uint16_t a,
               uint16_t b, const char* expected, const char* label) {
  char buf[64] = {0};
  size_t n = fn(buf, a, b);
  Expect(std::string(buf, n), expected, label);
}

void ExpectHotRgb(size_t (*fn)(char*, uint8_t, uint8_t, uint8_t),
                  uint8_t r, uint8_t g, uint8_t bch, const char* expected,
                  const char* label) {
  char buf[64] = {0};
  size_t n = fn(buf, r, g, bch);
  Expect(std::string(buf, n), expected, label);
}

}  // namespace

int main() {
  using namespace tui;

  // Constants — sanity check a representative subset.
  Expect(kReset, "\x1b[0m", "kReset");
  Expect(kClearAndHome, "\x1b[H\x1b[2J", "kClearAndHome");
  Expect(kHideCursor, "\x1b[?25l", "kHideCursor");
  Expect(kSwitchToAltScreen, "\x1b[?1049h", "kSwitchToAltScreen");
  Expect(kBracketedPasteSet, "\x1b[?2004h", "kBracketedPasteSet");

  // Cold-path builders.
  Expect(CursorPosition(1, 1), "\x1b[1;1H", "CursorPosition(1,1)");
  Expect(CursorPosition(24, 80), "\x1b[24;80H", "CursorPosition(24,80)");
  Expect(CursorPosition(65535, 65535), "\x1b[65535;65535H",
         "CursorPosition(65535,65535)");
  Expect(MoveCursorAndClear(5, 3), "\x1b[5;3H\x1b[J",
         "MoveCursorAndClear(5,3)");
  Expect(ScrollUp(1), "\x1b[1S", "ScrollUp(1)");
  Expect(ScrollDown(10), "\x1b[10T", "ScrollDown(10)");

  Expect(SetFgRgb(0, 0, 0), "\x1b[38;2;0;0;0m", "SetFgRgb(0,0,0)");
  Expect(SetFgRgb(255, 128, 64), "\x1b[38;2;255;128;64m",
         "SetFgRgb(255,128,64)");
  Expect(SetBgRgb(255, 255, 255), "\x1b[48;2;255;255;255m",
         "SetBgRgb(255,255,255)");

  // Hot-path writers — must match cold-path output byte-for-byte.
  ExpectHot(WriteCursorPosition, 1, 1, "\x1b[1;1H",
            "WriteCursorPosition(1,1)");
  ExpectHot(WriteCursorPosition, 24, 80, "\x1b[24;80H",
            "WriteCursorPosition(24,80)");
  ExpectHot(WriteCursorPosition, 65535, 65535, "\x1b[65535;65535H",
            "WriteCursorPosition(max)");

  ExpectHotRgb(WriteFgRgb, 0, 0, 0, "\x1b[38;2;0;0;0m",
               "WriteFgRgb(0,0,0)");
  ExpectHotRgb(WriteFgRgb, 255, 128, 64, "\x1b[38;2;255;128;64m",
               "WriteFgRgb(255,128,64)");
  ExpectHotRgb(WriteBgRgb, 255, 255, 255, "\x1b[48;2;255;255;255m",
               "WriteBgRgb(255,255,255)");

  // Attribute writer: kNone resets, single bit emits its SGR code,
  // multi-bit chains.
  {
    char buf[64] = {0};
    size_t n = WriteAttributes(buf, TextAttributes::kNone);
    Expect(std::string(buf, n), "\x1b[0m", "WriteAttributes(none)");
  }
  {
    char buf[64] = {0};
    size_t n = WriteAttributes(buf, TextAttributes::kBold);
    Expect(std::string(buf, n), "\x1b[1m", "WriteAttributes(bold)");
  }
  {
    char buf[64] = {0};
    size_t n = WriteAttributes(buf,
        TextAttributes::kBold | TextAttributes::kUnderline);
    Expect(std::string(buf, n), "\x1b[1;4m",
           "WriteAttributes(bold|underline)");
  }
  {
    // All 8 bits set: 1;2;3;4;5;7;8;9 (skipping 6, which is "rapid blink"
    // and not in the standard OpenTUI surface).
    char buf[64] = {0};
    uint8_t all = TextAttributes::kBold | TextAttributes::kDim |
                  TextAttributes::kItalic | TextAttributes::kUnderline |
                  TextAttributes::kBlink | TextAttributes::kInverse |
                  TextAttributes::kHidden | TextAttributes::kStrikethrough;
    size_t n = WriteAttributes(buf, all);
    Expect(std::string(buf, n), "\x1b[1;2;3;4;5;7;8;9m",
           "WriteAttributes(all)");
  }

  // Bounds: every hot-path write must stay within its kMax* budget.
  {
    char buf[kMaxCursorPositionLen] = {0};
    size_t n = WriteCursorPosition(buf, 65535, 65535);
    assert(n <= kMaxCursorPositionLen);
  }
  {
    char buf[kMaxRgbSgrLen] = {0};
    size_t n = WriteFgRgb(buf, 255, 255, 255);
    assert(n <= kMaxRgbSgrLen);
  }
  {
    char buf[kMaxAttrRunLen] = {0};
    uint8_t all = 0xff;
    size_t n = WriteAttributes(buf, all);
    assert(n <= kMaxAttrRunLen);
  }

  if (failures == 0) {
    std::printf("ok %s\n", "tui-infra/ansi");
    return 0;
  }
  std::fprintf(stderr, "%d failure(s)\n", failures);
  return 1;
}
