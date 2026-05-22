// node:smol-tui V8 binding glue.
//
// Five surfaces exposed to JS, all routed through `internalBinding('smol_tui')`:
//
//   1. ANSI emit       — constants + cold-path `std::string` builders +
//                        hot-path Uint8Array writers (cursor, fg/bg RGB,
//                        SGR attributes). Mirrors OpenTUI's `ansi.zig`.
//   2. Mouse parser    — SGR + X10 ANSI decode, drag-state tracked. 1:1
//                        port of socket-stuie/@opentui mouse-parser.ts.
//   3. Renderer / cell — double-buffered cell-grid diff. Mirrors
//                        OpenTUI's `renderer.zig` CliRenderer (Next/Prev
//                        + diff + flush).
//   4. Yoga layout     — direct C-API binding (yoga 3.2.1 pin) for
//                        flexbox layout used by ink-style tui apps.
//   5. Enum mirrors    — integer-valued objects so JS callers don't
//                        hardcode the numeric values.
//
// Cross-cutting design choices:
//
//   * Handle registries. Stateful subsystems (mouse parser, renderer,
//     yoga node) live in process-wide `unordered_map<uint32_t, T>` maps
//     guarded by a mutex. JS holds opaque integer handles. Avoids the
//     V8 ObjectWrap dance (no internal-field accessors, no per-isolate
//     template installation) at the cost of one mutex acquire per call.
//     For TUI workloads (one terminal, one parser, one renderer) the
//     contention is zero.
//
//   * Pre-allocated Uint8Array IO. Hot-path writers and Renderer::Flush
//     receive a Uint8Array + capacity from JS, write straight into the
//     backing store via ArrayBuffer::GetBackingStore + ByteOffset
//     arithmetic. No per-call allocation on either side; the JS layer
//     reuses one buffer for the entire session.
//
//   * FastApi specialization. 32 hot-path entries are paired Slow +
//     Fast:
//     - ANSI writers (writeCursorPosition, writeFgRgb, writeBgRgb,
//       writeAttributes) — called per cell per frame (4).
//     - looksLikeMouseSequence — called once per terminal input chunk
//       (1).
//     - Renderer hot path (rendererResize, rendererInvalidate,
//       rendererClear, rendererSet, rendererFillRect,
//       rendererDrawText, rendererFlush) — called per
//       frame / per-cell / per-glyph in the render loop (7). The flush
//       in particular is the hottest call in the binding.
//     - Yoga structural + setters + dirty mark (yogaCreateNode,
//       yogaFreeNode, yogaInsertChild, yogaRemoveChild,
//       yogaCalculateLayout, yogaMarkDirty, 14 yogaSet*) — called per
//       element per layout pass (20).
//
//     The fast paths use ArrayBufferViewContents<uint8_t> for direct
//     byte access (no Isolate handle, no HandleScope) and forward into
//     the same C++ helpers the slow path uses. Slow path remains the
//     fallback for non-monomorphic call sites.
//
//     Cold-path entries kept on SetMethod: lifecycle Create/Destroy/
//     Reset (rare-call); ANSI cold builders that return std::string
//     (V8 Fast API can't return fresh string handles); parseMouseOne
//     and yogaGetComputedLayout (return JS objects; allocation makes
//     Fast API unsuitable); rendererSize (returns object).
//
// Upstream pins (with exact commits — link → file → line where useful):
//
//   * Yoga 3.2.1
//     https://github.com/facebook/yoga/tree/v3.2.1
//     Submodule at packages/yoga-layout-builder/upstream/yoga/
//     (SHA 042f5013152eb81c1552dec945b88f7b95ca350f).
//
//   * OpenTUI (Zig sources, vendored into socket-stuie's fork)
//     packages/core/upstream/opentui/packages/core/src/zig/
//       ansi.zig          — escape sequence emit (constants + writers)
//       renderer.zig      — CliRenderer (Next/Prev + flush diff)
//       buffer-methods.zig — Cell POD + grid helpers
//     The tui-infra C++ port (include/tui/*.hpp + src/tui/*.cc) is the
//     trimmed-down 1:1 in this tree.
//
//   * @opentui/core mouse parser (TypeScript)
//     packages/core/src/parse/mouse-parser.ts
//     The tui-infra MouseParser is a near-verbatim C++ port — SGR
//     (ESC[<b;x;yM|m) and X10 (ESC[M<byte><x><y>) protocols, drag-state
//     tracking, scroll mapping. See xterm(1) "Mouse Tracking" + xterm
//     ctlseqs: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
//
// JS↔C++ enum integer parity: numeric values come from the public Yoga
// headers via `static_cast<int32_t>(YG*Enum::Value)`. If Yoga adds a
// new entry to one of its enums in a future bump, the JS-side mirror
// stays in sync because both pull from the same source.

#include "tui/ansi.hpp"
#include "tui/cell.hpp"
#include "tui/mouse.hpp"
#include "tui/renderables.hpp"
#include "tui/renderer.hpp"
#include "tui/width.hpp"

#include "yoga/Yoga.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "node_debug.h"
#include "util-inl.h"
#include "v8.h"
#include "v8-fast-api-calls.h"

#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace node {
namespace socketsecurity {
namespace tui {

using node::ArrayBufferViewContents;
using v8::Boolean;
using v8::CFunction;
using v8::Context;
using v8::FastApiCallbackOptions;
using v8::FunctionCallbackInfo;
using v8::HandleScope;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
using v8::Null;
using v8::Number;
using v8::Object;
using v8::String;
using v8::Uint8Array;
using v8::Value;

namespace ti = ::tui;

// ─── Section 1: ANSI emit ─────────────────────────────────────────────
//
// Mirrors OpenTUI ansi.zig (socket-stuie/@opentui/core fork). The cold-
// path wrappers wrap `tui::CursorPosition` / `tui::SetFgRgb` /
// `tui::SetBgRgb` (which return std::string) and surface them as JS
// strings. Cold-path is for one-shot setup writes (banner, screen
// switch), not the per-cell flush loop.
//
// Upstream reference (Zig source, equivalent functions):
//   opentui/packages/core/src/zig/ansi.zig
//     fn cursorPosition (CUP — ESC[<row>;<col>H)
//     fn fgRgbTrue / fn bgRgbTrue (SGR truecolor — ESC[38;2;r;g;bm)
// VT/xterm spec: https://invisible-island.net/xterm/ctlseqs/ctlseqs.html
//                #h2-CSI-Pn-_-Pn-H (CUP)
//                #h2-Character-Attributes (SGR)

static Local<String> NewOneByteString(Isolate* isolate, const char* literal) {
  return String::NewFromOneByte(isolate,
                                reinterpret_cast<const uint8_t*>(literal),
                                NewStringType::kNormal,
                                static_cast<int>(std::strlen(literal)))
      .ToLocalChecked();
}

static void CursorPosition(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint16_t row = static_cast<uint16_t>(
      args[0]->Uint32Value(context).FromMaybe(0));
  uint16_t col = static_cast<uint16_t>(
      args[1]->Uint32Value(context).FromMaybe(0));
  std::string seq = ti::CursorPosition(row, col);
  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, seq.c_str(), NewStringType::kNormal,
                          static_cast<int>(seq.size()))
          .ToLocalChecked());
}

static void SetFgRgb(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint8_t r = static_cast<uint8_t>(args[0]->Uint32Value(context).FromMaybe(0));
  uint8_t g = static_cast<uint8_t>(args[1]->Uint32Value(context).FromMaybe(0));
  uint8_t b = static_cast<uint8_t>(args[2]->Uint32Value(context).FromMaybe(0));
  std::string seq = ti::SetFgRgb(r, g, b);
  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, seq.c_str(), NewStringType::kNormal,
                          static_cast<int>(seq.size()))
          .ToLocalChecked());
}

static void SetBgRgb(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint8_t r = static_cast<uint8_t>(args[0]->Uint32Value(context).FromMaybe(0));
  uint8_t g = static_cast<uint8_t>(args[1]->Uint32Value(context).FromMaybe(0));
  uint8_t b = static_cast<uint8_t>(args[2]->Uint32Value(context).FromMaybe(0));
  std::string seq = ti::SetBgRgb(r, g, b);
  args.GetReturnValue().Set(
      String::NewFromUtf8(isolate, seq.c_str(), NewStringType::kNormal,
                          static_cast<int>(seq.size()))
          .ToLocalChecked());
}

// ─── Section 2: ANSI hot-path writers ─────────────────────────────────
//
// Caller passes a Uint8Array and a byte offset; we write directly into
// the backing store. JS does no allocation per call. Returns the number
// of bytes written. Out-of-bounds offsets or overshort buffers return
// 0; the JS layer treats 0 as an overflow signal and grows.
//
// Mirrors the per-cell hot-path writers in OpenTUI:
//   opentui/packages/core/src/zig/ansi.zig
//     moveToOutput, fgColorOutput, bgColorOutput, applyAttributesOutputWriter
//
// kMaxCursorPositionLen / kMaxRgbSgrLen / kMaxAttrRunLen are defined in
// include/tui/ansi.hpp. Sizing the JS-side Uint8Array to those bounds
// means a single call can never overflow during normal use.

static char* Uint8ArrayDataAt(Local<Uint8Array> arr, uint32_t offset,
                              size_t required) {
  size_t length = arr->ByteLength();
  if (offset > length || length - offset < required) {
    return nullptr;
  }
  auto store = arr->Buffer()->GetBackingStore();
  return static_cast<char*>(store->Data()) + arr->ByteOffset() + offset;
}

