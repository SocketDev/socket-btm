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
//   * FastApi specialization is intentionally deferred. SetMethod
//     entries are wired now so the surface is stable; the conversion
//     to v8::CFunction is mechanical and lands once the bench is in
//     place.
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

#include "socketsecurity/tui/ansi.hpp"
#include "socketsecurity/tui/cell.hpp"
#include "socketsecurity/tui/mouse.hpp"
#include "socketsecurity/tui/renderer.hpp"

#include "yoga/Yoga.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace node {
namespace socketsecurity {
namespace tui {

using v8::Boolean;
using v8::Context;
using v8::FunctionCallbackInfo;
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

static void RendererInvalidate(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  ti::Renderer* renderer = LookupRenderer(id);
  if (renderer != nullptr) {
    renderer->Invalidate();
  }
}

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

static void YogaMarkDirty(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  uint32_t id = args[0]->Uint32Value(context).FromMaybe(0);
  YGNodeRef node = LookupYogaNode(id);
  if (node != nullptr) {
    YGNodeMarkDirty(node);
  }
}

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
  SetMethod(context, target, "writeCursorPosition", WriteCursorPosition);
  SetMethod(context, target, "writeFgRgb", WriteFgRgb);
  SetMethod(context, target, "writeBgRgb", WriteBgRgb);
  SetMethod(context, target, "writeAttributes", WriteAttributes);

  SetMethod(context, target, "createParser", CreateParser);
  SetMethod(context, target, "destroyParser", DestroyParser);
  SetMethod(context, target, "resetParser", ResetParser);
  SetMethod(context, target, "parseMouseOne", ParseMouseOne);
  SetMethod(context, target, "looksLikeMouseSequence", LooksLikeMouseSequence);

  SetMethod(context, target, "createRenderer", CreateRenderer);
  SetMethod(context, target, "destroyRenderer", DestroyRenderer);
  SetMethod(context, target, "rendererResize", RendererResize);
  SetMethod(context, target, "rendererInvalidate", RendererInvalidate);
  SetMethod(context, target, "rendererClear", RendererClear);
  SetMethod(context, target, "rendererSet", RendererSet);
  SetMethod(context, target, "rendererFillRect", RendererFillRect);
  SetMethod(context, target, "rendererDrawText", RendererDrawText);
  SetMethod(context, target, "rendererFlush", RendererFlush);
  SetMethod(context, target, "rendererSize", RendererSize);

  SetMethod(context, target, "yogaCalculateLayout", YogaCalculateLayout);
  SetMethod(context, target, "yogaCreateNode", YogaCreateNode);
  SetMethod(context, target, "yogaFreeNode", YogaFreeNode);
  SetMethod(context, target, "yogaGetComputedLayout", YogaGetComputedLayout);
  SetMethod(context, target, "yogaInsertChild", YogaInsertChild);
  SetMethod(context, target, "yogaMarkDirty", YogaMarkDirty);
  SetMethod(context, target, "yogaRemoveChild", YogaRemoveChild);
  SetMethod(context, target, "yogaSetAlignItems", YogaSetAlignItems);
  SetMethod(context, target, "yogaSetAlignSelf", YogaSetAlignSelf);
  SetMethod(context, target, "yogaSetFlexBasis", YogaSetFlexBasis);
  SetMethod(context, target, "yogaSetFlexDirection", YogaSetFlexDirection);
  SetMethod(context, target, "yogaSetFlexGrow", YogaSetFlexGrow);
  SetMethod(context, target, "yogaSetFlexShrink", YogaSetFlexShrink);
  SetMethod(context, target, "yogaSetFlexWrap", YogaSetFlexWrap);
  SetMethod(context, target, "yogaSetHeight", YogaSetHeight);
  SetMethod(context, target, "yogaSetJustifyContent", YogaSetJustifyContent);
  SetMethod(context, target, "yogaSetMargin", YogaSetMargin);
  SetMethod(context, target, "yogaSetPadding", YogaSetPadding);
  SetMethod(context, target, "yogaSetPosition", YogaSetPosition);
  SetMethod(context, target, "yogaSetPositionType", YogaSetPositionType);
  SetMethod(context, target, "yogaSetWidth", YogaSetWidth);

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
  registry->Register(WriteFgRgb);
  registry->Register(WriteBgRgb);
  registry->Register(WriteAttributes);
  registry->Register(CreateParser);
  registry->Register(DestroyParser);
  registry->Register(ResetParser);
  registry->Register(ParseMouseOne);
  registry->Register(LooksLikeMouseSequence);
  registry->Register(CreateRenderer);
  registry->Register(DestroyRenderer);
  registry->Register(RendererResize);
  registry->Register(RendererInvalidate);
  registry->Register(RendererClear);
  registry->Register(RendererSet);
  registry->Register(RendererFillRect);
  registry->Register(RendererDrawText);
  registry->Register(RendererFlush);
  registry->Register(RendererSize);
  registry->Register(YogaCalculateLayout);
  registry->Register(YogaCreateNode);
  registry->Register(YogaFreeNode);
  registry->Register(YogaGetComputedLayout);
  registry->Register(YogaInsertChild);
  registry->Register(YogaMarkDirty);
  registry->Register(YogaRemoveChild);
  registry->Register(YogaSetAlignItems);
  registry->Register(YogaSetAlignSelf);
  registry->Register(YogaSetFlexBasis);
  registry->Register(YogaSetFlexDirection);
  registry->Register(YogaSetFlexGrow);
  registry->Register(YogaSetFlexShrink);
  registry->Register(YogaSetFlexWrap);
  registry->Register(YogaSetHeight);
  registry->Register(YogaSetJustifyContent);
  registry->Register(YogaSetMargin);
  registry->Register(YogaSetPadding);
  registry->Register(YogaSetPosition);
  registry->Register(YogaSetPositionType);
  registry->Register(YogaSetWidth);
}

}  // namespace tui
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_tui,
                                    node::socketsecurity::tui::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_tui, node::socketsecurity::tui::RegisterExternalReferences)
