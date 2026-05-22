// Renderer.
//
// Cell-by-cell diff between prev and next buffers. Emits ANSI via the
// hot-path writers in ansi.hpp (WriteCursorPosition, WriteFg/BgRgb,
// WriteAttributes) — no allocations on the per-cell path.

#include "tui/renderer.hpp"

#include <cstddef>
#include <cstdint>

#include <cstring>

#include "tui/ansi.hpp"
#include "tui/buffer.hpp"
#include "tui/cell.hpp"

namespace tui {

namespace {

// Encode a codepoint as UTF-8 into dst. Returns bytes written
// (1..4). Caller guarantees dst has at least 4 bytes free.
size_t EncodeUtf8(uint32_t cp, char* dst) {
  if (cp < 0x80) {
    dst[0] = static_cast<char>(cp);
    return 1;
  }
  if (cp < 0x800) {
    dst[0] = static_cast<char>(0xc0 | (cp >> 6));
    dst[1] = static_cast<char>(0x80 | (cp & 0x3f));
    return 2;
  }
  if (cp < 0x10000) {
    dst[0] = static_cast<char>(0xe0 | (cp >> 12));
    dst[1] = static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
    dst[2] = static_cast<char>(0x80 | (cp & 0x3f));
    return 3;
  }
  dst[0] = static_cast<char>(0xf0 | (cp >> 18));
  dst[1] = static_cast<char>(0x80 | ((cp >> 12) & 0x3f));
  dst[2] = static_cast<char>(0x80 | ((cp >> 6) & 0x3f));
  dst[3] = static_cast<char>(0x80 | (cp & 0x3f));
  return 4;
}

// Worst-case bytes for emitting a single changed cell from a cold state
// (no carry-over fg/bg/attrs): cursor move + fg SGR + bg SGR + attr SGR
// + utf-8 codepoint = 14 + 20 + 20 + 26 + 4 = 84 bytes. Pad for safety.
constexpr size_t kMaxCellEmitLen = 96;

}  // namespace

Renderer::Renderer(uint32_t width, uint32_t height)
    : next_(width, height), prev_(width, height) {
  // prev_ starts as the same default cells as next_; the first Flush
  // emits a full clear (needs_full_redraw_ = true) so the terminal
  // syncs with our state regardless of what was on screen.
}

void Renderer::Resize(uint32_t width, uint32_t height) {
  next_.Resize(width, height);
  prev_.Resize(width, height);
  needs_full_redraw_ = true;
}

size_t Renderer::Flush(char* dst, size_t dst_capacity) {
  const uint32_t w = next_.Width();
  const uint32_t h = next_.Height();
  if (w == 0 || h == 0) {
    return 0;
  }

  char* p = dst;
  char* end = dst + dst_capacity;

  // State carried across cells: track last emitted style so we only
  // re-emit SGR sequences when the style actually changes. -1 sentinel
  // forces emission on first cell.
  int last_fg_r = -1, last_fg_g = -1, last_fg_b = -1;
  int last_bg_r = -1, last_bg_g = -1, last_bg_b = -1;
  int last_attrs = -1;
  // Track last cursor position. We emit a CUP only when the next cell
  // isn't the immediate right neighbor of the previously written one.
  int last_cursor_x = -1, last_cursor_y = -1;

  const bool full_redraw = needs_full_redraw_;
  const Cell* next_data = next_.Data();
  const Cell* prev_data = prev_.Data();

  for (uint32_t y = 0; y < h; ++y) {
    for (uint32_t x = 0; x < w; ++x) {
      const size_t i = static_cast<size_t>(y) * w + x;
      const Cell& cur = next_data[i];
      const Cell& old = prev_data[i];

      if (!full_redraw && cur == old) {
        continue;
      }

      // Safety check: if any single cell emit could overrun, bail.
      // Caller retries with a bigger buffer.
      if (static_cast<size_t>(end - p) < kMaxCellEmitLen) {
        return kFlushOverflow;
      }

      // Cursor move only when we're not in a left-to-right run.
      // Terminal columns/rows are 1-indexed in ANSI CUP.
      const int want_x = static_cast<int>(x) + 1;
      const int want_y = static_cast<int>(y) + 1;
      const bool cursor_adjacent =
          last_cursor_x == want_x - 1 && last_cursor_y == want_y;
      if (!cursor_adjacent) {
        p += WriteCursorPosition(p, static_cast<uint16_t>(want_y),
                                 static_cast<uint16_t>(want_x));
      }

      // Foreground SGR only when fg changed (or first emit).
      if (last_fg_r != cur.fg_r || last_fg_g != cur.fg_g ||
          last_fg_b != cur.fg_b) {
        p += WriteFgRgb(p, cur.fg_r, cur.fg_g, cur.fg_b);
        last_fg_r = cur.fg_r;
        last_fg_g = cur.fg_g;
        last_fg_b = cur.fg_b;
      }

      // Background SGR only when bg changed (or first emit).
      if (last_bg_r != cur.bg_r || last_bg_g != cur.bg_g ||
          last_bg_b != cur.bg_b) {
        p += WriteBgRgb(p, cur.bg_r, cur.bg_g, cur.bg_b);
        last_bg_r = cur.bg_r;
        last_bg_g = cur.bg_g;
        last_bg_b = cur.bg_b;
      }

      // Attr SGR only when attrs changed (or first emit).
      if (last_attrs != cur.attrs) {
        p += WriteAttributes(p, cur.attrs);
        last_attrs = cur.attrs;
      }

      // The codepoint itself, UTF-8 encoded.
      p += EncodeUtf8(cur.codepoint, p);

      last_cursor_x = want_x;
      last_cursor_y = want_y;
    }
  }

  // Trailing SGR reset so the next caller-driven write doesn't inherit
  // our last style. Only emit if we actually wrote anything.
  if (p != dst) {
    // kReset is a compile-time const char[]; sizeof - 1 skips the
    // null terminator without a runtime strlen call.
    constexpr size_t kResetLen = sizeof(kReset) - 1;
    if (static_cast<size_t>(end - p) < kResetLen) {
      return kFlushOverflow;
    }
    std::memcpy(p, kReset, kResetLen);
    p += kResetLen;
  }

  // Commit: prev_ now matches what the terminal shows.
  //
  // Swap rather than copy: prev_ and next_ are both owned by this
  // Renderer; after Flush, the caller's next-frame setup starts with
  // Clear() which overwrites next_'s contents anyway. Swap is three
  // pointer assignments (the internal std::vector pointers); the
  // alternative `prev_ = next_` is a full 12-bytes-per-cell copy —
  // 144 KB for a 200×60 grid, every frame.
  next_.Swap(prev_);
  // After the swap, prev_ holds what the terminal now shows (the
  // former next_), and next_ holds the previous frame's data — which
  // the caller will Clear() on entry to the next render cycle.
  needs_full_redraw_ = false;

  return static_cast<size_t>(p - dst);
}

}  // namespace tui
