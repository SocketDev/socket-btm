package napi

/*
#include <node_api.h>
#include <stdlib.h>

#include "../include/napi_go.h"
*/
import "C"

import (
	"fmt"
	"sync"
	"sync/atomic"
	"unsafe"
)

// Handle tracking: each Env.Wrap call allocates an integer ID and
// stores the Go value under that ID. napi_wrap attaches a native
// pointer (the ID cast to void*) plus napi_go_finalizer to the JS
// object. When V8 GCs the JS object, the finalizer calls
// napi_go_release, which drops the entry.

var (
	handleMu      sync.RWMutex
	handleCounter atomic.Uintptr
	handleTable   = map[uintptr]interface{}{}
)

func allocHandle(v interface{}) uintptr {
	id := handleCounter.Add(1)
	handleMu.Lock()
	handleTable[id] = v
	handleMu.Unlock()
	return id
}

func lookupHandle(id uintptr) (interface{}, bool) {
	handleMu.RLock()
	v, ok := handleTable[id]
	handleMu.RUnlock()
	return v, ok
}

func releaseHandle(id uintptr) {
	handleMu.Lock()
	delete(handleTable, id)
	handleMu.Unlock()
}

// Wrap associates a Go value with a JS object. The JS object takes
// ownership for lifetime purposes: when it's collected, the Go value
// is dropped from napi-go's handle table and becomes eligible for
// garbage collection on the Go side (if no other references hold it).
//
// Recover the Go value from a JS object with Unwrap.
func (e Env) Wrap(obj Value, v interface{}) error {
	id := allocHandle(v)
	status := C.napi_wrap(
		e.raw,
		obj.raw,
		unsafe.Pointer(id),
		(*[0]byte)(C.napi_go_finalizer),
		nil,
		nil,
	)
	if err := e.checkStatus(status, "wrap"); err != nil {
		releaseHandle(id)
		return err
	}
	return nil
}

// Unwrap recovers the Go value previously associated with a JS object
// through Env.Wrap, asserting it to the concrete type T. Returns an
// error if the object was not wrapped by napi-go or if the held value
// is not assignable to T.
func Unwrap[T any](v Value) (T, error) {
	var zero T
	var ptr unsafe.Pointer
	status := C.napi_unwrap(v.env.raw, v.raw, &ptr)
	if err := v.env.checkStatus(status, "unwrap"); err != nil {
		return zero, err
	}
	if ptr == nil {
		return zero, &Error{Op: "unwrap", Status: -1, Msg: "object is not wrapped"}
	}
	id := uintptr(ptr)
	held, ok := lookupHandle(id)
	if !ok {
		return zero, &Error{Op: "unwrap", Status: -1, Msg: fmt.Sprintf("handle %d not registered", id)}
	}
	typed, ok := held.(T)
	if !ok {
		return zero, &Error{Op: "unwrap", Status: -1, Msg: fmt.Sprintf("wrapped value is %T, not expected type", held)}
	}
	return typed, nil
}

// goReleaseHandle is called from the C finalizer when V8 collects a
// wrapped JS object.
//
//export napi_go_release
func napi_go_release(id C.uintptr_t) {
	releaseHandle(uintptr(id))
}
