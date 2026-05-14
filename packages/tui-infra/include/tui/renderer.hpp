// Renderer — double-buffered cell-grid diff + ANSI emit.
//
// 1:1 port of OpenTUI's CliRenderer render loop:
//   opentui/packages/core/src/zig/renderer.zig
//     pub const CliRenderer = struct {
//         next: OptimizedBuffer,    // caller-drawn frame
//         prev: OptimizedBuffer,    // last-flushed state (for diff)
//         needs_full_redraw: bool,  // force on resize / signal-reentry
//         pub fn render(...) void   // walk both → emit ANSI for changes
//         pub fn invalidate(...) void
//         pub fn resize(...) void
//     };
//
// Per-frame contract:
//   1. caller draws into `next` (CellBuffer setters)
//   2. caller calls Flush(dst, dstCapacity)
//   3. Flush walks every cell, compares next vs prev:
//        - identical: skip (no ANSI emitted)
//        - differs:   emit cursor-move + style-set + codepoint
//      Using the hot-path writers in ansi.hpp (WriteCursorPosition /
//      WriteFg/BgRgb / WriteAttributes) which are zero-allocation.
//   4. prev ↔ next are swapped; caller's next-frame Clear starts fresh.
//
// The flush loop is the actual perf-critical path of a TUI app: every
// keystroke triggers one. No allocations on the per-cell path; the
// output Uint8Array is reused frame-to-frame.
//
// kFlushOverflow: returned when `dst` would overflow before the frame
// finishes. Caller should grow the buffer and retry on the same
// (unswapped) state — Renderer guarantees Flush is restartable until it
// succeeds. JS callers should size the buffer to
// `width * height * (kMaxCursorPositionLen + 2*kMaxRgbSgrLen +
//                    kMaxAttrRunLen + 4 bytes UTF-8)`
// to avoid retries on the common case.

#ifndef TUI_INFRA_RENDERER_HPP_
#define TUI_INFRA_RENDERER_HPP_

#include <cstddef>
#include <cstdint>

#include "tui/buffer.hpp"
#include "tui/cell.hpp"

namespace tui {

class Renderer {
 public:
  Renderer(uint32_t width, uint32_t height);

  uint32_t Width() const noexcept { return next_.Width(); }
  uint32_t Height() const noexcept { return next_.Height(); }

  // The buffer the caller draws into. Each frame starts with Clear()
  // and ends with Flush().
  CellBuffer& Next() noexcept { return next_; }
  const CellBuffer& Next() const noexcept { return next_; }
  const CellBuffer& Prev() const noexcept { return prev_; }

  // Resize both buffers and force a full redraw on next Flush.
  void Resize(uint32_t width, uint32_t height);

  // Walk every cell, emit ANSI for cells where next != prev, swap
  // buffers. Returns bytes written. Buffer overflow is signaled by
  // returning kFlushOverflow — caller should grow `dst` and retry on
  // the same (unswapped) state. For a typical terminal the worst-case
  // upper bound is width*height * (kMaxCursorPositionLen + 2 *
  // kMaxRgbSgrLen + kMaxAttrRunLen + 4 bytes UTF-8) which is bounded.
  static constexpr size_t kFlushOverflow = static_cast<size_t>(-1);
  size_t Flush(char* dst, size_t dst_capacity);

  // Force a full redraw on next Flush. Used when the terminal state is
  // potentially unknown (after Resize, after switching alt-screen,
  // after a signal-reentry).
  void Invalidate() noexcept { needs_full_redraw_ = true; }

 private:
  CellBuffer next_;
  CellBuffer prev_;
  bool needs_full_redraw_ = true;
};

}  // namespace tui

#endif  // TUI_INFRA_RENDERER_HPP_
