// Package main is the ultraviolet-builder binding. It exposes a thin
// N-API surface over Charmbracelet Ultraviolet's EventDecoder: you
// feed raw bytes and receive typed JS events matching the Go Event
// interface's concrete cases.
//
// Surface:
//
//	newDecoder()              -> Decoder handle
//	decode(decoder, bytes)    -> Event[] (Event is a discriminated
//	                              union keyed on `type`)
//
// The Decoder handle is a JS object wrapping a *uv.EventDecoder on
// the Go side; lifetime is tied to the JS object's GC.
package main

/*
#include <node_api.h>
*/
import "C"

import (
	"fmt"
	"unsafe"

	uv "github.com/charmbracelet/ultraviolet"
	napi "napi-go"
)

func main() {}

// NapiGoInit is the single exported entry. Registers every public
// function on `exports` and returns it.
//
//export NapiGoInit
func NapiGoInit(env C.napi_env, rawExports C.napi_value) C.napi_value {
	e, exports := napi.FromRaw(unsafe.Pointer(env), unsafe.Pointer(rawExports))

	funcs := map[string]napi.Callback{
		"newDecoder": newDecoder,
		"decode":     decode,
	}
	for name, fn := range funcs {
		if err := e.Export(exports, name, fn); err != nil {
			_ = e.Throw(fmt.Sprintf("ultraviolet: Export(%s) failed: %v", name, err))
			return rawExports
		}
	}
	return rawExports
}

// newDecoder allocates a fresh EventDecoder and returns an opaque JS
// handle wrapping it. Pass the handle to decode() to feed bytes.
func newDecoder(args napi.Args) (napi.Value, error) {
	env := args.Env()
	obj, err := env.Object()
	if err != nil {
		return napi.Value{}, err
	}
	dec := &uv.EventDecoder{}
	if err := env.Wrap(obj, dec); err != nil {
		return napi.Value{}, err
	}
	return obj, nil
}

// decode feeds the given Buffer to the decoder and returns an array of
// parsed events. Unconsumed trailing bytes are discarded by this
// minimal surface — a later revision will expose the leftover length
// so callers can accumulate partial escape sequences across reads.
func decode(args napi.Args) (napi.Value, error) {
	if args.Len() < 2 {
		return napi.Value{}, fmt.Errorf("decode: expected (decoder, bytes)")
	}
	dec, err := napi.Unwrap[*uv.EventDecoder](args.Get(0))
	if err != nil {
		return napi.Value{}, err
	}
	raw, err := args.Get(1).AsBuffer()
	if err != nil {
		return napi.Value{}, err
	}
	// AsBuffer returns a slice aliasing V8-owned memory; copy before
	// decoding so the decoder's lifetime is not tied to this callback.
	// EventDecoder.Decode does not itself retain the buffer, but
	// future calls producing pasted payloads may, so a copy keeps the
	// contract unambiguous.
	buf := make([]byte, len(raw))
	copy(buf, raw)

	env := args.Env()
	events := []uv.Event{}
	for len(buf) > 0 {
		n, ev := dec.Decode(buf)
		if n <= 0 {
			// Partial / undecodable sequence — stop and drop remainder.
			break
		}
		if ev != nil {
			// MultiEvent is a slice of events emitted by a single
			// escape sequence (e.g. paste chunks); flatten.
			if multi, ok := ev.(uv.MultiEvent); ok {
				for _, sub := range multi {
					events = append(events, sub)
				}
			} else {
				events = append(events, ev)
			}
		}
		buf = buf[n:]
	}

	arr, err := env.Array(len(events))
	if err != nil {
		return napi.Value{}, err
	}
	for i, ev := range events {
		v, err := eventToValue(env, ev)
		if err != nil {
			return napi.Value{}, err
		}
		if err := arr.SetElement(uint32(i), v); err != nil {
			return napi.Value{}, err
		}
	}
	return arr, nil
}