static void WriteCursorPosition(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (!args[0]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  Local<Uint8Array> arr = args[0].As<Uint8Array>();
  uint32_t offset = args[1]->Uint32Value(context).FromMaybe(0);
  uint16_t row = static_cast<uint16_t>(
      args[2]->Uint32Value(context).FromMaybe(0));
  uint16_t col = static_cast<uint16_t>(
      args[3]->Uint32Value(context).FromMaybe(0));
  char* dst = Uint8ArrayDataAt(arr, offset, ti::kMaxCursorPositionLen);
  if (!dst) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  size_t n = ti::WriteCursorPosition(dst, row, col);
  args.GetReturnValue().Set(Integer::New(isolate, static_cast<int32_t>(n)));
}

// Fast path: V8 calls this when the receiver matches a known shape
// (Uint8Array + ints monomorphic). Inlines the ANSI emit straight
// into the JIT'd renderer flush loop — ~3-4 instructions per call
// after register allocation, vs the dozen+ for the trampoline path.
uint32_t FastWriteCursorPosition(Local<Value> receiver,
                                 Local<Value> buffer_val,
                                 uint32_t offset,
                                 uint32_t row,
                                 uint32_t col,
                                 // NOLINTNEXTLINE(runtime/references)
                                 FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.writeCursorPosition");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  // Overflow-safe bounds check (same shape as slow path's Uint8ArrayDataAt).
  if (offset > buf.length() ||
      buf.length() - offset < ti::kMaxCursorPositionLen) {
    return 0;
  }
  char* dst = reinterpret_cast<char*>(
      const_cast<uint8_t*>(buf.data())) + offset;
  return static_cast<uint32_t>(
      ti::WriteCursorPosition(dst, static_cast<uint16_t>(row),
                              static_cast<uint16_t>(col)));
}

static CFunction fast_write_cursor_position(
    CFunction::Make(FastWriteCursorPosition));

static void WriteFgRgb(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (!args[0]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  Local<Uint8Array> arr = args[0].As<Uint8Array>();
  uint32_t offset = args[1]->Uint32Value(context).FromMaybe(0);
  uint8_t r = static_cast<uint8_t>(args[2]->Uint32Value(context).FromMaybe(0));
  uint8_t g = static_cast<uint8_t>(args[3]->Uint32Value(context).FromMaybe(0));
  uint8_t b = static_cast<uint8_t>(args[4]->Uint32Value(context).FromMaybe(0));
  char* dst = Uint8ArrayDataAt(arr, offset, ti::kMaxRgbSgrLen);
  if (!dst) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  size_t n = ti::WriteFgRgb(dst, r, g, b);
  args.GetReturnValue().Set(Integer::New(isolate, static_cast<int32_t>(n)));
}

uint32_t FastWriteFgRgb(Local<Value> receiver,
                        Local<Value> buffer_val,
                        uint32_t offset,
                        uint32_t r,
                        uint32_t g,
                        uint32_t b,
                        // NOLINTNEXTLINE(runtime/references)
                        FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.writeFgRgb");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  if (offset > buf.length() ||
      buf.length() - offset < ti::kMaxRgbSgrLen) {
    return 0;
  }
  char* dst = reinterpret_cast<char*>(
      const_cast<uint8_t*>(buf.data())) + offset;
  return static_cast<uint32_t>(
      ti::WriteFgRgb(dst, static_cast<uint8_t>(r),
                     static_cast<uint8_t>(g), static_cast<uint8_t>(b)));
}

static CFunction fast_write_fg_rgb(CFunction::Make(FastWriteFgRgb));

static void WriteBgRgb(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (!args[0]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  Local<Uint8Array> arr = args[0].As<Uint8Array>();
  uint32_t offset = args[1]->Uint32Value(context).FromMaybe(0);
  uint8_t r = static_cast<uint8_t>(args[2]->Uint32Value(context).FromMaybe(0));
  uint8_t g = static_cast<uint8_t>(args[3]->Uint32Value(context).FromMaybe(0));
  uint8_t b = static_cast<uint8_t>(args[4]->Uint32Value(context).FromMaybe(0));
  char* dst = Uint8ArrayDataAt(arr, offset, ti::kMaxRgbSgrLen);
  if (!dst) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  size_t n = ti::WriteBgRgb(dst, r, g, b);
  args.GetReturnValue().Set(Integer::New(isolate, static_cast<int32_t>(n)));
}

uint32_t FastWriteBgRgb(Local<Value> receiver,
                        Local<Value> buffer_val,
                        uint32_t offset,
                        uint32_t r,
                        uint32_t g,
                        uint32_t b,
                        // NOLINTNEXTLINE(runtime/references)
                        FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.writeBgRgb");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  if (offset > buf.length() ||
      buf.length() - offset < ti::kMaxRgbSgrLen) {
    return 0;
  }
  char* dst = reinterpret_cast<char*>(
      const_cast<uint8_t*>(buf.data())) + offset;
  return static_cast<uint32_t>(
      ti::WriteBgRgb(dst, static_cast<uint8_t>(r),
                     static_cast<uint8_t>(g), static_cast<uint8_t>(b)));
}

static CFunction fast_write_bg_rgb(CFunction::Make(FastWriteBgRgb));

static void WriteAttributes(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (!args[0]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  Local<Uint8Array> arr = args[0].As<Uint8Array>();
  uint32_t offset = args[1]->Uint32Value(context).FromMaybe(0);
  uint8_t attrs = static_cast<uint8_t>(
      args[2]->Uint32Value(context).FromMaybe(0));
  char* dst = Uint8ArrayDataAt(arr, offset, ti::kMaxAttrRunLen);
  if (!dst) {
    args.GetReturnValue().Set(Integer::New(isolate, 0));
    return;
  }
  size_t n = ti::WriteAttributes(dst, attrs);
  args.GetReturnValue().Set(Integer::New(isolate, static_cast<int32_t>(n)));
}

uint32_t FastWriteAttributes(Local<Value> receiver,
                             Local<Value> buffer_val,
                             uint32_t offset,
                             uint32_t attrs,
                             // NOLINTNEXTLINE(runtime/references)
                             FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.writeAttributes");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  if (offset > buf.length() ||
      buf.length() - offset < ti::kMaxAttrRunLen) {
    return 0;
  }
  char* dst = reinterpret_cast<char*>(
      const_cast<uint8_t*>(buf.data())) + offset;
  return static_cast<uint32_t>(
      ti::WriteAttributes(dst, static_cast<uint8_t>(attrs)));
}

static CFunction fast_write_attributes(CFunction::Make(FastWriteAttributes));

// ─── Section 3: Mouse parser ──────────────────────────────────────────
//
// 1:1 surface for socket-stuie's @opentui mouse-parser.ts (TypeScript →
// C++ port lives in src/tui/mouse.cc). Decodes the two terminal mouse
// wire protocols:
//
//   SGR mode  (xterm 277+, the modern default):
//     ESC [ < b ; x ; y M     (press / drag)
//     ESC [ < b ; x ; y m     (release)
//     b encodes button (low 2 bits) + modifiers (bits 2-4 = shift/alt/
//     ctrl) + scroll/motion flags (bits 5-7).
//
//   X10 mode  (the legacy default):
//     ESC [ M <byte> <x> <y>   (single press, no release info)
//     Each of byte/x/y is a single byte with +32 offset; capped at
//     coordinate 223. Mostly historical — still seen on tmux-in-tmux.
//
// xterm Control Sequences reference:
//   https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#h2-Mouse-Tracking
//
// The drag-state set (`mouse_buttons_pressed_` in MouseParser) turns SGR
// press → motion → release wire events into DOWN → DRAG → DRAG_END +
// DROP events on the JS side.
//
// Mouse parser handle registry. JS asks for an opaque uint32 handle via
// createParser() and uses it on every parseOne()/reset()/destroyParser()
// call. The registry is shared across all isolates in this process —
// safe because each MouseParser is independent and lookups are guarded
// by a mutex on the single registry. Handles never recycle; if a JS
// caller leaks one, the worst outcome is a few KB per leaked parser.
struct ParserRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  std::unordered_map<uint32_t, std::unique_ptr<ti::MouseParser>> parsers;
};

static ParserRegistry& Registry() {
  static ParserRegistry r;
  return r;
}

static void CreateParser(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  ParserRegistry& r = Registry();
  std::lock_guard<std::mutex> lock(r.mu);
  uint32_t id = r.next_id++;
  r.parsers.emplace(id, std::make_unique<ti::MouseParser>());
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

static void DestroyParser(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  ParserRegistry& r = Registry();
  std::lock_guard<std::mutex> lock(r.mu);
  r.parsers.erase(id);
}

static void ResetParser(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  ParserRegistry& r = Registry();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.parsers.find(id);
  if (it != r.parsers.end()) {
    it->second->Reset();
  }
}

static Local<Object> EventToObject(Isolate* isolate, Local<Context> context,
                                   const ti::RawMouseEvent& event) {
  Local<Object> obj = Object::New(isolate);
  obj->Set(context, NewOneByteString(isolate, "type"),
           Integer::New(isolate, static_cast<int32_t>(event.type)))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "button"),
           Integer::New(isolate, event.button))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "x"),
           Integer::New(isolate, event.x))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "y"),
           Integer::New(isolate, event.y))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "shift"),
           Boolean::New(isolate, event.modifiers.shift))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "alt"),
           Boolean::New(isolate, event.modifiers.alt))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "ctrl"),
           Boolean::New(isolate, event.modifiers.ctrl))
      .Check();
  if (event.scroll != nullptr) {
    obj->Set(context, NewOneByteString(isolate, "scrollDirection"),
             Integer::New(isolate,
                          static_cast<int32_t>(event.scroll->direction)))
        .Check();
    obj->Set(context, NewOneByteString(isolate, "scrollDelta"),
             Integer::New(isolate, event.scroll->delta))
        .Check();
  }
  return obj;
}

