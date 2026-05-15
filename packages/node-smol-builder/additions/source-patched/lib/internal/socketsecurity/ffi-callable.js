'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/ffi-callable.js.md
//
// Library-free FFI surface — JSCallback, CFunction, linkSymbols, plus
// helpers shared between the canonical (`node:smol-ffi`) and bun-compat
// (`node:smol-ffi/bun`) surfaces. Split out of internal/socketsecurity/ffi.js
// to stay under the 1000-line hard cap.
//
// Sibling internal modules form a small dependency wedge:
//   internal/socketsecurity/ffi             — Library, open/dlopen, mem accessors
//   internal/socketsecurity/ffi-callable      — JSCallback, CFunction, linkSymbols
//
// This file imports `binding`, `FFIError`, `FFI_ERROR_CODES`,
// `validateType`, and `buildCallWrapper` from the main module so the
// dispatch path and error shape stay identical.

const {
  ArrayIsArray,
  ArrayPrototypePush,
  Number: NumberCtor,
  NumberMAX_SAFE_INTEGER,
  NumberMIN_SAFE_INTEGER,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectKeys,
  RangeError: RangeErrorCtor,
  TypeError: TypeErrorCtor,
} = primordials

const {
  binding,
  buildCallWrapper,
  FFIError,
  FFI_ERROR_CODES,
  validateType,
} = require('internal/socketsecurity/ffi')

// MIN/MAX safe BigInts mirroring Number.{MIN,MAX}_SAFE_INTEGER. Used by
// boundedToNumber() to decide whether a 64-bit integer fits losslessly in
// a JS Number. Precomputed at module load so the conversion path stays
// allocation-free on the hot path.
const NUMBER_MAX_SAFE_BIGINT = BigInt(NumberMAX_SAFE_INTEGER)
const NUMBER_MIN_SAFE_BIGINT = BigInt(NumberMIN_SAFE_INTEGER)

// Coerce a BigInt 64-bit integer to a JS Number, throwing if the value
// would lose precision (i.e. |v| > 2^53 - 1). Used to bridge bun's
// `i64_fast` / `u64_fast` semantics — those types return a Number, not
// a BigInt, as a perf escape hatch. We honor that by post-processing
// the BigInt-returning native path, but refuse to silently truncate
// values that exceed JS Number precision so callers don't end up with
// off-by-millions bugs.
function boundedToNumber(v) {
  if (typeof v !== 'bigint') {
    // Already a Number / something else — pass through. Callers should
    // only hit this with BigInt inputs, but the pass-through avoids
    // double-wrapping on the slow path.
    return v
  }
  if (v > NUMBER_MAX_SAFE_BIGINT || v < NUMBER_MIN_SAFE_BIGINT) {
    throw new RangeErrorCtor(
      `BigInt value ${v} does not fit in a JS Number without loss of ` +
        `precision (max safe integer = ${NumberMAX_SAFE_INTEGER}). Use ` +
        '`i64` / `u64` instead of `i64_fast` / `u64_fast` to receive a ' +
        'BigInt.',
    )
  }
  return NumberCtor(v)
}

// JSCallback — exposes a JS function as a native function pointer
// usable from C. Wraps the existing `registerCallback` / `unregisterCallback`
// native pair under a bun:ffi-shaped surface.
//
//   const cb = new JSCallback(fn, { args, returns, threadsafe? })
//   nativeFn(cb.ptr)
//   cb.close()
//
// `threadsafe` is accepted but the smol callback trampoline pool is
// already thread-aware (each slot tracks its owning thread; off-thread
// invocations no-op), so the flag is a documented no-op — the safer
// behavior is always on. Callers can pass `threadsafe: false` for
// signature parity with bun without altering behavior.
class JSCallback {
  #cbId
  #ptr
  #closed = false

  constructor(fn, options) {
    if (typeof fn !== 'function') {
      throw new TypeErrorCtor('JSCallback(fn, options): fn must be a function')
    }
    if (typeof options !== 'object' || options === null) {
      throw new FFIError(
        'JSCallback(fn, options): options must be an object with ' +
          '{ args, returns }',
        FFI_ERROR_CODES.EBADARGS,
      )
    }

    // bun uses `returns`; we also accept `result` for parity with the
    // canonical signature-object form.
    const returnType =
      options.returns !== undefined
        ? options.returns
        : options.result !== undefined
          ? options.result
          : 'void'
    const params =
      options.args !== undefined
        ? options.args
        : options.parameters !== undefined
          ? options.parameters
          : []

    validateType(returnType)
    if (!ArrayIsArray(params)) {
      throw new FFIError(
        'JSCallback: options.args must be an array of type strings',
        FFI_ERROR_CODES.EBADARGS,
      )
    }
    for (let i = 0; i < params.length; i++) {
      validateType(params[i])
    }

    // lib_id = 0 sentinel — the native binding treats 0 as "no library";
    // the callback is owned by FFIState alone and freed via close() or
    // thread teardown.
    const result = binding().registerCallback(0, returnType, params, fn)
    this.#cbId = result[0]
    this.#ptr = result[1]
  }

  get ptr() {
    return this.#ptr
  }

  get closed() {
    return this.#closed
  }

