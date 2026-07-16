// String width — terminal display columns for a UTF-8 string.
//
// Computes the number of terminal cells a string occupies when
// rendered, per the Unicode East_Asian_Width property (UAX #11) plus
// emoji presentation (UAX #51). Uses Unicode 17.0.0 data — aligned
// with the fleet-wide Unicode pin tracked across ultrathink/acorn's
// Go / C++ / Rust / TypeScript implementations.
//
// Width rules:
//   - East Asian Wide (W) + Full-width (F)        → 2 cells
//   - Emoji_Presentation codepoints                → 2 cells
//   - Combining marks, control chars, format codepoints → 0 cells
//   - Everything else                              → 1 cell
//
// Limitations (intentional, kept for the JS fast path):
//   - ZWJ sequences (e.g. `family: 👨‍👩‍👧`) are counted as the sum of
//     their components. Most ZWJ sequences render as a single cluster
//     in modern terminals; callers that need cluster-aware width
//     should layer the `emoji-regex` library on top in JS for the
//     edge cases.
//   - Variation selectors are zero-width (covered) but they don't
//     change the width of the preceding base character. A text-style
//     `❤︎` (heart + VS-15) renders 1 cell on most terminals and 2 on
//     others; we return 1 (the base character is 1, VS is 0). This
//     matches the npm `string-width` package's behavior.
//   - Grapheme clusters (Hangul jamos, Devanagari conjuncts) are
//     summed by codepoint width. Hangul L/V/T jamos already have
//     EAW=W and combine correctly; other scripts may over-count.

#ifndef TUI_INFRA_WIDTH_HPP_
#define TUI_INFRA_WIDTH_HPP_

#include <cstddef>
#include <cstdint>

namespace tui {

// Return the display width (terminal cells) of the UTF-8 input
// `[utf8, utf8 + length)`. ASCII-only input is O(length) with a tight
// inner loop; non-ASCII inputs do one binary-search per codepoint.
uint32_t StringWidth(const char* utf8, size_t length);

// Return the display width of a single codepoint. Used by callers
// (e.g. DrawTextWrapped) that already have the codepoint and want to
// skip the UTF-8 decode.
uint32_t CodepointWidth(uint32_t cp);

}  // namespace tui

#endif  // TUI_INFRA_WIDTH_HPP_
