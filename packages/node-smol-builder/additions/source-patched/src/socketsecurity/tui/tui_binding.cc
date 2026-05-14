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

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cstring>
#include <string>

namespace node {
namespace socketsecurity {
namespace tui {

using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::NewStringType;
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
  target->Set(context, NewOneByteString(isolate, "sizes"), sizes).Check();

  SetMethod(context, target, "cursorPosition", CursorPosition);
  SetMethod(context, target, "setFgRgb", SetFgRgb);
  SetMethod(context, target, "setBgRgb", SetBgRgb);
  SetMethod(context, target, "writeCursorPosition", WriteCursorPosition);
  SetMethod(context, target, "writeFgRgb", WriteFgRgb);
  SetMethod(context, target, "writeBgRgb", WriteBgRgb);
  SetMethod(context, target, "writeAttributes", WriteAttributes);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(CursorPosition);
  registry->Register(SetFgRgb);
  registry->Register(SetBgRgb);
  registry->Register(WriteCursorPosition);
  registry->Register(WriteFgRgb);
  registry->Register(WriteBgRgb);
  registry->Register(WriteAttributes);
}

}  // namespace tui
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(smol_tui,
                                    node::socketsecurity::tui::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_tui, node::socketsecurity::tui::RegisterExternalReferences)
