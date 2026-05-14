// node:smol-tui V8 binding glue.
//
// Exposes the tui-infra ANSI emit + cell buffer primitives to JS. The
// hot-path writers (CursorPosition, FgRgb, BgRgb, Attributes) are wired
// as plain SetMethod entries for now; a follow-up moves them to V8
// FastApi specializations once the bench is in place.
//
// Buffer / renderer surfaces are placeholders — they appear in the
// binding so the JS lib has stable property names, but most return
// NotImplemented until the per-frame flush logic lands.

#include "socketsecurity/tui/ansi.hpp"
#include "socketsecurity/tui/cell.hpp"
#include "socketsecurity/tui/mouse.hpp"
#include "socketsecurity/tui/renderer.hpp"

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

// Hot-path writers: caller passes a Uint8Array and a byte offset; we
// write directly into the backing store. JS does no allocation per call.
// Returns the number of bytes written. Out-of-bounds offsets or
// overshort buffers return 0; the JS layer treats 0 as an overflow
// signal and grows.

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
}

}  // namespace tui
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_tui,
                                    node::socketsecurity::tui::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_tui, node::socketsecurity::tui::RegisterExternalReferences)