static void ParseMouseOne(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  if (!args[1]->IsUint8Array()) {
    args.GetReturnValue().Set(Null(isolate));
    return;
  }
  Local<Uint8Array> arr = args[1].As<Uint8Array>();
  uint32_t offset = args[2]->Uint32Value(context).FromMaybe(0);
  size_t length = arr->ByteLength();
  if (offset >= length) {
    args.GetReturnValue().Set(Null(isolate));
    return;
  }
  auto store = arr->Buffer()->GetBackingStore();
  const uint8_t* data =
      static_cast<const uint8_t*>(store->Data()) + arr->ByteOffset() + offset;
  size_t available = length - offset;

  ParserRegistry& r = Registry();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.parsers.find(id);
  if (it == r.parsers.end()) {
    args.GetReturnValue().Set(Null(isolate));
    return;
  }
  size_t consumed = 0;
  bool ok = it->second->ParseOne(data, available, &consumed);
  Local<Object> result = Object::New(isolate);
  result
      ->Set(context, NewOneByteString(isolate, "consumed"),
            Integer::NewFromUnsigned(
                isolate, static_cast<uint32_t>(consumed)))
      .Check();
  Local<Value> event_value =
      ok ? EventToObject(isolate, context, it->second->Event()).As<Value>()
         : Null(isolate).As<Value>();
  result->Set(context, NewOneByteString(isolate, "event"), event_value)
      .Check();
  args.GetReturnValue().Set(result);
}

static void LooksLikeMouseSequence(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (!args[0]->IsUint8Array()) {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
    return;
  }
  Local<Uint8Array> arr = args[0].As<Uint8Array>();
  uint32_t offset = args[1]->Uint32Value(context).FromMaybe(0);
  size_t length = arr->ByteLength();
  if (offset >= length) {
    args.GetReturnValue().Set(Boolean::New(isolate, false));
    return;
  }
  auto store = arr->Buffer()->GetBackingStore();
  const uint8_t* data =
      static_cast<const uint8_t*>(store->Data()) + arr->ByteOffset() + offset;
  bool match = ti::LooksLikeMouseSequence(data, length - offset);
  args.GetReturnValue().Set(Boolean::New(isolate, match));
}

bool FastLooksLikeMouseSequence(Local<Value> receiver,
                                Local<Value> buffer_val,
                                uint32_t offset,
                                // NOLINTNEXTLINE(runtime/references)
                                FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.looksLikeMouseSequence");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  if (offset >= buf.length()) {
    return false;
  }
  return ti::LooksLikeMouseSequence(buf.data() + offset,
                                    buf.length() - offset);
}

static CFunction fast_looks_like_mouse_sequence(
    CFunction::Make(FastLooksLikeMouseSequence));

// ─── Section 4: Renderer / Cell buffer ────────────────────────────────
//
// Double-buffered cell-grid diff renderer. Mirrors OpenTUI's CliRenderer:
//
//   opentui/packages/core/src/zig/renderer.zig
//     pub const CliRenderer = struct {
//         next: OptimizedBuffer,   // caller draws into this
//         prev: OptimizedBuffer,   // last-flushed state, for diff
//         ...
//         pub fn render(...) void  // walk both, emit ANSI for changes
//     };
//
// Each frame: JS clears the next buffer, draws via the rendererSet /
// rendererDrawText / rendererFillRect calls (cell-level writes into the
// next buffer), then calls rendererFlush(handle, dstBuf, dstCap). Flush
// walks every cell, emits ANSI for cells where next != prev via the
// per-cell hot-path writers from Section 2, swaps prev↔next, and
// returns the byte count written.
//
// Cell layout matches OpenTUI's `Cell` (codepoint + fg_rgb + bg_rgb +
// attrs bitfield) — see include/tui/cell.hpp. 12 bytes per cell; a
// 200×60 grid is 144 KB which fits in L1.
//
// Renderer handle registry — same pattern as ParserRegistry. Each handle
// owns a Renderer (double-buffered cell grid + dirty flag). JS calls
// drawing methods by handle; the methods are stateless from V8's POV.
struct RendererRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  std::unordered_map<uint32_t, std::unique_ptr<ti::Renderer>> renderers;
};

static RendererRegistry& Renderers() {
  static RendererRegistry r;
  return r;
}

static void CreateRenderer(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t width = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t height = args[1]->Uint32Value(context).FromMaybe(0);
  RendererRegistry& r = Renderers();
  std::lock_guard<std::mutex> lock(r.mu);
  uint32_t id = r.next_id++;
  r.renderers.emplace(id, std::make_unique<ti::Renderer>(width, height));
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

static void DestroyRenderer(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  RendererRegistry& r = Renderers();
  std::lock_guard<std::mutex> lock(r.mu);
  r.renderers.erase(id);
}

static ti::Renderer* LookupRenderer(uint32_t id) {
  RendererRegistry& r = Renderers();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.renderers.find(id);
  return it == r.renderers.end() ? nullptr : it->second.get();
}

static void RendererResize(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t width = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t height = args[2]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer != nullptr) {
    renderer->Resize(width, height);
  }
}

void FastRendererResize(Local<Value> receiver, uint32_t id, uint32_t width,
                        uint32_t height,
                        // NOLINTNEXTLINE(runtime/references)
                        FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererResize");
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer != nullptr) {
    renderer->Resize(width, height);
  }
}

static CFunction fast_renderer_resize(CFunction::Make(FastRendererResize));

static void RendererInvalidate(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer != nullptr) {
    renderer->Invalidate();
  }
}

void FastRendererInvalidate(Local<Value> receiver, uint32_t id,
                            // NOLINTNEXTLINE(runtime/references)
                            FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererInvalidate");
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer != nullptr) {
    renderer->Invalidate();
  }
}

static CFunction fast_renderer_invalidate(
    CFunction::Make(FastRendererInvalidate));

// Helper: build a ti::Cell from args[start..start+7]
//   codepoint, fgR, fgG, fgB, bgR, bgG, bgB, attrs
static ti::Cell CellFromArgs(Local<Context> context,
                             const FunctionCallbackInfo<Value>& args,
                             int start) {
  ti::Cell c;
  c.codepoint = args[start]->Uint32Value(context).FromMaybe(U' ');
  c.fg_r = static_cast<uint8_t>(
      args[start + 1]->Uint32Value(context).FromMaybe(0));
  c.fg_g = static_cast<uint8_t>(
      args[start + 2]->Uint32Value(context).FromMaybe(0));
  c.fg_b = static_cast<uint8_t>(
      args[start + 3]->Uint32Value(context).FromMaybe(0));
  c.bg_r = static_cast<uint8_t>(
      args[start + 4]->Uint32Value(context).FromMaybe(0));
  c.bg_g = static_cast<uint8_t>(
      args[start + 5]->Uint32Value(context).FromMaybe(0));
  c.bg_b = static_cast<uint8_t>(
      args[start + 6]->Uint32Value(context).FromMaybe(0));
  c.attrs = static_cast<uint8_t>(
      args[start + 7]->Uint32Value(context).FromMaybe(0));
  return c;
}

// rendererClear(handle, codepoint, fgR, fgG, fgB, bgR, bgG, bgB, attrs)
static void RendererClear(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  renderer->Next().Clear(CellFromArgs(context, args, 1));
}

void FastRendererClear(Local<Value> receiver, uint32_t id, uint32_t codepoint,
                       uint32_t fg_r, uint32_t fg_g, uint32_t fg_b,
                       uint32_t bg_r, uint32_t bg_g, uint32_t bg_b,
                       uint32_t attrs,
                       // NOLINTNEXTLINE(runtime/references)
                       FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererClear");
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  ti::Cell cell{
      codepoint,
      static_cast<uint8_t>(fg_r), static_cast<uint8_t>(fg_g),
      static_cast<uint8_t>(fg_b), static_cast<uint8_t>(bg_r),
      static_cast<uint8_t>(bg_g), static_cast<uint8_t>(bg_b),
      static_cast<uint8_t>(attrs)};
  renderer->Next().Clear(cell);
}

static CFunction fast_renderer_clear(CFunction::Make(FastRendererClear));

// rendererSet(handle, x, y, codepoint, fgR, fgG, fgB, bgR, bgG, bgB, attrs)
static void RendererSet(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t x = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t y = args[2]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  renderer->Next().Set(x, y, CellFromArgs(context, args, 3));
}

void FastRendererSet(Local<Value> receiver, uint32_t id, uint32_t x,
                     uint32_t y, uint32_t codepoint, uint32_t fg_r,
                     uint32_t fg_g, uint32_t fg_b, uint32_t bg_r,
                     uint32_t bg_g, uint32_t bg_b, uint32_t attrs,
                     // NOLINTNEXTLINE(runtime/references)
                     FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererSet");
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  ti::Cell cell{
      codepoint,
      static_cast<uint8_t>(fg_r), static_cast<uint8_t>(fg_g),
      static_cast<uint8_t>(fg_b), static_cast<uint8_t>(bg_r),
      static_cast<uint8_t>(bg_g), static_cast<uint8_t>(bg_b),
      static_cast<uint8_t>(attrs)};
  renderer->Next().Set(x, y, cell);
}

static CFunction fast_renderer_set(CFunction::Make(FastRendererSet));

// rendererFillRect(handle, x, y, w, h, codepoint, fgR, fgG, fgB, bgR, bgG,
//                  bgB, attrs)
static void RendererFillRect(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t x = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t y = args[2]->Uint32Value(context).FromMaybe(0);
  uint32_t w = args[3]->Uint32Value(context).FromMaybe(0);
  uint32_t h = args[4]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  renderer->Next().FillRect(x, y, w, h, CellFromArgs(context, args, 5));
}

