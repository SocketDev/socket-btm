package napi

/*
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
*/
import "C"

import (
	"unsafe"
)

// String creates a JS string from a UTF-8 Go string.
func (e Env) String(s string) (Value, error) {
	var out C.napi_value
	// napi_create_string_utf8 copies the buffer, so a Go-allocated
	// CString that we free immediately is fine.
	cstr := C.CString(s)
	defer C.free(unsafe.Pointer(cstr))
	status := C.napi_create_string_utf8(e.raw, cstr, C.size_t(len(s)), &out)
	if err := e.checkStatus(status, "create_string_utf8"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Int64 creates a JS number (stored as double internally — values
// outside ±2^53 lose precision).
func (e Env) Int64(n int64) (Value, error) {
	var out C.napi_value
	status := C.napi_create_int64(e.raw, C.int64_t(n), &out)
	if err := e.checkStatus(status, "create_int64"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Float64 creates a JS number from a float64.
func (e Env) Float64(n float64) (Value, error) {
	var out C.napi_value
	status := C.napi_create_double(e.raw, C.double(n), &out)
	if err := e.checkStatus(status, "create_double"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Bool creates a JS boolean.
func (e Env) Bool(b bool) (Value, error) {
	var out C.napi_value
	bv := C.bool(false)
	if b {
		bv = C.bool(true)
	}
	status := C.napi_get_boolean(e.raw, bv, &out)
	if err := e.checkStatus(status, "get_boolean"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Null returns the JS null value.
func (e Env) Null() (Value, error) {
	var out C.napi_value
	status := C.napi_get_null(e.raw, &out)
	if err := e.checkStatus(status, "get_null"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Undefined returns the JS undefined value.
func (e Env) Undefined() (Value, error) {
	var out C.napi_value
	status := C.napi_get_undefined(e.raw, &out)
	if err := e.checkStatus(status, "get_undefined"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Object creates an empty JS object.
func (e Env) Object() (Value, error) {
	var out C.napi_value
	status := C.napi_create_object(e.raw, &out)
	if err := e.checkStatus(status, "create_object"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Array creates an empty JS array of the given length.
func (e Env) Array(length int) (Value, error) {
	var out C.napi_value
	status := C.napi_create_array_with_length(e.raw, C.size_t(length), &out)
	if err := e.checkStatus(status, "create_array_with_length"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// Buffer creates a Node.js Buffer by copying the given bytes. The
// returned Buffer is independent of the input slice; the caller may
// reuse or free the slice immediately.
func (e Env) Buffer(b []byte) (Value, error) {
	var out C.napi_value
	// napi_create_buffer_copy copies; we don't need to pin the slice.
	var src unsafe.Pointer
	if len(b) > 0 {
		src = unsafe.Pointer(&b[0])
	}
	status := C.napi_create_buffer_copy(e.raw, C.size_t(len(b)), src, nil, &out)
	if err := e.checkStatus(status, "create_buffer_copy"); err != nil {
		return Value{}, err
	}
	return newValue(e, out), nil
}

// AsString extracts a UTF-8 Go string from a JS value. Fails if the
// value is not a string.
func (v Value) AsString() (string, error) {
	// Two-call pattern: first call with nil buffer to get length.
	var size C.size_t
	status := C.napi_get_value_string_utf8(v.env.raw, v.raw, nil, 0, &size)
	if err := v.env.checkStatus(status, "get_value_string_utf8/size"); err != nil {
		return "", err
	}
	if size == 0 {
		return "", nil
	}
	// Allocate a buffer of size+1 for the null terminator N-API writes.
	buf := C.malloc(size + 1)
	if buf == nil {
		return "", &Error{Op: "malloc", Status: -1, Msg: "out of memory"}
	}
	defer C.free(buf)
	var written C.size_t
	status = C.napi_get_value_string_utf8(v.env.raw, v.raw, (*C.char)(buf), size+1, &written)
	if err := v.env.checkStatus(status, "get_value_string_utf8/copy"); err != nil {
		return "", err
	}
	return C.GoStringN((*C.char)(buf), C.int(written)), nil
}

// AsInt64 extracts an int64 from a JS number.
func (v Value) AsInt64() (int64, error) {
	var out C.int64_t
	status := C.napi_get_value_int64(v.env.raw, v.raw, &out)
	if err := v.env.checkStatus(status, "get_value_int64"); err != nil {
		return 0, err
	}
	return int64(out), nil
}

// AsFloat64 extracts a float64 from a JS number.
func (v Value) AsFloat64() (float64, error) {
	var out C.double
	status := C.napi_get_value_double(v.env.raw, v.raw, &out)
	if err := v.env.checkStatus(status, "get_value_double"); err != nil {
		return 0, err
	}
	return float64(out), nil
}

// AsBool extracts a bool from a JS boolean.
func (v Value) AsBool() (bool, error) {
	var out C.bool
	status := C.napi_get_value_bool(v.env.raw, v.raw, &out)
	if err := v.env.checkStatus(status, "get_value_bool"); err != nil {
		return false, err
	}
	return bool(out), nil
}

// AsBuffer returns a Go slice backed by the JS Buffer's underlying
// memory. The slice is valid only for the lifetime of the current
// N-API callback. Callers MUST copy out anything they need to retain.
func (v Value) AsBuffer() ([]byte, error) {
	var data unsafe.Pointer
	var length C.size_t
	status := C.napi_get_buffer_info(v.env.raw, v.raw, &data, &length)
	if err := v.env.checkStatus(status, "get_buffer_info"); err != nil {
		return nil, err
	}
	if data == nil || length == 0 {
		return nil, nil
	}
	// Construct a Go slice header that aliases the V8 buffer. Do NOT
	// append to this or hold it past the callback's return.
	return unsafe.Slice((*byte)(data), int(length)), nil
}

// SetProperty sets a named property on an object.
func (v Value) SetProperty(key string, val Value) error {
	ckey := C.CString(key)
	defer C.free(unsafe.Pointer(ckey))
	var keyVal C.napi_value
	status := C.napi_create_string_utf8(v.env.raw, ckey, C.size_t(len(key)), &keyVal)
	if err := v.env.checkStatus(status, "create_string_utf8/key"); err != nil {
		return err
	}
	status = C.napi_set_property(v.env.raw, v.raw, keyVal, val.raw)
	return v.env.checkStatus(status, "set_property")
}

// GetProperty reads a named property from an object.
func (v Value) GetProperty(key string) (Value, error) {
	ckey := C.CString(key)
	defer C.free(unsafe.Pointer(ckey))
	var keyVal C.napi_value
	status := C.napi_create_string_utf8(v.env.raw, ckey, C.size_t(len(key)), &keyVal)
	if err := v.env.checkStatus(status, "create_string_utf8/key"); err != nil {
		return Value{}, err
	}
	var out C.napi_value
	status = C.napi_get_property(v.env.raw, v.raw, keyVal, &out)
	if err := v.env.checkStatus(status, "get_property"); err != nil {
		return Value{}, err
	}
	return newValue(v.env, out), nil
}

// SetElement sets an array element by index.
func (v Value) SetElement(index uint32, val Value) error {
	status := C.napi_set_element(v.env.raw, v.raw, C.uint32_t(index), val.raw)
	return v.env.checkStatus(status, "set_element")
}

// GetElement reads an array element by index.
func (v Value) GetElement(index uint32) (Value, error) {
	var out C.napi_value
	status := C.napi_get_element(v.env.raw, v.raw, C.uint32_t(index), &out)
	if err := v.env.checkStatus(status, "get_element"); err != nil {
		return Value{}, err
	}
	return newValue(v.env, out), nil
}
