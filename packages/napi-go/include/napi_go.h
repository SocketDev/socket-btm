/*
 * napi-go — Go → Node.js N-API framework.
 *
 * Public C header included by downstream builders' shim code.
 *
 * A downstream binding consists of:
 *   1. Go code that imports napi-go and exports //export NapiGoInit.
 *   2. A small C shim (see examples/hello/src/shim.c) that registers
 *      NAPI_MODULE_INIT and calls NapiGoInit.
 *   3. A build step that compiles Go as a c-archive and links the shim
 *      against it and Node's N-API symbols.
 *
 * All values and errors are exchanged as napi_value / napi_status
 * through N-API. This header only declares the trampoline type used
 * by napi-go's generic function-dispatch path.
 */

#ifndef NAPI_GO_H
#define NAPI_GO_H

#include <node_api.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * napi_go_trampoline is the shared N-API callback body used for every
 * function exported through napi-go's `Export`. The trampoline extracts
 * the handle ID stashed in the callback's `data` slot and hands control
 * back to Go via the exported `napi_go_invoke` symbol.
 *
 * Downstream consumers do not call this directly.
 */
napi_value napi_go_trampoline(napi_env env, napi_callback_info info);

/*
 * napi_go_finalizer is the shared finalizer used for every Go-owned
 * handle wrapped onto a JS object through `Env.Wrap`. When V8 collects
 * the JS object, the finalizer hands the handle ID back to Go so the
 * underlying Go value can be released from napi-go's handle table.
 */
void napi_go_finalizer(napi_env env, void* data, void* hint);

#ifdef __cplusplus
}
#endif

#endif /* NAPI_GO_H */
