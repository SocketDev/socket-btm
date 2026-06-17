package napi

/*
#include <node_api.h>
#include <stdlib.h>
*/
import "C"

import (
	"fmt"
	"unsafe"
)

// Error is returned when an N-API call fails. Op names the napi-go
// operation that failed; Status is the underlying napi_status value;
// Msg is the extended error info message, when N-API provided one.
type Error struct {
	Op     string
	Status int
	Msg    string
}

func (e *Error) Error() string {
	if e.Msg != "" {
		return fmt.Sprintf("napi-go %s: status=%d: %s", e.Op, e.Status, e.Msg)
	}
	return fmt.Sprintf("napi-go %s: status=%d", e.Op, e.Status)
}

// Throw throws a JS Error with the given message. The calling N-API
// callback should return a zero Value immediately after Throw returns
// non-nil; N-API will surface the pending exception to JS as the
// callback result.
func (e Env) Throw(message string) error {
	cmsg := C.CString(message)
	defer C.free(unsafe.Pointer(cmsg))
	return e.checkStatus(C.napi_throw_error(e.raw, nil, cmsg), "throw_error")
}

// ThrowTypeError throws a JS TypeError.
func (e Env) ThrowTypeError(message string) error {
	cmsg := C.CString(message)
	defer C.free(unsafe.Pointer(cmsg))
	return e.checkStatus(C.napi_throw_type_error(e.raw, nil, cmsg), "throw_type_error")
}

// ThrowRangeError throws a JS RangeError.
func (e Env) ThrowRangeError(message string) error {
	cmsg := C.CString(message)
	defer C.free(unsafe.Pointer(cmsg))
	return e.checkStatus(C.napi_throw_range_error(e.raw, nil, cmsg), "throw_range_error")
}
