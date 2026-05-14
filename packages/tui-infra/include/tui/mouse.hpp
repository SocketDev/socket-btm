// MouseParser — ANSI mouse sequence decoder.
//
// Decodes SGR (ESC [ < b ; x ; y M|m) and X10 (ESC [ M <byte> <x> <y>)
// mouse protocols into structured events. 1:1 port from socket-stuie's
// react package mouse-parser.ts (which is itself a near-verbatim
// vendor from @opentui/core).
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
