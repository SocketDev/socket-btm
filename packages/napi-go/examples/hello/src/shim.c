/*
 * napi-go-hello C shim.
 *
 * This is the minimum a downstream consumer needs: a single
 * NAPI_MODULE_INIT that forwards to the Go-exported NapiGoInit
 * function. Everything else — value marshaling, error handling, handle
 * tables — lives in the Go package.
 */

#include <node_api.h>

#include "../../../include/napi_go.h"

extern napi_value NapiGoInit(napi_env env, napi_value exports);

NAPI_MODULE_INIT() {
  return NapiGoInit(env, exports);
}
