// node:smol-keychain binding.
//
// Exposes the shared keystore-infra core — the same get/put/delete that the
// proteus daemon and the @socketaddon/keychain `.node` addon use — as an
// in-process native binding for the smol Node binary, so all three surfaces
// share one implementation.
//
// On macOS the read raises Touch ID inside keystore_get (Secure-Enclave ACL);
// linux/win32 are broker-only (libsecret / Credential Manager). The JS module
// (lib/smol-keychain.js) wraps these into the node:smol-keychain surface
// (get / set / del).
//
// Surface:
//
//   get(service, account) -> string | null
//     The secret, or null when absent. Throws on denial / I/O error.
//
//   set(service, account, value) -> undefined
//     Stores behind the OS keystore (biometric ACL on macOS).
//
//   del(service, account) -> undefined
//     Idempotent (deleting an absent item is success).

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cstring>

#include "socketsecurity/keystore-infra/keystore.h"

namespace node {
namespace socketsecurity {
namespace keychain {

using v8::Context;
using v8::Exception;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

namespace {

// Generous bound for a secret read into a fixed stack buffer; matches the
// keychain .node addon. Wiped after copy so plaintext doesn't linger.
constexpr size_t kMaxValue = 8192;

// Throw a JS Error whose message is the stable keystore error-code string, so
// the JS wrapper can branch on err.message ('denied' / 'keystore-unavailable' /
// 'keystore-io').
void ThrowKeystore(Isolate* isolate, int rc) {
  const char* code = rc == KEYSTORE_ERR_DENIED       ? "denied"
                     : rc == KEYSTORE_ERR_UNAVAILABLE ? "keystore-unavailable"
                                                      : "keystore-io";
  isolate->ThrowException(
      Exception::Error(String::NewFromUtf8(isolate, code).ToLocalChecked()));
}

// get(service, account) -> string | null.
void Get(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Utf8Value service(isolate, args[0]);
  Utf8Value account(isolate, args[1]);
  char value[kMaxValue];
  int rc = keystore_get(*service, *account, value, sizeof(value));
  if (rc == KEYSTORE_OK) {
    args.GetReturnValue().Set(
        String::NewFromUtf8(isolate, value).ToLocalChecked());
    // Don't leave the plaintext secret sitting on the stack.
    std::memset(value, 0, sizeof(value));
    return;
  }
  if (rc == KEYSTORE_ERR_NOT_FOUND) {
    args.GetReturnValue().SetNull();
    return;
  }
  ThrowKeystore(isolate, rc);
}

// set(service, account, value) -> undefined.
void Set(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Utf8Value service(isolate, args[0]);
  Utf8Value account(isolate, args[1]);
  Utf8Value value(isolate, args[2]);
  int rc = keystore_put(*service, *account, *value);
  if (rc != KEYSTORE_OK) {
    ThrowKeystore(isolate, rc);
  }
}

// del(service, account) -> undefined. Idempotent.
void Delete(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Utf8Value service(isolate, args[0]);
  Utf8Value account(isolate, args[1]);
  int rc = keystore_delete(*service, *account);
  if (rc != KEYSTORE_OK) {
    ThrowKeystore(isolate, rc);
  }
}

}  // namespace

static void Initialize(Local<Object> target, Local<Value> unused,
                       Local<Context> context, void* priv) {
  SetMethod(context, target, "get", Get);
  SetMethod(context, target, "set", Set);
  SetMethod(context, target, "del", Delete);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(Get);
  registry->Register(Set);
  registry->Register(Delete);
}

}  // namespace keychain
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_keychain, node::socketsecurity::keychain::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_keychain, node::socketsecurity::keychain::RegisterExternalReferences)