// eventToValue marshals an ultraviolet Event to a JS object. The
// resulting object has a `type` discriminator and type-specific
// fields. Unknown event types get `{ type: 'Unknown', go: "<type>" }`
// so the shape is uniform.
func eventToValue(env napi.Env, ev uv.Event) (napi.Value, error) {
	switch e := ev.(type) {
	case uv.KeyPressEvent:
		return keyToValue(env, "KeyPress", uv.Key(e))
	case uv.KeyReleaseEvent:
		return keyToValue(env, "KeyRelease", uv.Key(e))
	case uv.MouseClickEvent:
		return mouseToValue(env, "MouseClick", uv.Mouse(e))
	case uv.MouseReleaseEvent:
		return mouseToValue(env, "MouseRelease", uv.Mouse(e))
	case uv.MouseWheelEvent:
		return mouseToValue(env, "MouseWheel", uv.Mouse(e))
	case uv.MouseMotionEvent:
		return mouseToValue(env, "MouseMotion", uv.Mouse(e))
	case uv.WindowSizeEvent:
		return sizeToValue(env, "WindowSize", uv.Size(e))
	case uv.PasteStartEvent:
		return taggedEmpty(env, "PasteStart")
	case uv.PasteEndEvent:
		return taggedEmpty(env, "PasteEnd")
	case uv.PasteEvent:
		obj, err := taggedEmpty(env, "Paste")
		if err != nil {
			return napi.Value{}, err
		}
		text, err := env.String(e.Content)
		if err != nil {
			return napi.Value{}, err
		}
		if err := obj.SetProperty("text", text); err != nil {
			return napi.Value{}, err
		}
		return obj, nil
	case uv.FocusEvent:
		return taggedEmpty(env, "Focus")
	case uv.BlurEvent:
		return taggedEmpty(env, "Blur")
	case uv.UnknownEvent:
		obj, err := taggedEmpty(env, "Unknown")
		if err != nil {
			return napi.Value{}, err
		}
		text, err := env.String(string(e))
		if err != nil {
			return napi.Value{}, err
		}
		if err := obj.SetProperty("raw", text); err != nil {
			return napi.Value{}, err
		}
		return obj, nil
	default:
		// Unknown concrete type — expose the Go type name so JS can
		// fall back to raw inspection.
		obj, err := taggedEmpty(env, "Unhandled")
		if err != nil {
			return napi.Value{}, err
		}
		name, err := env.String(fmt.Sprintf("%T", ev))
		if err != nil {
			return napi.Value{}, err
		}
		if err := obj.SetProperty("go", name); err != nil {
			return napi.Value{}, err
		}
		return obj, nil
	}
}

// keyToValue builds a {type, code, mod, text, isRepeat} object.
func keyToValue(env napi.Env, tag string, k uv.Key) (napi.Value, error) {
	obj, err := taggedEmpty(env, tag)
	if err != nil {
		return napi.Value{}, err
	}
	code, err := env.Int64(int64(k.Code))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("code", code); err != nil {
		return napi.Value{}, err
	}
	mod, err := env.Int64(int64(k.Mod))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("mod", mod); err != nil {
		return napi.Value{}, err
	}
	text, err := env.String(k.Text)
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("text", text); err != nil {
		return napi.Value{}, err
	}
	isRepeat, err := env.Bool(k.IsRepeat)
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("isRepeat", isRepeat); err != nil {
		return napi.Value{}, err
	}
	return obj, nil
}

// mouseToValue builds a {type, x, y, button, mod} object.
func mouseToValue(env napi.Env, tag string, m uv.Mouse) (napi.Value, error) {
	obj, err := taggedEmpty(env, tag)
	if err != nil {
		return napi.Value{}, err
	}
	x, err := env.Int64(int64(m.X))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("x", x); err != nil {
		return napi.Value{}, err
	}
	y, err := env.Int64(int64(m.Y))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("y", y); err != nil {
		return napi.Value{}, err
	}
	button, err := env.Int64(int64(m.Button))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("button", button); err != nil {
		return napi.Value{}, err
	}
	mod, err := env.Int64(int64(m.Mod))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("mod", mod); err != nil {
		return napi.Value{}, err
	}
	return obj, nil
}

// sizeToValue builds a {type, width, height} object.
func sizeToValue(env napi.Env, tag string, s uv.Size) (napi.Value, error) {
	obj, err := taggedEmpty(env, tag)
	if err != nil {
		return napi.Value{}, err
	}
	w, err := env.Int64(int64(s.Width))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("width", w); err != nil {
		return napi.Value{}, err
	}
	h, err := env.Int64(int64(s.Height))
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("height", h); err != nil {
		return napi.Value{}, err
	}
	return obj, nil
}

// taggedEmpty returns { type: tag }.
func taggedEmpty(env napi.Env, tag string) (napi.Value, error) {
	obj, err := env.Object()
	if err != nil {
		return napi.Value{}, err
	}
	t, err := env.String(tag)
	if err != nil {
		return napi.Value{}, err
	}
	if err := obj.SetProperty("type", t); err != nil {
		return napi.Value{}, err
	}
	return obj, nil
}
