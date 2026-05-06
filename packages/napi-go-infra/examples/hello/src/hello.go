// Package main is the napi-go hello reference binding. It exercises
// the framework's core surface: synchronous function export, string
// marshaling, error propagation, and a wrapped Go object.
//
// This package's build output is lib/<platform-arch>/hello.node inside
// napi-go. It is not published; it exists as a smoke test.
package main

/*
#include <node_api.h>
*/
import "C"

import (
	"fmt"
	"strings"
	"unsafe"

	napi "napi-go"
)

func main() {}

// greetingBuilder is a trivial stateful Go object wrapped onto a JS
// object so the framework's handle / Unwrap path is exercised.
type greetingBuilder struct {
	prefix string
	count  int
}

// NapiGoInit is the single Go entry point the C shim forwards to from
// NAPI_MODULE_INIT. Each exported function is registered on `exports`.
//
//export NapiGoInit
func NapiGoInit(env C.napi_env, rawExports C.napi_value) C.napi_value {
	e, exports := napi.FromRaw(unsafe.Pointer(env), unsafe.Pointer(rawExports))

	funcs := map[string]napi.Callback{
		"uppercase":  uppercase,
		"add":        add,
		"echoObject": echoObject,
		"newBuilder": newBuilder,
		"buildNext":  buildNext,
	}
	for name, fn := range funcs {
		if err := e.Export(exports, name, fn); err != nil {
			_ = e.Throw(fmt.Sprintf("napi-go-hello: Export(%s) failed: %v", name, err))
			return rawExports
		}
	}
	return rawExports
}

// uppercase returns its first argument uppercased.
func uppercase(args napi.Args) (napi.Value, error) {
	if args.Len() < 1 {
		return napi.Value{}, fmt.Errorf("uppercase: expected 1 argument, got %d", args.Len())
	}
	s, err := args.Get(0).AsString()
	if err != nil {
		return napi.Value{}, err
	}
	return args.Env().String(strings.ToUpper(s))
}

// add returns the sum of its two numeric arguments (int64).
func add(args napi.Args) (napi.Value, error) {
	if args.Len() < 2 {
		return napi.Value{}, fmt.Errorf("add: expected 2 arguments, got %d", args.Len())
	}
	a, err := args.Get(0).AsInt64()
	if err != nil {
		return napi.Value{}, err
	}
	b, err := args.Get(1).AsInt64()
	if err != nil {
		return napi.Value{}, err
	}
	return args.Env().Int64(a + b)
}

// echoObject reads { name, n } and returns { greeting, doubled }.
func echoObject(args napi.Args) (napi.Value, error) {
	if args.Len() < 1 {
		return napi.Value{}, fmt.Errorf("echoObject: expected 1 argument")
	}
	obj := args.Get(0)

	nameVal, err := obj.GetProperty("name")
	if err != nil {
		return napi.Value{}, err
	}
	name, err := nameVal.AsString()
	if err != nil {
		return napi.Value{}, err
	}

	nVal, err := obj.GetProperty("n")
	if err != nil {
		return napi.Value{}, err
	}
	n, err := nVal.AsInt64()
	if err != nil {
		return napi.Value{}, err
	}

	env := args.Env()
	out, err := env.Object()
	if err != nil {
		return napi.Value{}, err
	}
	greeting, err := env.String("hello, " + name)
	if err != nil {
		return napi.Value{}, err
	}
	if err := out.SetProperty("greeting", greeting); err != nil {
		return napi.Value{}, err
	}
	doubled, err := env.Int64(n * 2)
	if err != nil {
		return napi.Value{}, err
	}
	if err := out.SetProperty("doubled", doubled); err != nil {
		return napi.Value{}, err
	}
	return out, nil
}

// newBuilder creates a JS object wrapping a greetingBuilder. JS code
// passes the returned object to buildNext repeatedly; each call
// increments an internal counter held on the Go side.
func newBuilder(args napi.Args) (napi.Value, error) {
	if args.Len() < 1 {
		return napi.Value{}, fmt.Errorf("newBuilder: expected 1 argument (prefix)")
	}
	prefix, err := args.Get(0).AsString()
	if err != nil {
		return napi.Value{}, err
	}

	env := args.Env()
	obj, err := env.Object()
	if err != nil {
		return napi.Value{}, err
	}
	b := &greetingBuilder{prefix: prefix}
	if err := env.Wrap(obj, b); err != nil {
		return napi.Value{}, err
	}
	return obj, nil
}

// buildNext takes a greetingBuilder object and returns a greeting
// string with an incrementing counter.
func buildNext(args napi.Args) (napi.Value, error) {
	if args.Len() < 1 {
		return napi.Value{}, fmt.Errorf("buildNext: expected 1 argument (builder)")
	}
	b, err := napi.Unwrap[*greetingBuilder](args.Get(0))
	if err != nil {
		return napi.Value{}, err
	}
	b.count++
	return args.Env().String(fmt.Sprintf("%s #%d", b.prefix, b.count))
}