void FastRendererFillRect(Local<Value> receiver, uint32_t id, uint32_t x,
                          uint32_t y, uint32_t w, uint32_t h,
                          uint32_t codepoint, uint32_t fg_r, uint32_t fg_g,
                          uint32_t fg_b, uint32_t bg_r, uint32_t bg_g,
                          uint32_t bg_b, uint32_t attrs,
                          // NOLINTNEXTLINE(runtime/references)
                          FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererFillRect");
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  ti::Cell cell{
      codepoint,
      static_cast<uint8_t>(fg_r), static_cast<uint8_t>(fg_g),
      static_cast<uint8_t>(fg_b), static_cast<uint8_t>(bg_r),
      static_cast<uint8_t>(bg_g), static_cast<uint8_t>(bg_b),
      static_cast<uint8_t>(attrs)};
  renderer->Next().FillRect(x, y, w, h, cell);
}

static CFunction fast_renderer_fill_rect(
    CFunction::Make(FastRendererFillRect));

// rendererDrawText(handle, x, y, utf8Bytes, fgR, fgG, fgB, bgR, bgG, bgB,
//                  attrs)
static void RendererDrawText(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t x = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t y = args[2]->Uint32Value(context).FromMaybe(0);
  if (!args[3]->IsUint8Array()) {
    return;
  }
  Local<Uint8Array> arr = args[3].As<Uint8Array>();
  uint8_t fg_r = static_cast<uint8_t>(args[4]->Uint32Value(context).FromMaybe(0));
  uint8_t fg_g = static_cast<uint8_t>(args[5]->Uint32Value(context).FromMaybe(0));
  uint8_t fg_b = static_cast<uint8_t>(args[6]->Uint32Value(context).FromMaybe(0));
  uint8_t bg_r = static_cast<uint8_t>(args[7]->Uint32Value(context).FromMaybe(0));
  uint8_t bg_g = static_cast<uint8_t>(args[8]->Uint32Value(context).FromMaybe(0));
  uint8_t bg_b = static_cast<uint8_t>(args[9]->Uint32Value(context).FromMaybe(0));
  uint8_t attrs = static_cast<uint8_t>(
      args[10]->Uint32Value(context).FromMaybe(0));
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  auto store = arr->Buffer()->GetBackingStore();
  const char* utf8 =
      static_cast<const char*>(store->Data()) + arr->ByteOffset();
  renderer->Next().DrawText(x, y, utf8, arr->ByteLength(), fg_r, fg_g, fg_b,
                            bg_r, bg_g, bg_b, attrs);
}

void FastRendererDrawText(Local<Value> receiver, uint32_t id, uint32_t x,
                          uint32_t y, Local<Value> buffer_val, uint32_t fg_r,
                          uint32_t fg_g, uint32_t fg_b, uint32_t bg_r,
                          uint32_t bg_g, uint32_t bg_b, uint32_t attrs,
                          // NOLINTNEXTLINE(runtime/references)
                          FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererDrawText");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  const char* utf8 = reinterpret_cast<const char*>(buf.data());
  renderer->Next().DrawText(x, y, utf8, buf.length(),
                            static_cast<uint8_t>(fg_r),
                            static_cast<uint8_t>(fg_g),
                            static_cast<uint8_t>(fg_b),
                            static_cast<uint8_t>(bg_r),
                            static_cast<uint8_t>(bg_g),
                            static_cast<uint8_t>(bg_b),
                            static_cast<uint8_t>(attrs));
}

static CFunction fast_renderer_draw_text(
    CFunction::Make(FastRendererDrawText));

// rendererFlush(handle, dstBuf, dstCapacity) -> bytesWritten (or
// kFlushOverflow if dst was too small).
static void RendererFlush(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  if (!args[1]->IsUint8Array()) {
    args.GetReturnValue().Set(Number::New(isolate, 0));
    return;
  }
  Local<Uint8Array> arr = args[1].As<Uint8Array>();
  uint32_t capacity = args[2]->Uint32Value(context).FromMaybe(0);
  if (capacity > arr->ByteLength()) {
    capacity = static_cast<uint32_t>(arr->ByteLength());
  }
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    args.GetReturnValue().Set(Number::New(isolate, 0));
    return;
  }
  auto store = arr->Buffer()->GetBackingStore();
  char* dst = static_cast<char*>(store->Data()) + arr->ByteOffset();
  size_t written = renderer->Flush(dst, capacity);
  // Use Number for the return so the kFlushOverflow sentinel (size_t -1)
  // survives intact — JS observes it as 2^53-1ish; the JS layer checks
  // against the same sentinel exposed in `sizes.flushOverflow`.
  args.GetReturnValue().Set(
      Number::New(isolate, static_cast<double>(written)));
}

// Fast path for the per-frame flush — the hottest call in the binding,
// running once per rendered frame. Returns a double so the
// kFlushOverflow sentinel (size_t -1 cast to double) survives intact.
double FastRendererFlush(Local<Value> receiver, uint32_t id,
                         Local<Value> buffer_val, uint32_t capacity,
                         // NOLINTNEXTLINE(runtime/references)
                         FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.rendererFlush");
  HandleScope scope(opts.isolate);
  ArrayBufferViewContents<uint8_t> buf(buffer_val);
  if (capacity > buf.length()) {
    capacity = static_cast<uint32_t>(buf.length());
  }
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return 0.0;
  }
  char* dst = reinterpret_cast<char*>(const_cast<uint8_t*>(buf.data()));
  size_t written = renderer->Flush(dst, capacity);
  return static_cast<double>(written);
}

static CFunction fast_renderer_flush(CFunction::Make(FastRendererFlush));

static void RendererSize(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  Local<Object> obj = Object::New(isolate);
  uint32_t width = renderer == nullptr ? 0 : renderer->Width();
  uint32_t height = renderer == nullptr ? 0 : renderer->Height();
  obj->Set(context, NewOneByteString(isolate, "width"),
           Integer::NewFromUnsigned(isolate, width))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "height"),
           Integer::NewFromUnsigned(isolate, height))
      .Check();
  args.GetReturnValue().Set(obj);
}

// ─── Section 4b: Renderables (box + wrapped text) ─────────────────────
//
// Higher-level draw primitives layered over CellBuffer. The React/Solid
// host-config callbacks dispatch on element tag → one of these helpers.
// Keeps the per-element commit overhead constant (no JS-side cell
// iteration). Source: opentui v0.2.15 packages/core/src/lib/border.ts +
// packages/core/src/renderables/{Box,Text}.ts.

// drawBox(rendererId, x, y, w, h, style, sidesBits, borderFgR, borderFgG,
//         borderFgB, bgR, bgG, bgB, attrs, fillBackground)
//
// sidesBits: bit 0 = top, bit 1 = right, bit 2 = bottom, bit 3 = left.
// style: 0=single 1=double 2=rounded 3=heavy (matches tui::BorderStyle).
static void RendererDrawBox(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t x = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t y = args[2]->Uint32Value(context).FromMaybe(0);
  uint32_t w = args[3]->Uint32Value(context).FromMaybe(0);
  uint32_t h = args[4]->Uint32Value(context).FromMaybe(0);
  uint32_t style_idx = args[5]->Uint32Value(context).FromMaybe(0);
  uint32_t sides_bits = args[6]->Uint32Value(context).FromMaybe(0xf);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    return;
  }
  ti::BoxStyle style{};
  // Clamp style to known values; >= 4 falls back to kSingle.
  style.style = style_idx <= 3
                    ? static_cast<ti::BorderStyle>(style_idx)
                    : ti::BorderStyle::kSingle;
  style.sides.top = (sides_bits & 0x1) != 0;
  style.sides.right = (sides_bits & 0x2) != 0;
  style.sides.bottom = (sides_bits & 0x4) != 0;
  style.sides.left = (sides_bits & 0x8) != 0;
  style.border_fg_r = static_cast<uint8_t>(
      args[7]->Uint32Value(context).FromMaybe(255));
  style.border_fg_g = static_cast<uint8_t>(
      args[8]->Uint32Value(context).FromMaybe(255));
  style.border_fg_b = static_cast<uint8_t>(
      args[9]->Uint32Value(context).FromMaybe(255));
  style.bg_r = static_cast<uint8_t>(
      args[10]->Uint32Value(context).FromMaybe(0));
  style.bg_g = static_cast<uint8_t>(
      args[11]->Uint32Value(context).FromMaybe(0));
  style.bg_b = static_cast<uint8_t>(
      args[12]->Uint32Value(context).FromMaybe(0));
  style.attrs = static_cast<uint8_t>(
      args[13]->Uint32Value(context).FromMaybe(0));
  style.fill_background = args[14]->BooleanValue(isolate);
  ti::DrawBox(renderer->Next(), x, y, w, h, style);
}

// drawTextWrapped(rendererId, x, y, maxWidth, maxLines, utf8Bytes,
//                 fgR, fgG, fgB, bgR, bgG, bgB, attrs) -> linesEmitted
//
// maxWidth=0 means "wrap to buffer right edge". maxLines=0 means "no
// limit".
static void RendererDrawTextWrapped(
    const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t x = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t y = args[2]->Uint32Value(context).FromMaybe(0);
  uint32_t max_width = args[3]->Uint32Value(context).FromMaybe(0);
  uint32_t max_lines = args[4]->Uint32Value(context).FromMaybe(0);
  if (!args[5]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<Uint8Array> arr = args[5].As<Uint8Array>();
  uint8_t fg_r = static_cast<uint8_t>(
      args[6]->Uint32Value(context).FromMaybe(255));
  uint8_t fg_g = static_cast<uint8_t>(
      args[7]->Uint32Value(context).FromMaybe(255));
  uint8_t fg_b = static_cast<uint8_t>(
      args[8]->Uint32Value(context).FromMaybe(255));
  uint8_t bg_r = static_cast<uint8_t>(
      args[9]->Uint32Value(context).FromMaybe(0));
  uint8_t bg_g = static_cast<uint8_t>(
      args[10]->Uint32Value(context).FromMaybe(0));
  uint8_t bg_b = static_cast<uint8_t>(
      args[11]->Uint32Value(context).FromMaybe(0));
  uint8_t attrs = static_cast<uint8_t>(
      args[12]->Uint32Value(context).FromMaybe(0));
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer == nullptr) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  auto store = arr->Buffer()->GetBackingStore();
  const char* utf8 =
      static_cast<const char*>(store->Data()) + arr->ByteOffset();
  uint32_t lines = ti::DrawTextWrapped(
      renderer->Next(), x, y, max_width, max_lines, utf8, arr->ByteLength(),
      fg_r, fg_g, fg_b, bg_r, bg_g, bg_b, attrs);
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, lines));
}

