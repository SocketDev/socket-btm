// node:smol-qrcode binding.
//
// Wraps fukuchi/libqrencode v4.1.1 (LGPL-2.1, but we link statically
// per the license's relink/dynamic-link allowance — see the README at
// upstream/libqrencode/README for the license terms; libqrencode is
// also explicitly permitted as a static library link).
//
// Surface:
//
//   encode(text, ecLevel?) -> { width: number, matrix: Uint8Array }
//     Encodes `text` as a QR code. Returns the matrix side length
//     (`width`) and a flat Uint8Array of length width*width where
//     each byte's bit 0 indicates whether the cell is black (1) or
//     white (0). Other bits in each byte are upstream's internal
//     state (which-mask, function-pattern, etc.); callers should
//     mask with `& 1` to get just the "is black" boolean.
//
//   ecLevel: optional 0..3 (L=0, M=1, Q=2, H=3). Default = M (level
//     1) — same as the upstream npm `qrcode` library's default.
//
// On encode failure (input too long for any QR version, bad encoding
// etc.) returns `{ width: 0, matrix: empty }`.
//
// The hot path is one libqrencode `QRcode_encodeString8bit` call +
// one buffer copy + one V8 Uint8Array allocation. No per-cell work
// in the binding — libqrencode does all the Reed-Solomon + mask
// computation in C.

#include "socketsecurity/qrcode/libqrencode/qrencode.h"

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cstdint>
#include <cstring>
#include <string>

namespace node {
namespace socketsecurity {
namespace qrcode {

using v8::ArrayBuffer;
using v8::Context;
using v8::FunctionCallbackInfo;
using v8::Integer;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Uint8Array;
using v8::Value;

namespace {

// Map a 0..3 EC level integer to libqrencode's QRecLevel enum.
// Matches the upstream npm `qrcode` library's default convention:
//   0 = L (Low ~7%), 1 = M (Medium ~15%, default), 2 = Q (Quartile
//   ~25%), 3 = H (High ~30%).
inline QRecLevel ToEcLevel(uint32_t level) {
  switch (level) {
    case 0:
      return QR_ECLEVEL_L;
    case 2:
      return QR_ECLEVEL_Q;
    case 3:
      return QR_ECLEVEL_H;
    default:
      return QR_ECLEVEL_M;
  }
}

}  // namespace

static void Encode(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // Build the result object up front so failure paths can return
  // an empty matrix without duplicating the construction code.
  Local<Object> result = Object::New(isolate);
  auto set_empty_result = [&]() {
    result->Set(context, String::NewFromUtf8Literal(isolate, "width"),
                Integer::NewFromUnsigned(isolate, 0))
        .Check();
    result->Set(context, String::NewFromUtf8Literal(isolate, "matrix"),
                Uint8Array::New(ArrayBuffer::New(isolate, 0), 0, 0))
        .Check();
    args.GetReturnValue().Set(result);
  };

  if (args.Length() < 1 || !args[0]->IsString()) {
    set_empty_result();
    return;
  }
  Local<String> text_str = args[0].As<String>();
  const int text_len = text_str->Utf8Length(isolate);
  if (text_len == 0) {
    set_empty_result();
    return;
  }
  std::string text(static_cast<size_t>(text_len), '\0');
  text_str->WriteUtf8(isolate, text.data(), text_len, nullptr,
                      String::NO_NULL_TERMINATION);

  uint32_t level_int = 1;  // default M
  if (args.Length() >= 2) {
    level_int = args[1]->Uint32Value(context).FromMaybe(1);
  }
  const QRecLevel ec_level = ToEcLevel(level_int);

  // version=0 lets libqrencode pick the smallest QR version that
  // fits the input. case_sensitive=1 preserves the input bytes
  // verbatim (8-bit mode); the alternative would be alphanumeric
  // upper-case-only.
  QRcode* qr = QRcode_encodeString8bit(text.c_str(), /*version=*/0,
                                       ec_level);
  if (qr == nullptr) {
    set_empty_result();
    return;
  }

  const int width = qr->width;
  const size_t matrix_size = static_cast<size_t>(width) * width;

  // Allocate the matrix as a JS-side ArrayBuffer so the JS layer owns
  // the buffer (no manual lifetime management on the C++ side).
  Local<ArrayBuffer> ab = ArrayBuffer::New(isolate, matrix_size);
  std::memcpy(ab->Data(), qr->data, matrix_size);
  Local<Uint8Array> matrix = Uint8Array::New(ab, 0, matrix_size);

  QRcode_free(qr);

  result->Set(context, String::NewFromUtf8Literal(isolate, "width"),
              Integer::NewFromUnsigned(isolate, static_cast<uint32_t>(width)))
      .Check();
  result->Set(context, String::NewFromUtf8Literal(isolate, "matrix"), matrix)
      .Check();
  args.GetReturnValue().Set(result);
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "encode", Encode);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(Encode);
}

}  // namespace qrcode
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_qrcode, node::socketsecurity::qrcode::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_qrcode, node::socketsecurity::qrcode::RegisterExternalReferences)
