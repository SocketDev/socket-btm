'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/ffi.js.md

const {
  ArrayBufferIsView,
  ArrayIsArray,
  Error: ErrorCtor,
  ErrorCaptureStackTrace,
  NumberIsSafeInteger,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectKeys,
  ObjectSetPrototypeOf,
  // HISTORY: WHY SafeMap INSTEAD OF Map
  // If user code does `Map.prototype.get = () => 'hacked'`, then any code
  // using `map.get(key)` silently calls the attacker's function. SafeMap is
  // a Node.js internal subclass that captures the original Map methods at
  // startup via primordials. MapPrototypeSet/Get/Delete are "uncurried" —
  // they call the original method directly: MapPrototypeGet(map, key) instead
  // of map.get(key). This also protects iterator methods, which were another
  // vector for prototype pollution.
  SafeMap,
  MapPrototypeSet,
  MapPrototypeDelete,
  MapPrototypeForEach,
  TypeError: TypeErrorCtor,
  RangeError: RangeErrorCtor,
} = primordials

// HISTORY: WHY internalBinding() INSTEAD OF process.binding()
// process.binding() was deprecated in 2018 (PR #22004) because it was an
// undocumented backdoor that let user code access native C++ internals.
// internalBinding() moved these bindings behind a loader path that only
// Node.js core can access — user code calling internalBinding() gets a
// "not found" error. See issue #22064 for the migration effort and #27061
// for the community discussion about why access was intentionally restricted.
let _ffiBinding
function binding() {
  if (!_ffiBinding) _ffiBinding = internalBinding('smol_ffi')
  return _ffiBinding
}

// Valid FFI type strings.
const VALID_TYPES = ObjectFreeze({
  __proto__: null,
  void: true,
  bool: true,
  i8: true,
  u8: true,
  i16: true,
  u16: true,
  int: true,
  i32: true,
  uint: true,
  u32: true,
  i64: true,
  u64: true,
  f32: true,
  float: true,
  f64: true,
  double: true,
  pointer: true,
  ptr: true,
  string: true,
  str: true,
  buffer: true,
})

// Type name constants (mirrors upstream node:ffi types).
const types = ObjectFreeze({
  __proto__: null,
  VOID: 'void',
  BOOL: 'bool',
  INT_8: 'i8',
  UINT_8: 'u8',
  INT_16: 'i16',
  UINT_16: 'u16',
  INT_32: 'i32',
  UINT_32: 'u32',
  INT_64: 'i64',
  UINT_64: 'u64',
  FLOAT: 'f32',
  FLOAT_32: 'f32',
  DOUBLE: 'f64',
  FLOAT_64: 'f64',
  POINTER: 'pointer',
  STRING: 'string',
  BUFFER: 'buffer',
})

// Platform shared-library suffix.
const suffix =
  process.platform === 'win32'
    ? 'dll'
    : process.platform === 'darwin'
      ? 'dylib'
      : 'so'

class FFIError extends ErrorCtor {
  constructor(message) {
    super(message)
    this.name = 'FFIError'
    ErrorCaptureStackTrace(this, FFIError)
  }
}

ObjectSetPrototypeOf(FFIError.prototype, ErrorCtor.prototype)

function validateType(type) {
  if (typeof type !== 'string' || !VALID_TYPES[type]) {
    throw new TypeErrorCtor(`Invalid FFI type: "${type}"`)
  }
}

// Parse a signature object { result/returns/return: ..., parameters/arguments: [...] }
// or accept positional (returnType, paramTypes) arguments.
function parseSignature(arg1, arg2) {
  if (typeof arg1 === 'string') {
    // Positional: (returnType, paramTypes)
    return { __proto__: null, returnType: arg1, paramTypes: arg2 }
  }

  if (typeof arg1 === 'object' && arg1 !== null && !ArrayIsArray(arg1)) {
    // Signature object: { result/returns/return: ..., parameters/arguments: [...] }
    const sig = arg1
    const returnType =
      sig.result !== undefined
        ? sig.result
        : sig.returns !== undefined
          ? sig.returns
          : sig.return !== undefined
            ? sig.return
            : 'void'
    const paramTypes =
      sig.parameters !== undefined
        ? sig.parameters
        : sig.arguments !== undefined
          ? sig.arguments
          : undefined
    return { __proto__: null, returnType, paramTypes }
  }

  throw new TypeErrorCtor(
    'Signature must be a type string or object with result/parameters',
  )
}

