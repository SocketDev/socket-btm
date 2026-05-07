// High-level renderables built atop CellBuffer primitives.
//
// 1:1 port of OpenTUI's box/text-drawing helpers
// (packages/core/src/lib/border.ts + packages/core/src/renderables/Box.ts +
// renderables/Text.ts). The TS originals are Renderable subclasses that
// own Yoga layout state + draw via OptimizedBuffer; here we strip the
// Renderable hierarchy and expose the pure drawing primitives that the
// JS commit phase will call into. Yoga layout stays in the
// `node:smol-tui` Yoga binding; this header just consumes computed
// rectangles.
//
// Hot path: every render-tree node turns into one DrawBox or one
// DrawTextWrapped call. Splitting the box into perimeter + fill in C++
// shaves out the per-edge JS dispatch (the TS BoxRenderable does 4-12
// fillRect calls per node) and removes glyph-set lookup overhead.

#ifndef TUI_INFRA_RENDERABLES_HPP_
#define TUI_INFRA_RENDERABLES_HPP_

#include <cstdint>

#include "tui/buffer.hpp"

namespace tui {

// Border style enum — matches the four BorderStyle values in
// packages/core/src/lib/border.ts. Numeric values are stable across the
// JS↔C++ boundary; the JS facade re-exports them as a frozen enum
// object.
enum class BorderStyle : uint8_t {
  kSingle = 0,
  kDouble = 1,
  kRounded = 2,
  kHeavy = 3,
};

// Per-edge enable flags. The TS surface accepts a `boolean | BorderSides[]`
// arg; on the C++ side we collapse to a bitfield. The JS facade does the
// conversion.
struct BorderSides {
  bool top = true;
  bool right = true;
  bool bottom = true;
  bool left = true;
};

struct BoxStyle {
  BorderStyle style = BorderStyle::kSingle;
  BorderSides sides{};
  uint8_t border_fg_r = 255;
  uint8_t border_fg_g = 255;
  uint8_t border_fg_b = 255;
  uint8_t bg_r = 0;
  uint8_t bg_g = 0;
  uint8_t bg_b = 0;
  uint8_t attrs = 0;
  bool fill_background = false;  // When false, only the border is drawn.
};

// Draw a box (border + optional fill) into `buf` covering the rect
// `(x, y, w, h)`. Out-of-bounds is clipped. When `style.fill_background`
// is true, the interior cells are filled with the background style; when
// false, only the perimeter is touched (existing interior content
// preserved). 1-character border, 1-cell width on every side.
void DrawBox(CellBuffer& buf, uint32_t x, uint32_t y, uint32_t w, uint32_t h,
             const BoxStyle& style);

// Draw `text` starting at `(x, y)`. When `max_width` is non-zero, breaks
// at the last word boundary that fits (whitespace-split); when
// `max_width` is zero, lines extend to the buffer's right edge. When
// `max_lines` is non-zero, truncates after that many emitted lines.
// Returns the number of lines emitted.
//
// Word boundary: ASCII space + tab. CJK / emoji: each codepoint counts
// as a single cell (matching the CellBuffer::DrawText fast path).
uint32_t DrawTextWrapped(CellBuffer& buf, uint32_t x, uint32_t y,
                         uint32_t max_width, uint32_t max_lines,
                         const char* utf8, size_t length, uint8_t fg_r,
                         uint8_t fg_g, uint8_t fg_b, uint8_t bg_r,
                         uint8_t bg_g, uint8_t bg_b, uint8_t attrs);

}  // namespace tui

#endif  // TUI_INFRA_RENDERABLES_HPP_
