// Test for tui::CellBuffer + tui::Renderer.
//
// Exercises the diff path with a few representative scenarios: empty
// frame stays empty, full-screen write emits all cells, second frame
// with one cell changed emits only that cell, and resize forces a full
// redraw on the next flush.

#include "tui/buffer.hpp"
#include "tui/cell.hpp"
#include "tui/renderer.hpp"

#include <cassert>
#include <cstdio>
#include <cstring>
#include <string>

namespace {

int failures = 0;

void Expect(bool ok, const char* label) {
  if (!ok) {
    std::fprintf(stderr, "FAIL %s\n", label);
    ++failures;
  }
}

void ExpectContains(const std::string& haystack, const char* needle,
                    const char* label) {
  if (haystack.find(needle) == std::string::npos) {
    std::fprintf(stderr, "FAIL %s\n  haystack (escaped): ", label);
    for (char c : haystack) {
      if (c == '\x1b') std::fputs("\\e", stderr);
      else std::fputc(c, stderr);
    }
    std::fprintf(stderr, "\n  expected to contain: ");
    for (const char* q = needle; *q; ++q) {
      if (*q == '\x1b') std::fputs("\\e", stderr);
      else std::fputc(*q, stderr);
    }
    std::fputc('\n', stderr);
    ++failures;
  }
}

}  // namespace

