// MouseParser implementation.
//
// 1:1 port from socket-stuie's mouse-parser.ts. SGR sequence: ESC[<
// followed by `b;x;y` digits and a terminator (`M`=press, `m`=release).
// X10 sequence: ESC[M followed by exactly three bytes
// (button+modifiers, x+33, y+33).

#include "tui/mouse.hpp"

#include <cstddef>
#include <cstdint>

namespace tui {

namespace {

ScrollDirection ScrollDirectionFor(int32_t button) {
  switch (button) {
    case 0: return ScrollDirection::kUp;
    case 1: return ScrollDirection::kDown;
    case 2: return ScrollDirection::kLeft;
    default: return ScrollDirection::kRight;
  }
}

}  // namespace

bool MouseParser::ParseOne(const uint8_t* data, size_t length,
                           size_t* out_consumed) {
  return ParseSequenceAt(data, length, 0, out_consumed);
}

size_t MouseParser::ParseAll(const uint8_t* data, size_t length,
                             const MouseEventSink& sink) {
  size_t offset = 0;
  size_t count = 0;
  while (offset < length) {
    size_t consumed = 0;
    if (!ParseSequenceAt(data, length, offset, &consumed)) {
      break;
    }
    sink(reused_event_);
    offset += consumed;
    count += 1;
  }
  return count;
}

bool MouseParser::ParseSequenceAt(const uint8_t* data, size_t length,
                                  size_t offset, size_t* out_consumed) {
  if (offset + 2 >= length) {
    return false;
  }
  if (data[offset] != 0x1b || data[offset + 1] != 0x5b) {
    return false;
  }
  const uint8_t introducer = data[offset + 2];
  if (introducer == '<') {
    return ParseSgrSequence(data, length, offset, out_consumed);
  }
  if (introducer == 'M') {
    return ParseBasicSequence(data, length, offset, out_consumed);
  }
  return false;
}

bool MouseParser::ParseSgrSequence(const uint8_t* data, size_t length,
                                   size_t offset, size_t* out_consumed) {
  size_t index = offset + 3;
  int32_t values[3] = {0, 0, 0};
  int part = 0;
  bool has_digit = false;

  while (index < length) {
    const uint8_t c = data[index];
    if (c >= '0' && c <= '9') {
      has_digit = true;
      values[part] = values[part] * 10 + (c - '0');
      index += 1;
      continue;
    }
    if (c == ';') {
      if (!has_digit || part >= 2) {
        return false;
      }
      part += 1;
      has_digit = false;
      index += 1;
      continue;
    }
    if (c == 'M' || c == 'm') {
      if (!has_digit || part != 2) {
        return false;
      }
      DecodeSgrEvent(values[0], values[1], values[2], c);
      *out_consumed = index - offset + 1;
      return true;
    }
    return false;
  }
  return false;
}

bool MouseParser::ParseBasicSequence(const uint8_t* data, size_t length,
                                     size_t offset, size_t* out_consumed) {
  // ESC [ M + 3 bytes.
  if (offset + 6 > length) {
    return false;
  }
  const int32_t button_byte = static_cast<int32_t>(data[offset + 3]) - 32;
  // X10 protocol stores coords as byte - 33 to give 1-based; we
  // immediately convert to 0-based.
  const int32_t x = static_cast<int32_t>(data[offset + 4]) - 33;
  const int32_t y = static_cast<int32_t>(data[offset + 5]) - 33;
  DecodeBasicEvent(button_byte, x, y);
  *out_consumed = 6;
  return true;
}

void MouseParser::DecodeSgrEvent(int32_t raw_button_code, int32_t wire_x,
                                 int32_t wire_y, uint8_t press_release) {
  const int32_t button = raw_button_code & 3;
  const bool is_scroll = (raw_button_code & 64) != 0;
  const bool is_motion = (raw_button_code & 32) != 0;

  reused_event_.modifiers.shift = (raw_button_code & 4) != 0;
  reused_event_.modifiers.alt = (raw_button_code & 8) != 0;
  reused_event_.modifiers.ctrl = (raw_button_code & 16) != 0;

  MouseEventType type;
  const ScrollInfo* scroll_info = nullptr;

  if (is_motion) {
    const bool is_dragging = !mouse_buttons_pressed_.empty();
    if (button == 3) {
      type = MouseEventType::kMove;
    } else if (is_dragging) {
      type = MouseEventType::kDrag;
    } else {
      type = MouseEventType::kMove;
    }
  } else if (is_scroll && press_release == 'M') {
    type = MouseEventType::kScroll;
    reused_scroll_.direction = ScrollDirectionFor(button);
    reused_scroll_.delta = 1;
    scroll_info = &reused_scroll_;
  } else {
    type = press_release == 'M' ? MouseEventType::kDown : MouseEventType::kUp;
    if (type == MouseEventType::kDown && button != 3) {
      mouse_buttons_pressed_.insert(button);
    } else if (type == MouseEventType::kUp) {
      mouse_buttons_pressed_.clear();
    }
  }

  reused_event_.type = type;
  reused_event_.button = button == 3 ? 0 : button;
  reused_event_.x = wire_x - 1;
  reused_event_.y = wire_y - 1;
  reused_event_.scroll = scroll_info;
}

void MouseParser::DecodeBasicEvent(int32_t button_byte, int32_t x,
                                   int32_t y) {
  const int32_t button = button_byte & 3;
  const bool is_scroll = (button_byte & 64) != 0;
  const bool is_motion = (button_byte & 32) != 0;

  reused_event_.modifiers.shift = (button_byte & 4) != 0;
  reused_event_.modifiers.alt = (button_byte & 8) != 0;
  reused_event_.modifiers.ctrl = (button_byte & 16) != 0;

  MouseEventType type;
  int32_t actual_button;
  const ScrollInfo* scroll_info = nullptr;

  if (is_motion) {
    type = MouseEventType::kMove;
    actual_button = button == 3 ? -1 : button;
  } else if (is_scroll) {
    type = MouseEventType::kScroll;
    actual_button = 0;
    reused_scroll_.direction = ScrollDirectionFor(button);
    reused_scroll_.delta = 1;
    scroll_info = &reused_scroll_;
  } else {
    type = button == 3 ? MouseEventType::kUp : MouseEventType::kDown;
    actual_button = button == 3 ? 0 : button;
  }

  reused_event_.type = type;
  reused_event_.button = actual_button;
  reused_event_.x = x;
  reused_event_.y = y;
  reused_event_.scroll = scroll_info;
}

}  // namespace tui
