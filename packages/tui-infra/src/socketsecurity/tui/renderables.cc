// High-level renderables: borders + word-wrapped text.
//
// Source: opentui v0.2.15 (SHA f464acf).
//   - packages/core/src/lib/border.ts (border glyph sets, BorderStyle enum)
//   - packages/core/src/renderables/Box.ts (box draw)
//   - packages/core/src/renderables/Text.ts (text wrap)
//
// The TS originals are Renderable subclasses that own Yoga layout state.
// Here we strip the Renderable hierarchy and expose pure drawing
// primitives: the JS commit phase computes layout via Yoga (already
// bound through node:smol-tui) and passes the resulting rectangle here.

#include "tui/renderables.hpp"

#include <cstring>

#include "tui/cell.hpp"

namespace tui {

namespace {

// Border glyph table — codepoints for each (BorderStyle × edge) slot.
// Mirrors opentui's BorderChars in packages/core/src/lib/border.ts. The
// glyph order matches the borderCharsToArray output:
//   0=TL, 1=TR, 2=BL, 3=BR, 4=Horizontal, 5=Vertical,
//   6=topT, 7=bottomT, 8=leftT, 9=rightT, 10=cross
//
// We use the same 11-slot layout for forward compatibility with the
// upstream junction renderer (which uses slots 6-10 for table joins);
// the current DrawBox path only reads slots 0-5.
constexpr uint32_t kBorderGlyphs[4][11] = {
    // kSingle
    {0x250C, 0x2510, 0x2514, 0x2518, 0x2500, 0x2502, 0x252C, 0x2534, 0x251C,
     0x2524, 0x253C},
    // kDouble
    {0x2554, 0x2557, 0x255A, 0x255D, 0x2550, 0x2551, 0x2566, 0x2569, 0x2560,
     0x2563, 0x256C},
    // kRounded — corners differ from kSingle; mid-glyphs match kSingle.
    {0x256D, 0x256E, 0x2570, 0x256F, 0x2500, 0x2502, 0x252C, 0x2534, 0x251C,
     0x2524, 0x253C},
    // kHeavy
    {0x250F, 0x2513, 0x2517, 0x251B, 0x2501, 0x2503, 0x2533, 0x253B, 0x2523,
     0x252B, 0x254B},
};

inline Cell MakeCell(uint32_t cp, const BoxStyle& s, bool border_glyph) {
  Cell c{};
  c.codepoint = cp;
  if (border_glyph) {
    c.fg_r = s.border_fg_r;
    c.fg_g = s.border_fg_g;
    c.fg_b = s.border_fg_b;
  } else {
    // Interior fill cells take the background as fg AND bg so a
    // wholly-cleared space character renders as a solid block of bg
    // colour with no readable glyph from a previous frame leaking
    // through.
    c.fg_r = s.bg_r;
    c.fg_g = s.bg_g;
    c.fg_b = s.bg_b;
  }
  c.bg_r = s.bg_r;
  c.bg_g = s.bg_g;
  c.bg_b = s.bg_b;
  c.attrs = s.attrs;
  return c;
}

// Decode one UTF-8 codepoint starting at p. Returns the codepoint and
// advances p by the byte count. Same decoder used in buffer.cc; kept
// inline here to avoid exporting it from CellBuffer's translation unit.
uint32_t DecodeUtf8(const char*& p, const char* end) {
  if (p >= end) {
    return 0;
  }
  const uint8_t b0 = static_cast<uint8_t>(*p);
  if ((b0 & 0x80) == 0) {
    ++p;
    return b0;
  }
  if ((b0 & 0xe0) == 0xc0 && p + 1 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    if ((b1 & 0xc0) == 0x80) {
      p += 2;
      return ((b0 & 0x1fu) << 6) | (b1 & 0x3fu);
    }
  }
  if ((b0 & 0xf0) == 0xe0 && p + 2 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    const uint8_t b2 = static_cast<uint8_t>(*(p + 2));
    if ((b1 & 0xc0) == 0x80 && (b2 & 0xc0) == 0x80) {
      p += 3;
      return ((b0 & 0x0fu) << 12) | ((b1 & 0x3fu) << 6) | (b2 & 0x3fu);
    }
  }
  if ((b0 & 0xf8) == 0xf0 && p + 3 < end) {
    const uint8_t b1 = static_cast<uint8_t>(*(p + 1));
    const uint8_t b2 = static_cast<uint8_t>(*(p + 2));
    const uint8_t b3 = static_cast<uint8_t>(*(p + 3));
    if ((b1 & 0xc0) == 0x80 && (b2 & 0xc0) == 0x80 && (b3 & 0xc0) == 0x80) {
      p += 4;
      return ((b0 & 0x07u) << 18) | ((b1 & 0x3fu) << 12) |
             ((b2 & 0x3fu) << 6) | (b3 & 0x3fu);
    }
  }
  ++p;
  return 0xfffd;
}

// Scan one UTF-8 grapheme (1 byte for ASCII, 2-4 for non-ASCII) without
// decoding. Returns the byte length. Used by the word-wrap line builder
// when it needs to slice raw UTF-8 bytes (no codepoint needed).
size_t Utf8ByteLen(const char* p, const char* end) {
  if (p >= end) {
    return 0;
  }
  const uint8_t b0 = static_cast<uint8_t>(*p);
  if ((b0 & 0x80) == 0) {
    return 1;
  }
  if ((b0 & 0xe0) == 0xc0) {
    return 2;
  }
  if ((b0 & 0xf0) == 0xe0) {
    return 3;
  }
  if ((b0 & 0xf8) == 0xf0) {
    return 4;
  }
  return 1;
}

// Count UTF-8 codepoints in [start, end). Used for measuring whether a
// candidate word fits the remaining line budget — one codepoint per
// cell (CJK/emoji wide-char handling lives in StringWidth, which is a
// future helper).
uint32_t Utf8Codepoints(const char* start, const char* end) {
  uint32_t count = 0;
  const char* p = start;
  while (p < end) {
    p += Utf8ByteLen(p, end);
    ++count;
  }
  return count;
}

}  // namespace

void DrawBox(CellBuffer& buf, uint32_t x, uint32_t y, uint32_t w, uint32_t h,
             const BoxStyle& style) {
  if (w == 0 || h == 0) {
    return;
  }
  const uint32_t glyph_row = static_cast<uint32_t>(style.style);
  const uint32_t* g = kBorderGlyphs[glyph_row];

  const uint32_t left = x;
  const uint32_t right = x + w - 1;
  const uint32_t top = y;
  const uint32_t bottom = y + h - 1;

  // Fill the interior first (so border draws on top of any fill).
  if (style.fill_background) {
    const Cell fill = MakeCell(static_cast<uint32_t>(' '), style,
                               /*border_glyph=*/false);
    // Inset by 1 cell on each side that has a border. Sides without a
    // border get filled edge-to-edge.
    const uint32_t fx = left + (style.sides.left ? 1 : 0);
    const uint32_t fy = top + (style.sides.top ? 1 : 0);
    const uint32_t fw = w - (style.sides.left ? 1 : 0) -
                        (style.sides.right ? 1 : 0);
    const uint32_t fh = h - (style.sides.top ? 1 : 0) -
                        (style.sides.bottom ? 1 : 0);
    if (fw > 0 && fh > 0) {
      buf.FillRect(fx, fy, fw, fh, fill);
    }
  }

  // Single-cell box degenerates: just draw a corner glyph.
  if (w == 1 && h == 1) {
    if (style.sides.top || style.sides.left || style.sides.right ||
        style.sides.bottom) {
      buf.Set(left, top, MakeCell(g[0], style, /*border_glyph=*/true));
    }
    return;
  }

  // Horizontal edges.
  if (style.sides.top) {
    for (uint32_t cx = left + 1; cx + 1 <= right; ++cx) {
      buf.Set(cx, top, MakeCell(g[4], style, /*border_glyph=*/true));
    }
  }
  if (style.sides.bottom && bottom != top) {
    for (uint32_t cx = left + 1; cx + 1 <= right; ++cx) {
      buf.Set(cx, bottom, MakeCell(g[4], style, /*border_glyph=*/true));
    }
  }

  // Vertical edges.
  if (style.sides.left) {
    for (uint32_t cy = top + 1; cy + 1 <= bottom; ++cy) {
      buf.Set(left, cy, MakeCell(g[5], style, /*border_glyph=*/true));
    }
  }
  if (style.sides.right && right != left) {
    for (uint32_t cy = top + 1; cy + 1 <= bottom; ++cy) {
      buf.Set(right, cy, MakeCell(g[5], style, /*border_glyph=*/true));
    }
  }

  // Corners — only emit when both adjacent edges are enabled.
  if (style.sides.top && style.sides.left) {
    buf.Set(left, top, MakeCell(g[0], style, /*border_glyph=*/true));
  }
  if (style.sides.top && style.sides.right) {
    buf.Set(right, top, MakeCell(g[1], style, /*border_glyph=*/true));
  }
  if (style.sides.bottom && style.sides.left) {
    buf.Set(left, bottom, MakeCell(g[2], style, /*border_glyph=*/true));
  }
  if (style.sides.bottom && style.sides.right) {
    buf.Set(right, bottom, MakeCell(g[3], style, /*border_glyph=*/true));
  }
}

uint32_t DrawTextWrapped(CellBuffer& buf, uint32_t x, uint32_t y,
                         uint32_t max_width, uint32_t max_lines,
                         const char* utf8, size_t length, uint8_t fg_r,
                         uint8_t fg_g, uint8_t fg_b, uint8_t bg_r,
                         uint8_t bg_g, uint8_t bg_b, uint8_t attrs) {
  if (utf8 == nullptr || length == 0) {
    return 0;
  }

  // Effective width: caller-supplied max_width, or buffer-right-edge
  // when max_width is 0 (sentinel meaning "extend to edge").
  uint32_t width_budget = max_width;
  if (width_budget == 0) {
    if (x >= buf.Width()) {
      return 0;
    }
    width_budget = buf.Width() - x;
  }
  if (width_budget == 0) {
    return 0;
  }

  uint32_t cur_line = 0;
  uint32_t cur_y = y;

  const char* p = utf8;
  const char* const text_end = utf8 + length;

  while (p < text_end) {
    if (max_lines != 0 && cur_line >= max_lines) {
      break;
    }
    if (cur_y >= buf.Height()) {
      break;
    }

    // Find end of this visual line: walk byte-by-byte, tracking
    // codepoint count + last word-break position. A word break is a
    // run of one or more ASCII space/tab characters.
    const char* line_start = p;
    const char* line_end = p;
    const char* last_break_end = nullptr;  // First byte AFTER the last
                                           // emitted whitespace run, i.e.
                                           // the start of the next word.
    uint32_t line_codepoints = 0;
    bool in_break = false;
    bool hard_break = false;

    const char* scan = p;
    while (scan < text_end) {
      const uint8_t b = static_cast<uint8_t>(*scan);

      // Hard newline ends the line immediately, regardless of width.
      if (b == '\n') {
        line_end = scan;
        hard_break = true;
        ++scan;
        break;
      }

      const bool is_ws = (b == ' ' || b == '\t');
      if (is_ws) {
        if (!in_break) {
          // Just transitioned from word → whitespace. The word ends
          // here; commit a candidate breakpoint at this position.
          line_end = scan;
        }
        in_break = true;
      } else if (in_break) {
        // Whitespace → word transition: this is the start of the
        // next potential word.
        in_break = false;
        last_break_end = scan;
      }

      // Measure this codepoint (1 cell per codepoint for ASCII +
      // basic UTF-8; wide-char handling is the future StringWidth
      // helper).
      const size_t cp_bytes = Utf8ByteLen(scan, text_end);
      const uint32_t new_count = line_codepoints + 1;

      if (new_count > width_budget) {
        // This codepoint would overflow. If we recorded a previous
        // word-end within budget, break there; otherwise, force a
        // hard wrap at the current position (long-word case).
        if (line_end > line_start && line_end <= scan) {
          // line_end already points at the last whitespace start;
          // skip to next word for the next iteration's start.
          if (last_break_end) {
            scan = last_break_end;
          } else {
            // line_end is start of trailing whitespace; consume it
            // before resuming.
            scan = line_end;
            while (scan < text_end &&
                   (*scan == ' ' || *scan == '\t')) {
              ++scan;
            }
          }
        } else {
          // No prior word boundary fits — hard split at current
          // codepoint position.
          line_end = scan;
          // scan stays where it is so we don't lose the codepoint.
        }
        break;
      }

      scan += cp_bytes;
      line_codepoints = new_count;
      line_end = scan;  // Tentatively, the line extends through this cp.
    }

    if (scan == text_end && !hard_break) {
      // Reached end of text without overflow or newline.
      line_end = scan;
    }

    // Emit cells for [line_start, line_end). Use CellBuffer::DrawText
    // for the actual UTF-8 → cell conversion; it handles per-cell fg/
    // bg/attrs identically.
    if (line_end > line_start) {
      buf.DrawText(x, cur_y, line_start, static_cast<size_t>(line_end - line_start),
                   fg_r, fg_g, fg_b, bg_r, bg_g, bg_b, attrs);
    }
    ++cur_line;
    ++cur_y;

    // Advance p past the consumed region. If we broke on whitespace,
    // skip the whitespace run so the next line doesn't start with a
    // space.
    if (hard_break) {
      p = scan;  // scan already past the '\n'.
    } else if (scan > line_end) {
      // We already advanced scan past a whitespace run to next word.
      p = scan;
    } else {
      // Hard-split case: continue from where the break happened.
      p = scan;
      // Eat any leading whitespace at the start of the next line so
      // wraps look clean.
      while (p < text_end && (*p == ' ' || *p == '\t')) {
        ++p;
      }
    }
  }

  // Suppress unused-helper warning when the compiler proves
  // Utf8Codepoints/DecodeUtf8 aren't reached on a given build (they're
  // referenced by future StringWidth + diagnostic helpers in this TU).
  (void)Utf8Codepoints;
  (void)DecodeUtf8;
  return cur_line;
}

}  // namespace tui