int main() {
  using namespace tui;

  // CellBuffer Resize + Get.
  {
    CellBuffer buf(10, 5);
    Expect(buf.Width() == 10, "buf.Width()=10");
    Expect(buf.Height() == 5, "buf.Height()=5");
    Cell c = buf.Get(0, 0);
    Expect(c.codepoint == U' ', "default cell codepoint is space");
    // Out-of-bounds Get returns empty Cell, doesn't crash.
    Cell oob = buf.Get(100, 100);
    Expect(oob.codepoint == U' ', "oob Get returns default cell");
  }

  // CellBuffer Set + Get round-trip.
  {
    CellBuffer buf(10, 5);
    Cell red_a{};
    red_a.codepoint = U'A';
    red_a.fg_r = 255;
    buf.Set(3, 2, red_a);
    Cell got = buf.Get(3, 2);
    Expect(got.codepoint == U'A' && got.fg_r == 255, "Set/Get round-trip");
    // Out-of-bounds Set is a no-op.
    buf.Set(999, 999, red_a);  // shouldn't crash.
  }

  // CellBuffer FillRect clips.
  {
    CellBuffer buf(5, 3);
    Cell hash{};
    hash.codepoint = U'#';
    buf.FillRect(2, 1, 100, 100, hash);  // Width/height way past end.
    Expect(buf.Get(2, 1).codepoint == U'#', "FillRect filled (2,1)");
    Expect(buf.Get(4, 2).codepoint == U'#', "FillRect filled (4,2)");
    Expect(buf.Get(0, 0).codepoint == U' ', "FillRect didn't touch (0,0)");
  }

  // CellBuffer DrawText with ASCII.
  {
    CellBuffer buf(20, 1);
    buf.DrawText(0, 0, "Hi!", 3, 255, 255, 255, 0, 0, 0, 0);
    Expect(buf.Get(0, 0).codepoint == U'H', "DrawText H");
    Expect(buf.Get(1, 0).codepoint == U'i', "DrawText i");
    Expect(buf.Get(2, 0).codepoint == U'!', "DrawText !");
    Expect(buf.Get(3, 0).codepoint == U' ', "DrawText didn't overrun");
  }

  // CellBuffer DrawText with UTF-8 (2-byte + 3-byte).
  {
    CellBuffer buf(10, 1);
    // "©" = U+00A9 (2 bytes), "→" = U+2192 (3 bytes).
    const char* s = "\xc2\xa9\xe2\x86\x92X";
    buf.DrawText(0, 0, s, 6, 0, 0, 0, 0, 0, 0, 0);
    Expect(buf.Get(0, 0).codepoint == 0x00a9, "DrawText © (2-byte UTF-8)");
    Expect(buf.Get(1, 0).codepoint == 0x2192, "DrawText → (3-byte UTF-8)");
    Expect(buf.Get(2, 0).codepoint == U'X', "DrawText X (ASCII follow-up)");
  }

  // Renderer: first Flush with all-default cells writes a trailing
  // reset only (cells == default, no per-cell emit content, but
  // needs_full_redraw forces a pass — but since cur == old per default,
  // we still skip per-cell emit, since the diff branch is
  // `!full_redraw && cur == old → continue` ⇒ on full_redraw cells DO
  // emit. Default cells emit black-on-black space at (1,1)..(W,H).)
  {
    Renderer r(4, 1);
    char buf[1024] = {0};
    size_t n = r.Flush(buf, sizeof(buf));
    Expect(n > 0, "first Flush wrote bytes (full-redraw)");
    // Should contain at least one cursor-position move + ESC[0m.
    std::string out(buf, n);
    ExpectContains(out, "\x1b[1;1H", "Flush moves cursor to (1,1)");
    ExpectContains(out, "\x1b[0m", "Flush ends with SGR reset");
  }

  // Renderer: second Flush with identical content emits nothing.
  {
    Renderer r(4, 1);
    char buf1[1024] = {0};
    r.Flush(buf1, sizeof(buf1));
    char buf2[1024] = {0};
    size_t n = r.Flush(buf2, sizeof(buf2));
    Expect(n == 0, "second identical Flush is no-op");
  }

  // Renderer: change one cell, only that cell flushes.
  {
    Renderer r(10, 1);
    // First Flush establishes baseline.
    char baseline[2048] = {0};
    r.Flush(baseline, sizeof(baseline));

    // Set one cell to 'X' with white fg, then Flush again.
    Cell x_white{};
    x_white.codepoint = U'X';
    x_white.fg_r = 255;
    x_white.fg_g = 255;
    x_white.fg_b = 255;
    r.Next().Set(5, 0, x_white);

    char delta[2048] = {0};
    size_t n = r.Flush(delta, sizeof(delta));
    std::string out(delta, n);
    Expect(n > 0, "Delta Flush wrote bytes");
    ExpectContains(out, "\x1b[1;6H", "Delta moves cursor to (1,6)");
    ExpectContains(out, "\x1b[38;2;255;255;255m",
                   "Delta emits white fg SGR");
    ExpectContains(out, "X", "Delta emits X codepoint");
    // Critically: should NOT contain a move to (1,1) — only the
    // changed cell. As long as only one cursor move was needed.
    Expect(out.find("\x1b[1;1H") == std::string::npos,
           "Delta does NOT emit (1,1) cursor move");
  }

  // Renderer: Resize forces a full redraw on next Flush.
  {
    Renderer r(2, 1);
    char buf1[256] = {0};
    r.Flush(buf1, sizeof(buf1));
    // After first Flush, second Flush would be no-op without resize.
    // Resize should re-fire a full redraw.
    r.Resize(2, 1);  // same dims to test the invalidation path.
    char buf2[256] = {0};
    size_t n = r.Flush(buf2, sizeof(buf2));
    Expect(n > 0, "Flush after Resize re-emits full frame");
  }

  // Renderer: Flush returns kFlushOverflow when buffer is too small.
  {
    Renderer r(100, 50);  // 5000 cells — generous worst case.
    Cell hash{};
    hash.codepoint = U'#';
    r.Next().FillRect(0, 0, 100, 50, hash);
    char tiny[32] = {0};
    size_t n = r.Flush(tiny, sizeof(tiny));
    Expect(n == Renderer::kFlushOverflow,
           "Flush signals overflow on too-small buffer");
  }

  if (failures == 0) {
    std::printf("ok %s\n", "tui-infra/renderer");
    return 0;
  }
  std::fprintf(stderr, "%d failure(s)\n", failures);
  return 1;
}