// Represents a loaded native library.
class Library {
  #id
  #closed = false
  #functions = new SafeMap()
  #callbacks = new SafeMap()

  constructor(id) {
    this.#id = id
  }

  get id() {
    return this.#id
  }

  // Define a callable function from this library.
  // Supports both positional and signature-object forms:
  //   lib.func('sqrt', 'f64', ['f64'])
  //   lib.func('sqrt', { result: 'f64', parameters: ['f64'] })
  func(name, returnTypeOrSig, paramTypes) {
    if (this.#closed) {
      throw new FFIError('Library has been closed')
    }
    if (typeof name !== 'string') {
      throw new TypeErrorCtor('Function name must be a string')
    }

    const sig = parseSignature(returnTypeOrSig, paramTypes)
    const returnType = sig.returnType
    const params = sig.paramTypes

    validateType(returnType)
    if (params !== undefined) {
      if (!ArrayIsArray(params)) {
        throw new TypeErrorCtor('paramTypes must be an array')
      }
      for (let i = 0; i < params.length; i++) {
        validateType(params[i])
      }
    }

    const result = binding().sym(this.#id, name, returnType, params)
    const fnId = result[0]
    const hasFast = result[1]
    const b = binding()
    const call = b.call
    const setTarget = hasFast ? b.setTarget : undefined
    const closed = () => this.#closed

    // Generate monomorphic wrappers by param count.
    // Rest args (...) prevents V8 from inlining the call.
    // When hasFast is true, setTarget primes the TLS fn_ptr so the
    // V8 Fast API trampoline can bypass argument marshaling entirely.
    const argc = params ? params.length : 0
    let wrapper
    switch (argc) {
      case 0:
        wrapper = hasFast
          ? () => {
              if (closed()) throw new FFIError('Library has been closed')
              setTarget(fnId)
              return call(fnId)
            }
          : () => {
              if (closed()) throw new FFIError('Library has been closed')
              return call(fnId)
            }
        break
      case 1:
        wrapper = hasFast
          ? a0 => {
              if (closed()) throw new FFIError('Library has been closed')
              setTarget(fnId)
              return call(fnId, a0)
            }
          : a0 => {
              if (closed()) throw new FFIError('Library has been closed')
              return call(fnId, a0)
            }
        break
      case 2:
        wrapper = hasFast
          ? (a0, a1) => {
              if (closed()) throw new FFIError('Library has been closed')
              setTarget(fnId)
              return call(fnId, a0, a1)
            }
          : (a0, a1) => {
              if (closed()) throw new FFIError('Library has been closed')
              return call(fnId, a0, a1)
            }
        break
      case 3:
        wrapper = hasFast
          ? (a0, a1, a2) => {
              if (closed()) throw new FFIError('Library has been closed')
              setTarget(fnId)
              return call(fnId, a0, a1, a2)
            }
          : (a0, a1, a2) => {
              if (closed()) throw new FFIError('Library has been closed')
              return call(fnId, a0, a1, a2)
            }
        break
      case 4:
        wrapper = (a0, a1, a2, a3) => {
          if (closed()) throw new FFIError('Library has been closed')
          if (setTarget) setTarget(fnId)
          return call(fnId, a0, a1, a2, a3)
        }
        break
      case 5:
        wrapper = (a0, a1, a2, a3, a4) => {
          if (closed()) throw new FFIError('Library has been closed')
          return call(fnId, a0, a1, a2, a3, a4)
        }
        break
      case 6:
        wrapper = (a0, a1, a2, a3, a4, a5) => {
          if (closed()) throw new FFIError('Library has been closed')
          return call(fnId, a0, a1, a2, a3, a4, a5)
        }
        break
      default:
        wrapper = (...args) => {
          if (closed()) throw new FFIError('Library has been closed')
          return call(fnId, ...args)
        }
        break
    }

    ObjectDefineProperty(wrapper, 'name', {
      __proto__: null,
      value: name,
      configurable: true,
    })
    ObjectDefineProperty(wrapper, 'length', {
      __proto__: null,
      value: argc,
      configurable: true,
    })

    MapPrototypeSet(this.#functions, name, fnId)
    return wrapper
  }

  // Batch resolve multiple functions at once.
  // definitions: { name: { result, parameters }, ... }
  // OR: { name: [returnType, [paramTypes]], ... }
  funcs(definitions) {
    if (this.#closed) {
      throw new FFIError('Library has been closed')
    }
    if (typeof definitions !== 'object' || definitions === null) {
      throw new TypeErrorCtor('definitions must be an object')
    }

    const result = { __proto__: null }
    const keys = ObjectKeys(definitions)
    for (let i = 0; i < keys.length; i++) {
      const name = keys[i]
      const def = definitions[name]
      if (ArrayIsArray(def)) {
        result[name] = this.func(name, def[0], def[1])
      } else {
        result[name] = this.func(name, def)
      }
    }
    return result
  }

  // Resolve a raw symbol address (without binding a signature).
  symbol(name) {
    if (this.#closed) {
      throw new FFIError('Library has been closed')
    }
    if (typeof name !== 'string') {
      throw new TypeErrorCtor('Symbol name must be a string')
    }
    return binding().dlsym(this.#id, name)
  }

  // Register a JS function as a native callback pointer.
  // Returns a BigInt pointer that can be passed to native code.
  registerCallback(returnTypeOrSig, paramTypesOrFn, maybeFn) {
    if (this.#closed) {
      throw new FFIError('Library has been closed')
    }

    let returnType
    let params
    let fn

    if (typeof returnTypeOrSig === 'function') {
      // registerCallback(fn) — void() signature
      fn = returnTypeOrSig
      returnType = 'void'
      params = []
    } else if (
      typeof returnTypeOrSig === 'object' &&
      returnTypeOrSig !== null &&
      !ArrayIsArray(returnTypeOrSig)
    ) {
      // registerCallback({ result, parameters }, fn)
      const sig = parseSignature(returnTypeOrSig)
      returnType = sig.returnType
      params = sig.paramTypes || []
      fn = paramTypesOrFn
    } else {
      // registerCallback(returnType, paramTypes, fn)
      returnType = returnTypeOrSig
      params = paramTypesOrFn || []
      fn = maybeFn
    }

    if (typeof fn !== 'function') {
      throw new TypeErrorCtor('Callback must be a function')
    }

    validateType(returnType)
    if (!ArrayIsArray(params)) {
      throw new TypeErrorCtor('paramTypes must be an array')
    }
    for (let i = 0; i < params.length; i++) {
      validateType(params[i])
    }

    const result = binding().registerCallback(this.#id, returnType, params, fn)
    const cbId = result[0]
    const nativePtr = result[1]

    MapPrototypeSet(this.#callbacks, cbId, nativePtr)
    return nativePtr
  }

  // Unregister a callback by its native pointer.
  unregisterCallback(ptr) {
    if (typeof ptr !== 'bigint') {
      throw new TypeErrorCtor('ptr must be a BigInt')
    }

    // Find the callback ID by pointer.
    let foundId
    const callbacks = this.#callbacks
    // Iterate to find the matching pointer.
    // SafeMap doesn't have a reverse lookup, so we iterate.
    MapPrototypeForEach(callbacks, (value, key) => {
      if (value === ptr) foundId = key
    })

    if (foundId === undefined) {
      throw new FFIError('Callback not found for this pointer')
    }

    binding().unregisterCallback(foundId)
    MapPrototypeDelete(callbacks, foundId)
  }

  close() {
    if (this.#closed) return
    this.#closed = true
    binding().close(this.#id)
    this.#functions = new SafeMap()
    this.#callbacks = new SafeMap()
  }

  get closed() {
    return this.#closed
  }
}

// Open a native library by path.
function open(path) {
  if (typeof path !== 'string') {
    throw new TypeErrorCtor('Library path must be a string')
  }
  const id = binding().open(path)
  return new Library(id)
}

// Convenience: dlopen with batch definitions (matches upstream API shape).
// Returns { lib, functions }.
function dlopen(path, definitions) {
  const lib = open(path)
  try {
    const functions =
      definitions === undefined
        ? ObjectFreeze({ __proto__: null })
        : lib.funcs(definitions)
    return { __proto__: null, lib, functions }
  } catch (err) {
    lib.close()
    throw err
  }
}

// Max bytes ptrToBuffer will copy (128 MB). Prevents accidental OOM.
const kMaxPtrReadLength = 128 * 1024 * 1024

function ptrToBuffer(ptr, length, copy) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt')
  }
  if (ptr === 0n && length > 0) {
    throw new TypeErrorCtor('Cannot read from null pointer')
  }
  if (!NumberIsSafeInteger(length) || length < 0) {
    throw new TypeErrorCtor('length must be a non-negative integer')
  }
  if (copy !== false && length > kMaxPtrReadLength) {
    throw new RangeErrorCtor(
      'length exceeds maximum (128 MB). Pass smaller chunks or use copy=false.',
    )
  }
  return binding().ptrToBuffer(ptr, length, copy)
}

function bufferToPtr(buffer) {
  if (!ArrayBufferIsView(buffer)) {
    throw new TypeErrorCtor('buffer must be a TypedArray or Buffer')
  }
  return binding().bufferToPtr(buffer)
}

function ptrToString(ptr) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt')
  }
  return binding().ptrToString(ptr)
}

function ptrToArrayBuffer(ptr, length, copy) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt')
  }
  if (ptr === 0n && length > 0) {
    throw new TypeErrorCtor('Cannot read from null pointer')
  }
  if (!NumberIsSafeInteger(length) || length < 0) {
    throw new TypeErrorCtor('length must be a non-negative integer')
  }
  return binding().ptrToArrayBuffer(ptr, length, copy)
}

// Raw memory access helpers.
// get*(ptr[, offset]) -> value
// set*(ptr, offset, value) -> undefined

function getInt8(ptr, offset) {
  return binding().getInt8(ptr, offset)
}
function getUint8(ptr, offset) {
  return binding().getUint8(ptr, offset)
}
function getInt16(ptr, offset) {
  return binding().getInt16(ptr, offset)
}
function getUint16(ptr, offset) {
  return binding().getUint16(ptr, offset)
}
function getInt32(ptr, offset) {
  return binding().getInt32(ptr, offset)
}
function getUint32(ptr, offset) {
  return binding().getUint32(ptr, offset)
}
function getInt64(ptr, offset) {
  return binding().getInt64(ptr, offset)
}
function getUint64(ptr, offset) {
  return binding().getUint64(ptr, offset)
}
function getFloat32(ptr, offset) {
  return binding().getFloat32(ptr, offset)
}
function getFloat64(ptr, offset) {
  return binding().getFloat64(ptr, offset)
}

function setInt8(ptr, offset, value) {
  binding().setInt8(ptr, offset, value)
}
function setUint8(ptr, offset, value) {
  binding().setUint8(ptr, offset, value)
}
function setInt16(ptr, offset, value) {
  binding().setInt16(ptr, offset, value)
}
function setUint16(ptr, offset, value) {
  binding().setUint16(ptr, offset, value)
}
function setInt32(ptr, offset, value) {
  binding().setInt32(ptr, offset, value)
}
function setUint32(ptr, offset, value) {
  binding().setUint32(ptr, offset, value)
}
function setInt64(ptr, offset, value) {
  binding().setInt64(ptr, offset, value)
}
function setUint64(ptr, offset, value) {
  binding().setUint64(ptr, offset, value)
}
function setFloat32(ptr, offset, value) {
  binding().setFloat32(ptr, offset, value)
}
function setFloat64(ptr, offset, value) {
  binding().setFloat64(ptr, offset, value)
}

module.exports = {
  __proto__: null,

  // Library lifecycle
  open,
  dlopen,
  Library,
  FFIError,

  // Constants
  suffix,
  types,

  // Pointer helpers
  ptrToBuffer,
  bufferToPtr,
  ptrToString,
  ptrToArrayBuffer,

  // Raw memory access
  getInt8,
  getUint8,
  getInt16,
  getUint16,
  getInt32,
  getUint32,
  getInt64,
  getUint64,
  getFloat32,
  getFloat64,
  setInt8,
  setUint8,
  setInt16,
  setUint16,
  setInt32,
  setUint32,
  setInt64,
  setUint64,
  setFloat32,
  setFloat64,
}
