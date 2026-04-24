/*
 * ultraviolet-node C shim.
 *
 * NAPI_MODULE_INIT forwards to the Go-exported NapiGoInit, which
 * registers every callback on exports via napi-go's Env.Export.
 */

#include <node_api.h>

#include "../../napi-go/include/napi_go.h"

extern napi_value NapiGoInit(napi_env env, napi_value exports);

NAPI_MODULE_INIT() {
  return NapiGoInit(env, exports);
}
