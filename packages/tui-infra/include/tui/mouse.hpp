// MouseParser — ANSI mouse sequence decoder.
//
// 1:1 port of @opentui/core's mouse-parser.ts (TypeScript):
//   opentui/packages/core/src/parse/mouse-parser.ts
//     export class MouseParser {
//         private mouseButtonsPressed = new Set<number>()
//         private reusedEvent: RawMouseEvent = { ... }
//         parseOne(buf, offset) -> { consumed, event } | null
//         parseAll(buf, sink) -> count
//         reset(): void
//     }
//
// Decodes the two terminal mouse wire protocols:
//
//   SGR mode (xterm 277+, modern default — what every modern terminal
//   emulator sends by default once we send DECSET 1006):
//     ESC [ < b ; x ; y M     press / motion-with-button
//     ESC [ < b ; x ; y m     release
//     - `b` encodes button in low 2 bits (0=left, 1=middle, 2=right,
//       3=release), modifiers in bits 2-4 (shift / alt / ctrl), motion
//       flag in bit 5 (motion event vs button event), scroll button in
//       bit 6 (button 4/5 → scroll up/down with bit 6 set).
//     - x, y are 1-indexed character coords. No cap (24-bit decimal).
//     Spec: xterm Mouse Tracking + SGR Pixel Position
//
//   X10 mode (legacy, xterm pre-277 default — still seen on tmux):
//     ESC [ M <byte> <x> <y>     single press, no release info
//     - Each byte is +32 offset; coords capped at 223 (255 - 32).
//
// Wire-protocol reference:
//   https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking
//
// Drag state: SGR motion+button events translate to JS-level DRAG; the
// `mouse_buttons_pressed_` set tracks which buttons are currently held.
// On release, an event with `type=DRAG_END` is emitted followed by a
// `type=DROP` event (matches @opentui/core's event mapping in
// mouse-parser.ts).
//
// Hot path semantics: the parser owns its `RawMouseEvent` slot so
// every parsed event reuses the same memory. Consumers reading via
// the per-event callback API observe the event synchronously and must
// not retain a reference past their handler.

#ifndef TUI_INFRA_MOUSE_HPP_
#define TUI_INFRA_MOUSE_HPP_

#include <cstddef>
#include <cstdint>
#include <functional>
#include <unordered_set>

namespace tui {

enum class MouseEventType : uint8_t {
  kDown,
  kUp,
  kMove,
  kDrag,
  kDragEnd,
  kDrop,
  kOver,
  kOut,
  kScroll,
};

enum class ScrollDirection : uint8_t {
  kUp,
  kDown,
  kLeft,
  kRight,
};

struct MouseModifiers {
  bool shift = false;
  bool alt = false;
  bool ctrl = false;
};

struct ScrollInfo {
  ScrollDirection direction = ScrollDirection::kUp;
  int32_t delta = 1;
};

struct RawMouseEvent {
  MouseEventType type = MouseEventType::kMove;
  int32_t button = 0;
  int32_t x = 0;
  int32_t y = 0;
  MouseModifiers modifiers;
  // Valid only when type == kScroll. Pointer rather than optional so
  // the reused-event hot path can clear it without churning storage.
  const ScrollInfo* scroll = nullptr;
};

// Fast-path inline predicate: returns true if `data` starts with ESC[<
// (SGR) or ESC[M (X10). Lets a caller route bytes to the mouse parser
// vs a key handler without speculatively running a full parse.
inline bool LooksLikeMouseSequence(const uint8_t* data, size_t length) {
  if (length < 3) {
    return false;
  }
  if (data[0] != 0x1b || data[1] != 0x5b) {
    return false;
  }
  return data[2] == 0x3c || data[2] == 0x4d;
}

using MouseEventSink = std::function<void(const RawMouseEvent&)>;

class MouseParser {
 public:
  MouseParser() = default;

  // Drop tracked button-press state. Call when input focus is lost or
  // when the terminal is reset so a half-finished drag doesn't bleed
  // into the next session.
  void Reset() noexcept { mouse_buttons_pressed_.clear(); }

  // Parse the first mouse sequence in `data`. Returns true if an event
  // was decoded; `out_consumed` receives the number of input bytes
  // consumed. The event lives in the parser's reused slot — access
  // .event() before the next Parse* call.
  bool ParseOne(const uint8_t* data, size_t length, size_t* out_consumed);

  // Parse every mouse sequence in `data`, calling `sink` once per
  // event. Returns the count of events emitted. The event passed to
  // sink is the parser's reused slot — consume synchronously.
  size_t ParseAll(const uint8_t* data, size_t length,
                  const MouseEventSink& sink);

  const RawMouseEvent& Event() const noexcept { return reused_event_; }

 private:
  std::unordered_set<int32_t> mouse_buttons_pressed_;
  RawMouseEvent reused_event_;
  ScrollInfo reused_scroll_;

  bool ParseSequenceAt(const uint8_t* data, size_t length, size_t offset,
                       size_t* out_consumed);
  bool ParseSgrSequence(const uint8_t* data, size_t length, size_t offset,
                        size_t* out_consumed);
  bool ParseBasicSequence(const uint8_t* data, size_t length, size_t offset,
                          size_t* out_consumed);
  void DecodeSgrEvent(int32_t raw_button_code, int32_t wire_x, int32_t wire_y,
                      uint8_t press_release);
  void DecodeBasicEvent(int32_t button_byte, int32_t x, int32_t y);
};

}  // namespace tui

#endif  // TUI_INFRA_MOUSE_HPP_