// ─── Section 4c: String width (Unicode 17.0 East Asian + emoji) ───────
//
// Terminal-cell width of a UTF-8 string. ASCII-only inputs run at
// memory bandwidth (tight inner loop, no per-byte branch into the
// range tables); non-ASCII inputs do one binary-search per codepoint
// against the Unicode 16.0.0 wide-range and zero-width-range tables
// generated into width_data.cc.
//
// Surface: node:smol-tui.stringWidth(s) → integer cell count.

static void StringWidthBinding(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<String> input = args[0].As<String>();
  const int input_len = input->Utf8Length(isolate);
  if (input_len == 0) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  std::string buf(static_cast<size_t>(input_len), '\0');
  input->WriteUtf8(isolate, buf.data(), input_len, nullptr,
                   String::NO_NULL_TERMINATION);
  uint32_t width = ti::StringWidth(buf.data(), buf.size());
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, width));
}

// stringWidthFromBytes(Uint8Array) — same shape but skips the JS
// String -> UTF-8 round-trip when the caller already holds a Uint8Array
// (the renderer hot path does — every character it draws comes from a
// pre-encoded Uint8Array via TextEncoder).
static void StringWidthFromBytes(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1 || !args[0]->IsUint8Array()) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 0));
    return;
  }
  Local<v8::Uint8Array> arr = args[0].As<v8::Uint8Array>();
  auto store = arr->Buffer()->GetBackingStore();
  const char* utf8 =
      static_cast<const char*>(store->Data()) + arr->ByteOffset();
  uint32_t width = ti::StringWidth(utf8, arr->ByteLength());
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, width));
}

// codepointWidth(cp) — single-codepoint convenience. Skips the UTF-8
// decode for callers that already have an integer codepoint.
static void CodepointWidthBinding(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  if (args.Length() < 1) {
    args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, 1));
    return;
  }
  uint32_t cp = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t width = ti::CodepointWidth(cp);
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, width));
}

// ─── Section 5: Yoga layout (flexbox) ─────────────────────────────────
//
// Direct C-API binding for Yoga 3.2.1 — a flexbox-spec layout engine
// originally extracted from React Native. Used here so ink-style TUI
// apps can express layout via flex semantics without re-implementing
// CSS-flex math.
//
// Upstream:
//   https://github.com/facebook/yoga/tree/v3.2.1
//   submodule: packages/yoga-layout-builder/upstream/yoga/
//   SHA: 042f5013152eb81c1552dec945b88f7b95ca350f
//
// Public C API surface (used here):
//   yoga/YGNode.h         — YGNodeNewWithConfig, YGNodeFree, YGNodeInsertChild,
//                           YGNodeRemoveChild, YGNodeMarkDirty,
//                           YGNodeCalculateLayout
//   yoga/YGNodeStyle.h    — YGNodeStyleSet{Width,Height,FlexDirection,
//                           JustifyContent,AlignItems,AlignSelf,FlexWrap,
//                           FlexGrow,FlexShrink,FlexBasis,Margin,Padding,
//                           PositionType,Position}
//   yoga/YGNodeLayout.h   — YGNodeLayoutGet{Left,Top,Width,Height}
//   yoga/YGConfig.h       — YGConfigNew (one shared config across all nodes)
//   yoga/YGEnums.h        — Enum integer values (mirrored to JS)
//
// We deliberately bind the C API rather than the C++ `facebook::yoga::*`
// scoped enums — Yoga keeps the C API stable across point releases and
// the C++ surface still moves between minor versions. The C symbols are
// what the upstream yoga-layout npm package binds against too:
//   yoga/javascript/src/wrapAsm.ts (line 23+ of the v3.2.1 tarball)
// shows the equivalent extern "C" set; we expose the same set to V8.
//
// Yoga handle registry — yoga nodes are heap-allocated YGNodeRef pointers
// with parent/child relationships that the registry doesn't track. JS owns
// the tree shape via add/remove calls; the registry just holds a
// non-owning handle-to-pointer map plus a YGConfigRef used as the default
// config for created nodes. yogaCreateNode / yogaFreeNode keep the
// registry coherent.
//
// NaN semantics: Yoga uses `float NaN` (YGUndefined) to mean
// "unspecified" for dimensions and edges. The JS layer passes `NaN`
// through Number → double → float cast; we pass it straight to Yoga.
// Set explicit 0/non-NaN values when you want a constraint.
struct YogaRegistry {
  std::mutex mu;
  uint32_t next_id = 1;
  YGConfigRef config = nullptr;
  std::unordered_map<uint32_t, YGNodeRef> nodes;
};

static YogaRegistry& YogaReg() {
  static YogaRegistry r;
  return r;
}

static YGNodeRef LookupYogaNode(uint32_t id) {
  YogaRegistry& r = YogaReg();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.nodes.find(id);
  return it == r.nodes.end() ? nullptr : it->second;
}

static void YogaCreateNode(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  YogaRegistry& r = YogaReg();
  std::lock_guard<std::mutex> lock(r.mu);
  if (r.config == nullptr) {
    r.config = YGConfigNew();
  }
  YGNodeRef node = YGNodeNewWithConfig(r.config);
  uint32_t id = r.next_id++;
  r.nodes.emplace(id, node);
  args.GetReturnValue().Set(Integer::NewFromUnsigned(isolate, id));
}

uint32_t FastYogaCreateNode(Local<Value> receiver,
                            // NOLINTNEXTLINE(runtime/references)
                            FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaCreateNode");
  YogaRegistry& r = YogaReg();
  std::lock_guard<std::mutex> lock(r.mu);
  if (r.config == nullptr) {
    r.config = YGConfigNew();
  }
  YGNodeRef node = YGNodeNewWithConfig(r.config);
  uint32_t id = r.next_id++;
  r.nodes.emplace(id, node);
  return id;
}

static CFunction fast_yoga_create_node(CFunction::Make(FastYogaCreateNode));

static void YogaFreeNode(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  YogaRegistry& r = YogaReg();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.nodes.find(id);
  if (it != r.nodes.end()) {
    YGNodeFree(it->second);
    r.nodes.erase(it);
  }
}

void FastYogaFreeNode(Local<Value> receiver, uint32_t id,
                      // NOLINTNEXTLINE(runtime/references)
                      FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaFreeNode");
  YogaRegistry& r = YogaReg();
  std::lock_guard<std::mutex> lock(r.mu);
  auto it = r.nodes.find(id);
  if (it != r.nodes.end()) {
    YGNodeFree(it->second);
    r.nodes.erase(it);
  }
}

static CFunction fast_yoga_free_node(CFunction::Make(FastYogaFreeNode));

// yogaInsertChild(parentId, childId, index)
static void YogaInsertChild(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t parent_id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t child_id = args[1]->Uint32Value(context).FromMaybe(0);
  uint32_t index = args[2]->Uint32Value(context).FromMaybe(0);
  YGNodeRef parent = LookupYogaNode(parent_id);
  YGNodeRef child = LookupYogaNode(child_id);
  if (parent != nullptr && child != nullptr) {
    YGNodeInsertChild(parent, child, index);
  }
}

void FastYogaInsertChild(Local<Value> receiver, uint32_t parent_id,
                         uint32_t child_id, uint32_t index,
                         // NOLINTNEXTLINE(runtime/references)
                         FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaInsertChild");
  YGNodeRef parent = LookupYogaNode(parent_id);
  YGNodeRef child = LookupYogaNode(child_id);
  if (parent != nullptr && child != nullptr) {
    YGNodeInsertChild(parent, child, index);
  }
}

static CFunction fast_yoga_insert_child(
    CFunction::Make(FastYogaInsertChild));

static void YogaRemoveChild(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t parent_id = args[0]->Uint32Value(context).FromMaybe(0);
  uint32_t child_id = args[1]->Uint32Value(context).FromMaybe(0);
  YGNodeRef parent = LookupYogaNode(parent_id);
  YGNodeRef child = LookupYogaNode(child_id);
  if (parent != nullptr && child != nullptr) {
    YGNodeRemoveChild(parent, child);
  }
}

void FastYogaRemoveChild(Local<Value> receiver, uint32_t parent_id,
                         uint32_t child_id,
                         // NOLINTNEXTLINE(runtime/references)
                         FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaRemoveChild");
  YGNodeRef parent = LookupYogaNode(parent_id);
  YGNodeRef child = LookupYogaNode(child_id);
  if (parent != nullptr && child != nullptr) {
    YGNodeRemoveChild(parent, child);
  }
}

static CFunction fast_yoga_remove_child(
    CFunction::Make(FastYogaRemoveChild));

// yogaCalculateLayout(nodeId, availWidth, availHeight, ownerDirection)
// availWidth/availHeight are floats; NaN means unconstrained.
static void YogaCalculateLayout(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  float avail_w = static_cast<float>(
      args[1]->NumberValue(context).FromMaybe(YGUndefined));
  float avail_h = static_cast<float>(
      args[2]->NumberValue(context).FromMaybe(YGUndefined));
  int32_t dir = static_cast<int32_t>(
      args[3]->Int32Value(context).FromMaybe(YGDirectionLTR));
  YGNodeRef node = LookupYogaNode(id);
  if (node == nullptr) {
    return;
  }
  YGNodeCalculateLayout(node, avail_w, avail_h,
                        static_cast<YGDirection>(dir));
}