  close() {
    if (this.#closed) {
      return
    }
    this.#closed = true
    try {
      binding().unregisterCallback(this.#cbId)
    } catch {
      // Idempotent: a callback already torn down by FFIState teardown
      // races with explicit close(). The native side throws "Callback
      // not found" in that case; we swallow because the caller's intent
      // (release the resource) is satisfied either way.
    }
  }
}

// CFunction — bind a JS callable to a raw function pointer + signature.
// Used to call functions whose addresses are obtained outside the
// canonical library/dlsym path (e.g. callbacks registered into a
// sibling FFI library, function pointers stashed in a struct, or
// addresses returned from other native code).
//
//   const fn = CFunction({ ptr, returns, args })
//   fn(...)            // invoke
//   fn.close()         // release the slot
//
// On instances:
//   .ptr     — the raw BigInt pointer (mirror of the input)
//   .close() — releases the native function slot (idempotent)
//   .closed  — whether close() has been called
//
// CFunction is exported as a plain function (not a class). `new` is
// optional: both `new CFunction(def)` and `CFunction(def)` return the
// same callable. We can't use `class` here because the result must be
// a Function (class constructors can only return objects).
function CFunction(definition) {
  if (typeof definition !== 'object' || definition === null) {
    throw new FFIError(
      'CFunction(definition): definition must be an object with ' +
        '{ ptr, returns, args }',
      FFI_ERROR_CODES.EBADARGS,
    )
  }
  const ptr = definition.ptr
  if (typeof ptr !== 'bigint') {
    throw new FFIError(
      'CFunction: definition.ptr must be a BigInt',
      FFI_ERROR_CODES.EBADPTR,
    )
  }
  if (ptr === 0n) {
    throw new FFIError(
      'CFunction: definition.ptr must be a non-zero pointer',
      FFI_ERROR_CODES.EBADPTR,
    )
  }
  const returnType =
    definition.returns !== undefined
      ? definition.returns
      : definition.result !== undefined
        ? definition.result
        : 'void'
  const params =
    definition.args !== undefined
      ? definition.args
      : definition.parameters !== undefined
        ? definition.parameters
        : []

  validateType(returnType)
  if (!ArrayIsArray(params)) {
    throw new FFIError(
      'CFunction: definition.args must be an array of type strings',
      FFI_ERROR_CODES.EBADARGS,
    )
  }
  for (let i = 0; i < params.length; i++) {
    validateType(params[i])
  }

  let result
  try {
    result = binding().registerFunction(ptr, returnType, params)
  } catch (err) {
    const msg = (err && err.message) || ''
    throw new FFIError(`CFunction: ${msg}`, {
      __proto__: null,
      code: FFI_ERROR_CODES.EBADARGS,
      cause: err,
    })
  }
  const fnId = result[0]
  const hasFast = result[1]
  const argc = params.length

  // Local closed-flag captured by the wrapper's isClosed check. Object
  // wrapper (not a plain `let`) so the closure and the close() method
  // both observe the same mutation.
  const closedRef = { __proto__: null, closed: false }
  const wrapper = buildCallWrapper({
    __proto__: null,
    fnId,
    hasFast,
    argc,
    isClosed: () => closedRef.closed,
    closedMessage: 'CFunction has been closed',
    closedCode: FFI_ERROR_CODES.EBADLIB,
  })

  ObjectDefineProperty(wrapper, 'length', {
    __proto__: null,
    value: argc,
    configurable: true,
  })
  ObjectDefineProperty(wrapper, 'name', {
    __proto__: null,
    value: 'CFunction',
    configurable: true,
  })
  ObjectDefineProperty(wrapper, 'ptr', {
    __proto__: null,
    value: ptr,
    writable: false,
    enumerable: true,
    configurable: false,
  })
  ObjectDefineProperty(wrapper, 'closed', {
    __proto__: null,
    get() {
      return closedRef.closed
    },
    enumerable: true,
    configurable: false,
  })
  ObjectDefineProperty(wrapper, 'close', {
    __proto__: null,
    value: function close() {
      if (closedRef.closed) {
        return
      }
      closedRef.closed = true
      try {
        binding().unregisterFunction(fnId)
      } catch {
        // Idempotent on the native side too — but if a future native
        // version throws on missing IDs, swallow it because the JS-
        // visible state has been transitioned to closed already.
      }
    },
    writable: false,
    configurable: false,
  })

  return wrapper
}

// linkSymbols(defs) — batch-wrap a map of CFunction definitions.
//
//   const { symbols, close } = linkSymbols({
//     foo: { ptr: ptrFoo, returns: 'i32', args: ['i32'] },
//     bar: { ptr: ptrBar, returns: 'void', args: [] },
//   })
//   symbols.foo(42)
//   close()
//
// Returns a `{ symbols, close }` shape mirroring bun's linkSymbols. The
// close() method tears down every CFunction allocated by this call.
function linkSymbols(defs) {
  if (typeof defs !== 'object' || defs === null) {
    throw new FFIError(
      'linkSymbols(defs): defs must be an object mapping names to ' +
        '{ ptr, returns, args }',
      FFI_ERROR_CODES.EBADARGS,
    )
  }
  const symbols = { __proto__: null }
  const created = []
  try {
    const keys = ObjectKeys(defs)
    for (let i = 0; i < keys.length; i++) {
      const name = keys[i]
      const fn = CFunction(defs[name])
      symbols[name] = fn
      ArrayPrototypePush(created, fn)
    }
  } catch (err) {
    // Roll back any CFunctions we managed to create before the failure.
    for (let i = 0; i < created.length; i++) {
      try {
        created[i].close()
      } catch {
        // best-effort cleanup
      }
    }
    throw err
  }
  return ObjectFreeze({
    __proto__: null,
    symbols: ObjectFreeze(symbols),
    close() {
      for (let i = 0; i < created.length; i++) {
        try {
          created[i].close()
        } catch {
          // best-effort cleanup
        }
      }
    },
  })
}

module.exports = ObjectFreeze({
  __proto__: null,
  boundedToNumber,
  CFunction,
  JSCallback,
  linkSymbols,
})
