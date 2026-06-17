/*
 * keychain_napi — N-API binding that exposes keystore-infra's get/put/delete to
 * JavaScript as a `.node` addon. This is the non-smol surface: regular Node
 * consumers `require('@socketaddon/keychain')` and call these. It compiles the
 * shared keystore-infra core (the same source the proteus daemon and the
 * node:smol-keychain builtin use), so all three surfaces share one
 * implementation.
 *
 * Pure C++ (N-API is a C ABI), so it compiles on every platform and links the
 * platform keystore backend the build script selects: keystore_macos.mm
 * (ObjC++, -fobjc-arc) on darwin, keystore_linux.c (libsecret) on linux,
 * keystore_win.c (Credential Manager) on win32. No Objective-C lives here — the
 * ObjC is confined to keystore_macos.mm — so this stays a `.cc`, not a `.mm`.
 */

#include <node_api.h>

#include <cstring>

#include "socketsecurity/keystore-infra/keystore.h"

namespace {

constexpr size_t kMaxField = 256;
constexpr size_t kMaxValue = 8192;

// Read a JS string argument into a fixed buffer. Returns false (and leaves a
// pending exception unset) when the arg isn't a usable string.
bool readStringArg(napi_env env, napi_value value, char* out, size_t cap) {
  size_t written = 0;
  return napi_get_value_string_utf8(env, value, out, cap, &written) == napi_ok;
}

// Map a non-OK keystore code to a thrown JS Error and return nullptr.
napi_value throwKeystore(napi_env env, int rc) {
  const char* code = rc == KEYSTORE_ERR_DENIED      ? "denied"
                     : rc == KEYSTORE_ERR_UNAVAILABLE ? "keystore-unavailable"
                                                      : "keystore-io";
  napi_throw_error(env, nullptr, code);
  return nullptr;
}

// get(service, account) -> string | undefined.
// Returns the secret on success, undefined when absent. A biometric-gated read
// raises the OS Touch ID prompt inside keystore_get. Throws on denial / error.
napi_value Get(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  char service[kMaxField];
  char account[kMaxField];
  if (argc < 2 || !readStringArg(env, argv[0], service, sizeof(service)) ||
      !readStringArg(env, argv[1], account, sizeof(account))) {
    napi_throw_type_error(env, nullptr, "get(service, account) needs two strings");
    return nullptr;
  }
  char value[kMaxValue];
  int rc = keystore_get(service, account, value, sizeof(value));
  napi_value result = nullptr;
  if (rc == KEYSTORE_OK) {
    napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
    std::memset(value, 0, sizeof(value));
    return result;
  }
  if (rc == KEYSTORE_ERR_NOT_FOUND) {
    napi_get_undefined(env, &result);
    return result;
  }
  return throwKeystore(env, rc);
}

// set(service, account, value) -> undefined. Stores behind the biometric ACL.
napi_value Set(napi_env env, napi_callback_info info) {
  size_t argc = 3;
  napi_value argv[3];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  char service[kMaxField];
  char account[kMaxField];
  char value[kMaxValue];
  if (argc < 3 || !readStringArg(env, argv[0], service, sizeof(service)) ||
      !readStringArg(env, argv[1], account, sizeof(account)) ||
      !readStringArg(env, argv[2], value, sizeof(value))) {
    napi_throw_type_error(env, nullptr,
                          "set(service, account, value) needs three strings");
    return nullptr;
  }
  int rc = keystore_put(service, account, value);
  std::memset(value, 0, sizeof(value));
  napi_value undef = nullptr;
  napi_get_undefined(env, &undef);
  return rc == KEYSTORE_OK ? undef : throwKeystore(env, rc);
}

// del(service, account) -> undefined. Idempotent (absent item is success).
napi_value Delete(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  char service[kMaxField];
  char account[kMaxField];
  if (argc < 2 || !readStringArg(env, argv[0], service, sizeof(service)) ||
      !readStringArg(env, argv[1], account, sizeof(account))) {
    napi_throw_type_error(env, nullptr, "del(service, account) needs two strings");
    return nullptr;
  }
  int rc = keystore_delete(service, account);
  napi_value undef = nullptr;
  napi_get_undefined(env, &undef);
  return rc == KEYSTORE_OK ? undef : throwKeystore(env, rc);
}

void define(napi_env env, napi_value exports, const char* name,
            napi_callback fn) {
  napi_value jsFn = nullptr;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, fn, nullptr, &jsFn);
  napi_set_named_property(env, exports, name, jsFn);
}

}  // namespace

NAPI_MODULE_INIT() {
  define(env, exports, "get", Get);
  define(env, exports, "set", Set);
  define(env, exports, "del", Delete);
  return exports;
}
