package napi

/*
#include <node_api.h>
#include <stdlib.h>

#include "../include/napi_go.h"
*/
import "C"

import (
	"sync"
	"sync/atomic"
	"unsafe"
)

// Callback is the signature of a Go function exported to JS through
// Env.Export. The implementation inspects the Args for arguments and
// returns a Value or an error. Returning an error converts to a JS
// exception on the way out.
type Callback func(args Args) (Value, error)

// Args is passed to every Go callback. It exposes the calling env,
// the JS `this` value, and positional arguments.
type Args struct {
	env  Env
	this Value
	argv []Value
}

// Env returns the environment associated with this call.
func (a Args) Env() Env { return a.env }

// This returns the JS `this` value for this call.
func (a Args) This() Value { return a.this }

// Len returns the number of arguments JS passed.
func (a Args) Len() int { return len(a.argv) }

// Get returns the i'th argument. Calling Get with an out-of-range
// index returns an undefined Value — callers should Len-check first.
func (a Args) Get(i int) Value {
	if i < 0 || i >= len(a.argv) {
		u, _ := a.env.Undefined()
		return u
	}
	return a.argv[i]
}

// callbackRegistry holds the Go-side map from function ID (passed
// through N-API's `data` slot) to the Callback. Using an atomic
// counter + a sync.RWMutex-guarded map avoids the allocation pressure
// of cgo.Handle for a long-lived registration that never frees.
var (
	callbackMu      sync.RWMutex
	callbackCounter atomic.Uintptr
	callbacks       = map[uintptr]Callback{}
)

func registerCallback(cb Callback) uintptr {
	id := callbackCounter.Add(1)
	callbackMu.Lock()
	callbacks[id] = cb
	callbackMu.Unlock()
	return id
}

func lookupCallback(id uintptr) (Callback, bool) {
	callbackMu.RLock()
	cb, ok := callbacks[id]
	callbackMu.RUnlock()
	return cb, ok
}

// Export attaches a Go Callback to the given exports object under name.
// The callback lives for the lifetime of the process; napi-go does not
// currently support unregistering exports (Node addons rarely need to).
func (e Env) Export(exports Value, name string, cb Callback) error {
	id := registerCallback(cb)
	cname := C.CString(name)
	defer C.free(unsafe.Pointer(cname))

	var fn C.napi_value
	status := C.napi_create_function(
		e.raw,
		cname,
		C.size_t(len(name)),
		(*[0]byte)(C.napi_go_trampoline),
		unsafe.Pointer(id),
		&fn,
	)
	if err := e.checkStatus(status, "create_function"); err != nil {
		return err
	}
	status = C.napi_set_named_property(e.raw, exports.raw, cname, fn)
	return e.checkStatus(status, "set_named_property")
}

// goInvokeCallback is called from the C trampoline. It looks up the
// registered callback and invokes it with the parsed arguments.
//
//export napi_go_invoke
func napi_go_invoke(env C.napi_env, info C.napi_callback_info, id C.uintptr_t) C.napi_value {
	e := newEnv(env)

	// First pass: discover argc.
	var argc C.size_t
	status := C.napi_get_cb_info(env, info, &argc, nil, nil, nil)
	if err := e.checkStatus(status, "get_cb_info/argc"); err != nil {
		_ = e.Throw(err.Error())
		return nil
	}

	// Second pass: populate argv, this.
	var thisRaw C.napi_value
	var argv []C.napi_value
	if argc > 0 {
		argv = make([]C.napi_value, argc)
	}
	var argvPtr *C.napi_value
	if len(argv) > 0 {
		argvPtr = &argv[0]
	}
	status = C.napi_get_cb_info(env, info, &argc, argvPtr, &thisRaw, nil)
	if err := e.checkStatus(status, "get_cb_info/argv"); err != nil {
		_ = e.Throw(err.Error())
		return nil
	}

	// Wrap args.
	wrapped := make([]Value, len(argv))
	for i, a := range argv {
		wrapped[i] = newValue(e, a)
	}
	args := Args{env: e, this: newValue(e, thisRaw), argv: wrapped}

	cb, ok := lookupCallback(uintptr(id))
	if !ok {
		_ = e.Throw("napi-go: callback not registered (id mismatch)")
		return nil
	}

	// Recover from panics — convert to JS exception rather than crash
	// the process. Consumers that want a process-killing crash should
	// re-panic from inside their callback.
	var result Value
	var cbErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				cbErr = &panicError{value: r}
			}
		}()
		result, cbErr = cb(args)
	}()

	if cbErr != nil {
		_ = e.Throw(cbErr.Error())
		return nil
	}
	return result.raw
}

// panicError wraps a recovered panic so it flows through the normal
// error path.
type panicError struct {
	value interface{}
}

func (p *panicError) Error() string {
	return formatPanic(p.value)
}

func formatPanic(v interface{}) string {
	if err, ok := v.(error); ok {
		return "napi-go: panic: " + err.Error()
	}
	if s, ok := v.(string); ok {
		return "napi-go: panic: " + s
	}
	return "napi-go: panic (non-string, non-error)"
}
