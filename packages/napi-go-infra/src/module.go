package napi

/*
#include <node_api.h>
*/
import "C"

import "unsafe"

// FromRaw wraps raw napi_env / napi_value pointers received from the
// consumer's cgo scope into napi-go's Env/Value types.
//
// Both values must be passed as unsafe.Pointer because cgo gives each
// Go package its own type identity for the same C typedef — a
// C.napi_env declared inside the consumer's package is not assignable
// to a C.napi_env declared inside napi-go's package, even though both
// are the same underlying pointer type.
//
// The idiomatic consumer entry is:
//
//	//export NapiGoInit
//	func NapiGoInit(env C.napi_env, exports C.napi_value) C.napi_value {
//	    e, out := napi.FromRaw(unsafe.Pointer(env), unsafe.Pointer(exports))
//	    _ = e.Export(out, "foo", fooCallback)
//	    return exports
//	}
func FromRaw(env unsafe.Pointer, val unsafe.Pointer) (Env, Value) {
	e := newEnv(C.napi_env(env))
	return e, newValue(e, C.napi_value(val))
}
