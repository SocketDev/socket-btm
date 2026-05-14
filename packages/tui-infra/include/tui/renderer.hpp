// Renderer — double-buffered cell-grid diff + ANSI emit.
//
// Tier 2 surface. Mirrors the core of socket-stuie's OpenTUI fork render
// loop (renderer.zig CliRenderer): hold a `next` buffer the caller draws
// into and a `prev` buffer of what the terminal currently shows, then on
// Flush() walk both buffers cell-by-cell, emit ANSI only for the cells
// that changed, and swap prev↔next.
//
// The flush loop is the actual perf-critical path of a TUI app. Tier 1's
// hot-path writers (WriteCursorPosition / WriteFg/BgRgb / WriteAttributes
// in ansi.hpp) are the targets the diff emit calls; no allocations on
// the per-cell path.

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
