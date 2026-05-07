// Package napi is the Go-side core of napi-go: a thin, type-safe wrapper
// around Node.js's N-API. Downstream bindings import this package,
// declare exported functions, and register them through Env.Export.
//
// N-API concepts — env, value, callback info — are reflected as Go
// types (Env, Value, Args). Marshaling between Go primitives and JS
// values is done through value.go; function exports go through
// function.go; Go-owned handles reachable through JS objects are
// managed in handle.go.
//
// This file declares the shared cgo preamble and common helpers.
package napi

/*
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
*/
import "C"

// Env wraps a napi_env. An Env is valid only for the duration of the
// N-API callback that produced it; storing an Env across async
// boundaries is undefined behavior in N-API and napi-go does not
// permit it.
type Env struct {
	raw C.napi_env
}

// Raw returns the underlying napi_env. Intended for framework-internal
// use and for consumers writing their own cgo code; ordinary bindings
// should not need it.
func (e Env) Raw() C.napi_env { return e.raw }

// Value wraps a napi_value. Values are bound to the Env they were
// created in. Passing a Value to a different Env is undefined behavior.
type Value struct {
	env Env
	raw C.napi_value
}

// Raw returns the underlying napi_value.
func (v Value) Raw() C.napi_value { return v.raw }

// Env returns the environment this value belongs to.
func (v Value) Env() Env { return v.env }

// newValue wraps a raw napi_value together with its env.
func newValue(env Env, raw C.napi_value) Value {
	return Value{env: env, raw: raw}
}

// newEnv wraps a raw napi_env.
func newEnv(raw C.napi_env) Env {
	return Env{raw: raw}
}

// checkStatus turns a non-ok napi_status into a Go error with the
// associated extended error info, if any is available.
func (e Env) checkStatus(status C.napi_status, op string) error {
	if status == C.napi_ok {
		return nil
	}
	var info *C.napi_extended_error_info
	if C.napi_get_last_error_info(e.raw, &info) == C.napi_ok && info != nil && info.error_message != nil {
		msg := C.GoString(info.error_message)
		return &Error{Op: op, Status: int(status), Msg: msg}
	}
	return &Error{Op: op, Status: int(status)}
}