void FastYogaCalculateLayout(Local<Value> receiver, uint32_t id,
                             double avail_w, double avail_h, int32_t dir,
                             // NOLINTNEXTLINE(runtime/references)
                             FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaCalculateLayout");
  YGNodeRef node = LookupYogaNode(id);
  if (node == nullptr) {
    return;
  }
  YGNodeCalculateLayout(node, static_cast<float>(avail_w),
                        static_cast<float>(avail_h),
                        static_cast<YGDirection>(dir));
}

static CFunction fast_yoga_calculate_layout(
    CFunction::Make(FastYogaCalculateLayout));

static void YogaMarkDirty(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeMarkDirty(node);
  }
}

void FastYogaMarkDirty(Local<Value> receiver, uint32_t id,
                       // NOLINTNEXTLINE(runtime/references)
                       FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaMarkDirty");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeMarkDirty(node);
  }
}

static CFunction fast_yoga_mark_dirty(CFunction::Make(FastYogaMarkDirty));

// yogaGetComputedLayout(nodeId) -> { left, top, width, height }
static void YogaGetComputedLayout(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  YGNodeRef node = LookupYogaNode(id);
  Local<Object> obj = Object::New(isolate);
  if (node == nullptr) {
    obj->Set(context, NewOneByteString(isolate, "left"),
             Number::New(isolate, 0.0))
        .Check();
    obj->Set(context, NewOneByteString(isolate, "top"),
             Number::New(isolate, 0.0))
        .Check();
    obj->Set(context, NewOneByteString(isolate, "width"),
             Number::New(isolate, 0.0))
        .Check();
    obj->Set(context, NewOneByteString(isolate, "height"),
             Number::New(isolate, 0.0))
        .Check();
    args.GetReturnValue().Set(obj);
    return;
  }
  obj->Set(context, NewOneByteString(isolate, "left"),
           Number::New(isolate, YGNodeLayoutGetLeft(node)))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "top"),
           Number::New(isolate, YGNodeLayoutGetTop(node)))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "width"),
           Number::New(isolate, YGNodeLayoutGetWidth(node)))
      .Check();
  obj->Set(context, NewOneByteString(isolate, "height"),
           Number::New(isolate, YGNodeLayoutGetHeight(node)))
      .Check();
  args.GetReturnValue().Set(obj);
}

// Style setters: each takes (nodeId, value) and routes to the matching
// YGNodeStyleSet* call. Enum-typed values use the integer cast; the JS
// layer pulls them from the binding's `yoga.*` enum mirrors.

static void YogaSetWidth(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  float v = static_cast<float>(
      args[1]->NumberValue(context).FromMaybe(YGUndefined));
  YGNodeStyleSetWidth(node, v);
}

void FastYogaSetWidth(Local<Value> receiver, uint32_t id, double v,
                      // NOLINTNEXTLINE(runtime/references)
                      FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetWidth");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetWidth(node, static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_width(CFunction::Make(FastYogaSetWidth));

static void YogaSetHeight(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  float v = static_cast<float>(
      args[1]->NumberValue(context).FromMaybe(YGUndefined));
  YGNodeStyleSetHeight(node, v);
}

void FastYogaSetHeight(Local<Value> receiver, uint32_t id, double v,
                       // NOLINTNEXTLINE(runtime/references)
                       FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetHeight");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetHeight(node, static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_height(CFunction::Make(FastYogaSetHeight));

static void YogaSetFlexDirection(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t v = args[1]->Int32Value(context).FromMaybe(0);
  YGNodeStyleSetFlexDirection(node, static_cast<YGFlexDirection>(v));
}

void FastYogaSetFlexDirection(Local<Value> receiver, uint32_t id, int32_t v,
                              // NOLINTNEXTLINE(runtime/references)
                              FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetFlexDirection");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetFlexDirection(node, static_cast<YGFlexDirection>(v));
  }
}

static CFunction fast_yoga_set_flex_direction(
    CFunction::Make(FastYogaSetFlexDirection));

static void YogaSetJustifyContent(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t v = args[1]->Int32Value(context).FromMaybe(0);
  YGNodeStyleSetJustifyContent(node, static_cast<YGJustify>(v));
}

void FastYogaSetJustifyContent(Local<Value> receiver, uint32_t id, int32_t v,
                               // NOLINTNEXTLINE(runtime/references)
                               FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetJustifyContent");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetJustifyContent(node, static_cast<YGJustify>(v));
  }
}

static CFunction fast_yoga_set_justify_content(
    CFunction::Make(FastYogaSetJustifyContent));

static void YogaSetAlignItems(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t v = args[1]->Int32Value(context).FromMaybe(0);
  YGNodeStyleSetAlignItems(node, static_cast<YGAlign>(v));
}

void FastYogaSetAlignItems(Local<Value> receiver, uint32_t id, int32_t v,
                           // NOLINTNEXTLINE(runtime/references)
                           FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetAlignItems");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetAlignItems(node, static_cast<YGAlign>(v));
  }
}

static CFunction fast_yoga_set_align_items(
    CFunction::Make(FastYogaSetAlignItems));

static void YogaSetAlignSelf(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t v = args[1]->Int32Value(context).FromMaybe(0);
  YGNodeStyleSetAlignSelf(node, static_cast<YGAlign>(v));
}

void FastYogaSetAlignSelf(Local<Value> receiver, uint32_t id, int32_t v,
                          // NOLINTNEXTLINE(runtime/references)
                          FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetAlignSelf");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetAlignSelf(node, static_cast<YGAlign>(v));
  }
}

static CFunction fast_yoga_set_align_self(
    CFunction::Make(FastYogaSetAlignSelf));

static void YogaSetFlexWrap(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t v = args[1]->Int32Value(context).FromMaybe(0);
  YGNodeStyleSetFlexWrap(node, static_cast<YGWrap>(v));
}

void FastYogaSetFlexWrap(Local<Value> receiver, uint32_t id, int32_t v,
                         // NOLINTNEXTLINE(runtime/references)
                         FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetFlexWrap");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetFlexWrap(node, static_cast<YGWrap>(v));
  }
}

static CFunction fast_yoga_set_flex_wrap(CFunction::Make(FastYogaSetFlexWrap));

static void YogaSetFlexGrow(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  float v = static_cast<float>(args[1]->NumberValue(context).FromMaybe(0.0));
  YGNodeStyleSetFlexGrow(node, v);
}

