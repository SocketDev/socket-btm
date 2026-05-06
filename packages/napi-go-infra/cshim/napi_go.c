/*
 * napi-go C shim.
 *
 * Implements the two shared C entry points declared in
 * include/napi_go.h:
 *   napi_go_trampoline  — the shared function-callback body invoked
 *                         for every Go function exported via
 *                         Env.Export. Recovers the Go-side callback ID
 *                         stored in N-API's data slot and hands off to
 *                         Go.
 *   napi_go_finalizer   — the shared finalizer invoked when V8
 *                         collects a wrapped JS object, so Go can
 *                         release its handle table entry.
 *
 * The Go symbols napi_go_invoke and napi_go_release are defined in the
 * Go package (function.go, handle.go) and linked in by the c-archive
 * produced from `go build -buildmode=c-archive`.
 */

#include "../include/napi_go.h"

#include <stdint.h>
#include <stddef.h>

/* Go exports — defined in the linked c-archive. */
extern napi_value napi_go_invoke(napi_env env, napi_callback_info info, uintptr_t id);
extern void napi_go_release(uintptr_t id);

napi_value napi_go_trampoline(napi_env env, napi_callback_info info) {
  void* data = NULL;
  size_t argc = 0;
  /*
   * We call napi_get_cb_info once here with a null argv to recover
   * only the `data` slot (the uintptr-cast callback ID). The Go side
   * does its own napi_get_cb_info call to pull argv/this. Two calls
   * are the cheapest way to keep the C layer ignorant of function
   * arity — a generic trampoline would otherwise need a variadic
   * stub. The first call is o(1) and does not copy argv.
   */
  if (napi_get_cb_info(env, info, &argc, NULL, NULL, &data) != napi_ok) {
    return NULL;
  }
  return napi_go_invoke(env, info, (uintptr_t)data);
}

void napi_go_finalizer(napi_env env, void* data, void* hint) {
  (void)env;
  (void)hint;
  napi_go_release((uintptr_t)data);
}
