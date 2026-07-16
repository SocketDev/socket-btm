// Test for tui::MouseParser.
//
// Exercises both SGR (ESC[<b;x;y M|m) and X10 (ESC[M<3-byte>) wire
// formats. Includes the LooksLikeMouseSequence fast-path predicate,
// the per-event callback API, and edge cases (drag state, scroll
// directions, ctrl/alt/shift modifiers).

#include "tui/mouse.hpp"

#include <cassert>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

namespace {

int failures = 0;

void Expect(bool ok, const char* label) {
  if (!ok) {
    std::fprintf(stderr, "FAIL %s\n", label);
    ++failures;
  }
}

const uint8_t* Bytes(const char* s) {
  return reinterpret_cast<const uint8_t*>(s);
}

}  // namespace

int main() {
  using namespace tui;

  // LooksLikeMouseSequence fast-path predicate.
  {
    Expect(LooksLikeMouseSequence(Bytes("\x1b[<0;5;5M"), 9),
           "looks-like SGR");
    Expect(LooksLikeMouseSequence(Bytes("\x1b[M\x20\x21\x21"), 6),
           "looks-like X10");
    Expect(!LooksLikeMouseSequence(Bytes("\x1b[A"), 3),
           "ESC[A (arrow up) not a mouse seq");
    Expect(!LooksLikeMouseSequence(Bytes("abc"), 3),
           "plain text not a mouse seq");
    Expect(!LooksLikeMouseSequence(Bytes(""), 0),
           "empty input not a mouse seq");
    Expect(!LooksLikeMouseSequence(Bytes("\x1b"), 1),
           "short input not a mouse seq");
  }

  // SGR button-down at column 5, row 10 (1-indexed wire, 0-indexed output).
  {
    MouseParser p;
    size_t consumed = 0;
    const char* input = "\x1b[<0;5;10M";
    bool ok = p.ParseOne(Bytes(input), std::strlen(input), &consumed);
    Expect(ok, "SGR down parses");
    Expect(consumed == 10, "SGR down consumed 10 bytes");
    const auto& e = p.Event();
    Expect(e.type == MouseEventType::kDown, "SGR down type=kDown");
    Expect(e.button == 0, "SGR button=0 (left)");
    Expect(e.x == 4, "SGR x=4 (col 5 -> 0-indexed)");
    Expect(e.y == 9, "SGR y=9 (row 10 -> 0-indexed)");
  }

  // SGR button-up uses `m` terminator.
  {
    MouseParser p;
    size_t consumed = 0;
    const char* input = "\x1b[<0;5;10m";
    bool ok = p.ParseOne(Bytes(input), std::strlen(input), &consumed);
    Expect(ok, "SGR up parses");
    Expect(p.Event().type == MouseEventType::kUp, "SGR up type=kUp");
  }

  // SGR with modifier bits: shift=4, alt=8, ctrl=16 OR'd into button.
  {
    MouseParser p;
    size_t consumed = 0;
    // button=0 + shift(4) + alt(8) + ctrl(16) = 28
    const char* input = "\x1b[<28;1;1M";
    bool ok = p.ParseOne(Bytes(input), std::strlen(input), &consumed);
    Expect(ok, "SGR with modifiers parses");
    const auto& e = p.Event();
    Expect(e.modifiers.shift, "SGR shift=true");
    Expect(e.modifiers.alt, "SGR alt=true");
    Expect(e.modifiers.ctrl, "SGR ctrl=true");
  }

  // SGR scroll: bit 64 set. button=0 → up, 1 → down.
  {
    MouseParser p;
    size_t consumed = 0;
    // 64 = scroll bit, +0 = up
    bool ok = p.ParseOne(Bytes("\x1b[<64;10;20M"), 13, &consumed);
    Expect(ok, "SGR scroll-up parses");
    const auto& e = p.Event();
    Expect(e.type == MouseEventType::kScroll, "scroll type=kScroll");
    Expect(e.scroll != nullptr, "scroll info populated");
    Expect(e.scroll && e.scroll->direction == ScrollDirection::kUp,
           "scroll direction=up");
    Expect(e.scroll && e.scroll->delta == 1, "scroll delta=1");

    // 65 = scroll + 1 = down
    ok = p.ParseOne(Bytes("\x1b[<65;10;20M"), 13, &consumed);
    Expect(ok && p.Event().scroll &&
               p.Event().scroll->direction == ScrollDirection::kDown,
           "SGR scroll-down");
  }

  // SGR motion bit (32): drag when buttons held, else move.
  {
    MouseParser p;
    size_t consumed = 0;
    // First: press left button.
    p.ParseOne(Bytes("\x1b[<0;5;5M"), 9, &consumed);
    Expect(p.Event().type == MouseEventType::kDown, "drag setup: down");

    // Motion + button held → drag.
    p.ParseOne(Bytes("\x1b[<32;6;6M"), 10, &consumed);
    Expect(p.Event().type == MouseEventType::kDrag,
           "motion + button held = drag");

    // Release.
    p.ParseOne(Bytes("\x1b[<0;6;6m"), 9, &consumed);
    Expect(p.Event().type == MouseEventType::kUp, "drag release: up");

    // Motion + no button → move.
    p.ParseOne(Bytes("\x1b[<35;7;7M"), 10, &consumed);
    Expect(p.Event().type == MouseEventType::kMove,
           "motion + no button = move");
  }

  // X10 fallback protocol.
  {
    MouseParser p;
    size_t consumed = 0;
    // ESC[M button=' '(0+32)=' ', x='!'(0+33)=1-indexed -> 0, y='"'(1+33)=1-indexed -> 1.
    // Actually X10 stores byte = value+32 (button) and value+33 (coord).
    // To send "down on (0,0)": button byte = 32, x byte = 33, y byte = 33.
    const uint8_t buf[] = {0x1b, '[', 'M', 32, 33, 33};
    bool ok = p.ParseOne(buf, sizeof(buf), &consumed);
    Expect(ok, "X10 parses");
    Expect(consumed == 6, "X10 consumed 6 bytes");
    const auto& e = p.Event();
    Expect(e.type == MouseEventType::kDown, "X10 down type=kDown");
    Expect(e.x == 0, "X10 x=0");
    Expect(e.y == 0, "X10 y=0");
  }

  // ParseAll: multiple events in one buffer via callback.
  {
    MouseParser p;
    std::vector<MouseEventType> seen;
    // Two SGR events back-to-back.
    const char* input = "\x1b[<0;5;5M\x1b[<0;5;5m";
    size_t n = p.ParseAll(Bytes(input), std::strlen(input),
                          [&](const RawMouseEvent& e) {
                            seen.push_back(e.type);
                          });
    Expect(n == 2, "ParseAll returns 2");
    Expect(seen.size() == 2 && seen[0] == MouseEventType::kDown &&
               seen[1] == MouseEventType::kUp,
           "ParseAll emits down then up");
  }

  // Invalid sequence returns false.
  {
    MouseParser p;
    size_t consumed = 0;
    // ESC[X — not a mouse introducer.
    Expect(!p.ParseOne(Bytes("\x1b[X"), 3, &consumed),
           "unknown introducer rejected");
    // ESC[<;;M — missing digits.
    Expect(!p.ParseOne(Bytes("\x1b[<;;M"), 7, &consumed),
           "SGR missing digits rejected");
  }

  // Reset clears drag state.
  {
    MouseParser p;
    size_t consumed = 0;
    p.ParseOne(Bytes("\x1b[<0;5;5M"), 9, &consumed);
    Expect(p.Event().type == MouseEventType::kDown, "before reset: down");
    p.Reset();
    // After reset, a motion event should be Move (no buttons held).
    p.ParseOne(Bytes("\x1b[<32;6;6M"), 10, &consumed);
    Expect(p.Event().type == MouseEventType::kMove,
           "after reset, motion = move (no drag)");
  }

  if (failures == 0) {
    std::printf("ok %s\n", "tui-infra/mouse");
    return 0;
  }
  std::fprintf(stderr, "%d failure(s)\n", failures);
  return 1;
}