void FastYogaSetFlexGrow(Local<Value> receiver, uint32_t id, double v,
                         // NOLINTNEXTLINE(runtime/references)
                         FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetFlexGrow");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetFlexGrow(node, static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_flex_grow(CFunction::Make(FastYogaSetFlexGrow));

static void YogaSetFlexShrink(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  float v = static_cast<float>(args[1]->NumberValue(context).FromMaybe(0.0));
  YGNodeStyleSetFlexShrink(node, v);
}

void FastYogaSetFlexShrink(Local<Value> receiver, uint32_t id, double v,
                           // NOLINTNEXTLINE(runtime/references)
                           FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetFlexShrink");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetFlexShrink(node, static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_flex_shrink(
    CFunction::Make(FastYogaSetFlexShrink));

static void YogaSetFlexBasis(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  float v = static_cast<float>(
      args[1]->NumberValue(context).FromMaybe(YGUndefined));
  YGNodeStyleSetFlexBasis(node, v);
}

void FastYogaSetFlexBasis(Local<Value> receiver, uint32_t id, double v,
                          // NOLINTNEXTLINE(runtime/references)
                          FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetFlexBasis");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetFlexBasis(node, static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_flex_basis(
    CFunction::Make(FastYogaSetFlexBasis));

// yogaSetMargin(nodeId, edge, value)
static void YogaSetMargin(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t edge = args[1]->Int32Value(context).FromMaybe(0);
  float v = static_cast<float>(args[2]->NumberValue(context).FromMaybe(0.0));
  YGNodeStyleSetMargin(node, static_cast<YGEdge>(edge), v);
}

void FastYogaSetMargin(Local<Value> receiver, uint32_t id, int32_t edge,
                       double v,
                       // NOLINTNEXTLINE(runtime/references)
                       FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetMargin");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetMargin(node, static_cast<YGEdge>(edge),
                         static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_margin(CFunction::Make(FastYogaSetMargin));

static void YogaSetPadding(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t edge = args[1]->Int32Value(context).FromMaybe(0);
  float v = static_cast<float>(args[2]->NumberValue(context).FromMaybe(0.0));
  YGNodeStyleSetPadding(node, static_cast<YGEdge>(edge), v);
}

void FastYogaSetPadding(Local<Value> receiver, uint32_t id, int32_t edge,
                        double v,
                        // NOLINTNEXTLINE(runtime/references)
                        FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetPadding");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetPadding(node, static_cast<YGEdge>(edge),
                          static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_padding(CFunction::Make(FastYogaSetPadding));

static void YogaSetPositionType(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t v = args[1]->Int32Value(context).FromMaybe(0);
  YGNodeStyleSetPositionType(node, static_cast<YGPositionType>(v));
}

void FastYogaSetPositionType(Local<Value> receiver, uint32_t id, int32_t v,
                             // NOLINTNEXTLINE(runtime/references)
                             FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetPositionType");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetPositionType(node, static_cast<YGPositionType>(v));
  }
}

static CFunction fast_yoga_set_position_type(
    CFunction::Make(FastYogaSetPositionType));

// yogaSetPosition(nodeId, edge, value)
static void YogaSetPosition(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  YGNodeRef node = LookupYogaNode(args[0]->Uint32Value(context).FromMaybe(0));
  if (node == nullptr) {
    return;
  }
  int32_t edge = args[1]->Int32Value(context).FromMaybe(0);
  float v = static_cast<float>(
      args[2]->NumberValue(context).FromMaybe(YGUndefined));
  YGNodeStyleSetPosition(node, static_cast<YGEdge>(edge), v);
}

void FastYogaSetPosition(Local<Value> receiver, uint32_t id, int32_t edge,
                         double v,
                         // NOLINTNEXTLINE(runtime/references)
                         FastApiCallbackOptions& opts) {
  TRACK_V8_FAST_API_CALL("smol_tui.yogaSetPosition");
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeStyleSetPosition(node, static_cast<YGEdge>(edge),
                           static_cast<float>(v));
  }
}

static CFunction fast_yoga_set_position(CFunction::Make(FastYogaSetPosition));

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  Isolate* isolate = context->GetIsolate();
  Local<Object> constants = Object::New(isolate);

#define BIND_CONST(name, value) \
  constants                     \
      ->Set(context, NewOneByteString(isolate, name), \
            NewOneByteString(isolate, value))         \
      .Check();

  BIND_CONST("reset", ti::kReset);
  BIND_CONST("clear", ti::kClear);
  BIND_CONST("home", ti::kHome);
  BIND_CONST("clearAndHome", ti::kClearAndHome);
  BIND_CONST("hideCursor", ti::kHideCursor);
  BIND_CONST("showCursor", ti::kShowCursor);
  BIND_CONST("switchToAltScreen", ti::kSwitchToAltScreen);
  BIND_CONST("switchToMainScreen", ti::kSwitchToMainScreen);
  BIND_CONST("bracketedPasteStart", ti::kBracketedPasteStart);
  BIND_CONST("bracketedPasteEnd", ti::kBracketedPasteEnd);
  BIND_CONST("bracketedPasteSet", ti::kBracketedPasteSet);
  BIND_CONST("bracketedPasteReset", ti::kBracketedPasteReset);
  BIND_CONST("resetBackground", ti::kResetBackground);
  BIND_CONST("resetForeground", ti::kResetForeground);
  BIND_CONST("eraseBelowCursor", ti::kEraseBelowCursor);
  BIND_CONST("nextLine", ti::kNextLine);
  BIND_CONST("bold", ti::kBold);
  BIND_CONST("dim", ti::kDim);
  BIND_CONST("italic", ti::kItalic);
  BIND_CONST("underline", ti::kUnderline);
  BIND_CONST("blink", ti::kBlink);
  BIND_CONST("inverse", ti::kInverse);
  BIND_CONST("hidden", ti::kHidden);
  BIND_CONST("strikethrough", ti::kStrikethrough);

#undef BIND_CONST

  target->Set(context, NewOneByteString(isolate, "constants"), constants)
      .Check();

  Local<Object> sizes = Object::New(isolate);
  sizes
      ->Set(context, NewOneByteString(isolate, "maxCursorPositionLen"),
            Integer::New(
                isolate,
                static_cast<int32_t>(ti::kMaxCursorPositionLen)))
      .Check();
  sizes
      ->Set(context, NewOneByteString(isolate, "maxRgbSgrLen"),
            Integer::New(isolate, static_cast<int32_t>(ti::kMaxRgbSgrLen)))
      .Check();
  sizes
      ->Set(context, NewOneByteString(isolate, "maxAttrRunLen"),
            Integer::New(isolate, static_cast<int32_t>(ti::kMaxAttrRunLen)))
      .Check();
  sizes
      ->Set(context, NewOneByteString(isolate, "flushOverflow"),
            Number::New(isolate,
                        static_cast<double>(ti::Renderer::kFlushOverflow)))
      .Check();
  target->Set(context, NewOneByteString(isolate, "sizes"), sizes).Check();

  SetMethod(context, target, "cursorPosition", CursorPosition);
  SetMethod(context, target, "setFgRgb", SetFgRgb);
  SetMethod(context, target, "setBgRgb", SetBgRgb);
  SetFastMethodNoSideEffect(context, target, "writeCursorPosition",
                            WriteCursorPosition, &fast_write_cursor_position);
  SetFastMethodNoSideEffect(context, target, "writeFgRgb", WriteFgRgb,
                            &fast_write_fg_rgb);
  SetFastMethodNoSideEffect(context, target, "writeBgRgb", WriteBgRgb,
                            &fast_write_bg_rgb);
  SetFastMethodNoSideEffect(context, target, "writeAttributes", WriteAttributes,
                            &fast_write_attributes);

  SetMethod(context, target, "createParser", CreateParser);
  SetMethod(context, target, "destroyParser", DestroyParser);
  SetMethod(context, target, "resetParser", ResetParser);
  SetMethod(context, target, "parseMouseOne", ParseMouseOne);
  SetFastMethodNoSideEffect(context, target, "looksLikeMouseSequence",
                            LooksLikeMouseSequence,
                            &fast_looks_like_mouse_sequence);

  SetMethod(context, target, "createRenderer", CreateRenderer);
  SetMethod(context, target, "destroyRenderer", DestroyRenderer);
  SetFastMethodNoSideEffect(context, target, "rendererResize", RendererResize,
                            &fast_renderer_resize);
  SetFastMethodNoSideEffect(context, target, "rendererInvalidate",
                            RendererInvalidate, &fast_renderer_invalidate);
  SetFastMethodNoSideEffect(context, target, "rendererClear", RendererClear,
                            &fast_renderer_clear);
  SetFastMethodNoSideEffect(context, target, "rendererSet", RendererSet,
                            &fast_renderer_set);
  SetFastMethodNoSideEffect(context, target, "rendererFillRect",
                            RendererFillRect, &fast_renderer_fill_rect);
  SetFastMethodNoSideEffect(context, target, "rendererDrawText",
                            RendererDrawText, &fast_renderer_draw_text);
  SetFastMethodNoSideEffect(context, target, "rendererFlush", RendererFlush,
                            &fast_renderer_flush);
  SetMethod(context, target, "rendererSize", RendererSize);

  // Renderables (high-level draw helpers).
  SetMethod(context, target, "rendererDrawBox", RendererDrawBox);
  SetMethod(context, target, "rendererDrawTextWrapped",
            RendererDrawTextWrapped);

  // String width (Unicode 16.0).
  SetMethod(context, target, "stringWidth", StringWidthBinding);
  SetMethod(context, target, "stringWidthFromBytes", StringWidthFromBytes);
  SetMethod(context, target, "codepointWidth", CodepointWidthBinding);

  SetFastMethodNoSideEffect(context, target, "yogaCalculateLayout",
                            YogaCalculateLayout,
                            &fast_yoga_calculate_layout);
  SetFastMethodNoSideEffect(context, target, "yogaCreateNode", YogaCreateNode,
                            &fast_yoga_create_node);
  SetFastMethodNoSideEffect(context, target, "yogaFreeNode", YogaFreeNode,
                            &fast_yoga_free_node);
  SetMethod(context, target, "yogaGetComputedLayout", YogaGetComputedLayout);
  SetFastMethodNoSideEffect(context, target, "yogaInsertChild",
                            YogaInsertChild, &fast_yoga_insert_child);
  SetFastMethodNoSideEffect(context, target, "yogaMarkDirty", YogaMarkDirty,
                            &fast_yoga_mark_dirty);
  SetFastMethodNoSideEffect(context, target, "yogaRemoveChild",
                            YogaRemoveChild, &fast_yoga_remove_child);
  SetFastMethodNoSideEffect(context, target, "yogaSetAlignItems",
                            YogaSetAlignItems, &fast_yoga_set_align_items);
  SetFastMethodNoSideEffect(context, target, "yogaSetAlignSelf",
                            YogaSetAlignSelf, &fast_yoga_set_align_self);
  SetFastMethodNoSideEffect(context, target, "yogaSetFlexBasis",
                            YogaSetFlexBasis, &fast_yoga_set_flex_basis);
  SetFastMethodNoSideEffect(context, target, "yogaSetFlexDirection",
                            YogaSetFlexDirection,
                            &fast_yoga_set_flex_direction);
  SetFastMethodNoSideEffect(context, target, "yogaSetFlexGrow",
                            YogaSetFlexGrow, &fast_yoga_set_flex_grow);
  SetFastMethodNoSideEffect(context, target, "yogaSetFlexShrink",
                            YogaSetFlexShrink, &fast_yoga_set_flex_shrink);
  SetFastMethodNoSideEffect(context, target, "yogaSetFlexWrap",
                            YogaSetFlexWrap, &fast_yoga_set_flex_wrap);
  SetFastMethodNoSideEffect(context, target, "yogaSetHeight", YogaSetHeight,
                            &fast_yoga_set_height);
  SetFastMethodNoSideEffect(context, target, "yogaSetJustifyContent",
                            YogaSetJustifyContent,
                            &fast_yoga_set_justify_content);
  SetFastMethodNoSideEffect(context, target, "yogaSetMargin", YogaSetMargin,
                            &fast_yoga_set_margin);
  SetFastMethodNoSideEffect(context, target, "yogaSetPadding", YogaSetPadding,
                            &fast_yoga_set_padding);
  SetFastMethodNoSideEffect(context, target, "yogaSetPosition", YogaSetPosition,
                            &fast_yoga_set_position);
  SetFastMethodNoSideEffect(context, target, "yogaSetPositionType",
                            YogaSetPositionType,
                            &fast_yoga_set_position_type);
  SetFastMethodNoSideEffect(context, target, "yogaSetWidth", YogaSetWidth,
                            &fast_yoga_set_width);

  // Yoga enum mirrors. Values come straight from YG*.h so JS doesn't
  // hard-code numbers that could drift if Yoga adds a new entry.
  Local<Object> flexDirection = Object::New(isolate);
#define BIND_FLEX_DIR(name, value)                                  \
  flexDirection                                                     \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_FLEX_DIR("COLUMN", YGFlexDirectionColumn);
  BIND_FLEX_DIR("COLUMN_REVERSE", YGFlexDirectionColumnReverse);
  BIND_FLEX_DIR("ROW", YGFlexDirectionRow);
  BIND_FLEX_DIR("ROW_REVERSE", YGFlexDirectionRowReverse);
#undef BIND_FLEX_DIR
  target->Set(context, NewOneByteString(isolate, "flexDirection"),
              flexDirection)
      .Check();

  Local<Object> justify = Object::New(isolate);
#define BIND_JUSTIFY(name, value)                                   \
  justify                                                           \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_JUSTIFY("FLEX_START", YGJustifyFlexStart);
  BIND_JUSTIFY("CENTER", YGJustifyCenter);
  BIND_JUSTIFY("FLEX_END", YGJustifyFlexEnd);
  BIND_JUSTIFY("SPACE_BETWEEN", YGJustifySpaceBetween);
  BIND_JUSTIFY("SPACE_AROUND", YGJustifySpaceAround);
  BIND_JUSTIFY("SPACE_EVENLY", YGJustifySpaceEvenly);
#undef BIND_JUSTIFY
  target->Set(context, NewOneByteString(isolate, "justify"), justify)
      .Check();

  Local<Object> align = Object::New(isolate);
#define BIND_ALIGN(name, value)                                     \
  align                                                             \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_ALIGN("AUTO", YGAlignAuto);
  BIND_ALIGN("FLEX_START", YGAlignFlexStart);
  BIND_ALIGN("CENTER", YGAlignCenter);
  BIND_ALIGN("FLEX_END", YGAlignFlexEnd);
  BIND_ALIGN("STRETCH", YGAlignStretch);
  BIND_ALIGN("BASELINE", YGAlignBaseline);
  BIND_ALIGN("SPACE_BETWEEN", YGAlignSpaceBetween);
  BIND_ALIGN("SPACE_AROUND", YGAlignSpaceAround);
  BIND_ALIGN("SPACE_EVENLY", YGAlignSpaceEvenly);
#undef BIND_ALIGN
  target->Set(context, NewOneByteString(isolate, "align"), align).Check();

  Local<Object> edge = Object::New(isolate);
#define BIND_EDGE(name, value)                                      \
  edge                                                              \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_EDGE("LEFT", YGEdgeLeft);
  BIND_EDGE("TOP", YGEdgeTop);
  BIND_EDGE("RIGHT", YGEdgeRight);
  BIND_EDGE("BOTTOM", YGEdgeBottom);
  BIND_EDGE("START", YGEdgeStart);
  BIND_EDGE("END", YGEdgeEnd);
  BIND_EDGE("HORIZONTAL", YGEdgeHorizontal);
  BIND_EDGE("VERTICAL", YGEdgeVertical);
  BIND_EDGE("ALL", YGEdgeAll);
#undef BIND_EDGE
  target->Set(context, NewOneByteString(isolate, "edge"), edge).Check();

  Local<Object> wrap = Object::New(isolate);
#define BIND_WRAP(name, value)                                      \
  wrap                                                              \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_WRAP("NO_WRAP", YGWrapNoWrap);
  BIND_WRAP("WRAP", YGWrapWrap);
  BIND_WRAP("WRAP_REVERSE", YGWrapWrapReverse);
#undef BIND_WRAP
  target->Set(context, NewOneByteString(isolate, "wrap"), wrap).Check();

  Local<Object> positionType = Object::New(isolate);
#define BIND_POS(name, value)                                       \
  positionType                                                      \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_POS("STATIC", YGPositionTypeStatic);
  BIND_POS("RELATIVE", YGPositionTypeRelative);
  BIND_POS("ABSOLUTE", YGPositionTypeAbsolute);
#undef BIND_POS
  target->Set(context, NewOneByteString(isolate, "positionType"),
              positionType)
      .Check();

  Local<Object> direction = Object::New(isolate);
#define BIND_DIR(name, value)                                       \
  direction                                                         \
      ->Set(context, NewOneByteString(isolate, name),               \
            Integer::New(isolate, static_cast<int32_t>(value)))     \
      .Check();
  BIND_DIR("INHERIT", YGDirectionInherit);
  BIND_DIR("LTR", YGDirectionLTR);
  BIND_DIR("RTL", YGDirectionRTL);
#undef BIND_DIR
  target->Set(context, NewOneByteString(isolate, "direction"), direction)
      .Check();

  Local<Object> events = Object::New(isolate);
#define BIND_EVENT(name, value) \
  events                        \
      ->Set(context, NewOneByteString(isolate, name), \
            Integer::New(isolate, static_cast<int32_t>(value))) \
      .Check();
  BIND_EVENT("DOWN", ti::MouseEventType::kDown);
  BIND_EVENT("UP", ti::MouseEventType::kUp);
  BIND_EVENT("MOVE", ti::MouseEventType::kMove);
  BIND_EVENT("DRAG", ti::MouseEventType::kDrag);
  BIND_EVENT("DRAG_END", ti::MouseEventType::kDragEnd);
  BIND_EVENT("DROP", ti::MouseEventType::kDrop);
  BIND_EVENT("OVER", ti::MouseEventType::kOver);
  BIND_EVENT("OUT", ti::MouseEventType::kOut);
  BIND_EVENT("SCROLL", ti::MouseEventType::kScroll);
#undef BIND_EVENT
  target->Set(context, NewOneByteString(isolate, "mouseEventType"), events)
      .Check();

  Local<Object> scrolls = Object::New(isolate);
#define BIND_SCROLL(name, value) \
  scrolls                        \
      ->Set(context, NewOneByteString(isolate, name), \
            Integer::New(isolate, static_cast<int32_t>(value))) \
      .Check();
  BIND_SCROLL("UP", ti::ScrollDirection::kUp);
  BIND_SCROLL("DOWN", ti::ScrollDirection::kDown);
  BIND_SCROLL("LEFT", ti::ScrollDirection::kLeft);
  BIND_SCROLL("RIGHT", ti::ScrollDirection::kRight);
#undef BIND_SCROLL
  target->Set(context, NewOneByteString(isolate, "scrollDirection"), scrolls)
      .Check();
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CursorPosition);
  registry->Register(SetFgRgb);
  registry->Register(SetBgRgb);
  registry->Register(WriteCursorPosition);
  registry->Register(fast_write_cursor_position);
  registry->Register(WriteFgRgb);
  registry->Register(fast_write_fg_rgb);
  registry->Register(WriteBgRgb);
  registry->Register(fast_write_bg_rgb);
  registry->Register(WriteAttributes);
  registry->Register(fast_write_attributes);
  registry->Register(CreateParser);
  registry->Register(DestroyParser);
  registry->Register(ResetParser);
  registry->Register(ParseMouseOne);
  registry->Register(LooksLikeMouseSequence);
  registry->Register(fast_looks_like_mouse_sequence);
  registry->Register(CreateRenderer);
  registry->Register(DestroyRenderer);
  registry->Register(RendererResize);
  registry->Register(fast_renderer_resize);
  registry->Register(RendererInvalidate);
  registry->Register(fast_renderer_invalidate);
  registry->Register(RendererClear);
  registry->Register(fast_renderer_clear);
  registry->Register(RendererSet);
  registry->Register(fast_renderer_set);
  registry->Register(RendererFillRect);
  registry->Register(fast_renderer_fill_rect);
  registry->Register(RendererDrawText);
  registry->Register(fast_renderer_draw_text);
  registry->Register(RendererFlush);
  registry->Register(fast_renderer_flush);
  registry->Register(RendererSize);
  registry->Register(RendererDrawBox);
  registry->Register(RendererDrawTextWrapped);
  registry->Register(StringWidthBinding);
  registry->Register(StringWidthFromBytes);
  registry->Register(CodepointWidthBinding);
  registry->Register(YogaCalculateLayout);
  registry->Register(fast_yoga_calculate_layout);
  registry->Register(YogaCreateNode);
  registry->Register(fast_yoga_create_node);
  registry->Register(YogaFreeNode);
  registry->Register(fast_yoga_free_node);
  registry->Register(YogaGetComputedLayout);
  registry->Register(YogaInsertChild);
  registry->Register(fast_yoga_insert_child);
  registry->Register(YogaMarkDirty);
  registry->Register(fast_yoga_mark_dirty);
  registry->Register(YogaRemoveChild);
  registry->Register(fast_yoga_remove_child);
  registry->Register(YogaSetAlignItems);
  registry->Register(fast_yoga_set_align_items);
  registry->Register(YogaSetAlignSelf);
  registry->Register(fast_yoga_set_align_self);
  registry->Register(YogaSetFlexBasis);
  registry->Register(fast_yoga_set_flex_basis);
  registry->Register(YogaSetFlexDirection);
  registry->Register(fast_yoga_set_flex_direction);
  registry->Register(YogaSetFlexGrow);
  registry->Register(fast_yoga_set_flex_grow);
  registry->Register(YogaSetFlexShrink);
  registry->Register(fast_yoga_set_flex_shrink);
  registry->Register(YogaSetFlexWrap);
  registry->Register(fast_yoga_set_flex_wrap);
  registry->Register(YogaSetHeight);
  registry->Register(fast_yoga_set_height);
  registry->Register(YogaSetJustifyContent);
  registry->Register(fast_yoga_set_justify_content);
  registry->Register(YogaSetMargin);
  registry->Register(fast_yoga_set_margin);
  registry->Register(YogaSetPadding);
  registry->Register(fast_yoga_set_padding);
  registry->Register(YogaSetPosition);
  registry->Register(fast_yoga_set_position);
  registry->Register(YogaSetPositionType);
  registry->Register(fast_yoga_set_position_type);
  registry->Register(YogaSetWidth);
  registry->Register(fast_yoga_set_width);
}

}  // namespace tui
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_tui,
                                    node::socketsecurity::tui::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_tui, node::socketsecurity::tui::RegisterExternalReferences)
