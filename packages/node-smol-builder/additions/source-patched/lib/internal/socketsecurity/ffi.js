'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/ffi.js.md

const {
  ArrayBufferIsView,
  ArrayIsArray,
  ArrayPrototypePush,
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
  SafeSet,
  MapPrototypeSet,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeDelete,
  MapPrototypeForEach,
  SetPrototypeAdd,
  SetPrototypeValues,
  ArrayFrom,
  TypeError: TypeErrorCtor,
  RangeError: RangeErrorCtor,
} = primordials

// Lazy-loaded to avoid pulling fs into smol-ffi's load graph until
// dlopen.find() is actually called. The find() helper is a discovery
// convenience used at startup; the rest of smol-ffi must remain
// loadable without dragging the fs module in.
let _fs
function lazyFs() {
  if (!_fs) {
    _fs = require('fs')
  }
  return _fs
}

// HISTORY: WHY internalBinding() INSTEAD OF process.binding()
// process.binding() was deprecated in 2018 (PR #22004) because it was an
// undocumented backdoor that let user code access native C++ internals.
// internalBinding() moved these bindings behind a loader path that only
// Node.js core can access — user code calling internalBinding() gets a
// "not found" error. See issue #22064 for the migration effort and #27061
// for the community discussion about why access was intentionally restricted.
let _ffiBinding
function binding() {
  if (!_ffiBinding) {
    _ffiBinding = internalBinding('smol_ffi')
  }
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
// Extended over v26.1.0's set: ARRAY_BUFFER, FUNCTION, CHAR are aliases
// the upstream surface exposes that smol-ffi mirrors verbatim so code
// targeting node:ffi types can be lifted over without rename churn.
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
  ARRAY_BUFFER: 'arraybuffer',
  FUNCTION: 'function',
  CHAR: 'char',
})

// Structured error codes for FFIError. Surfaced on err.code so callers
// can branch on the failure mode without string-matching the message.
const FFI_ERROR_CODES = ObjectFreeze({
  __proto__: null,
  // Failed to dlopen the library file (missing, wrong arch, perms).
  EBADLIB: 'EBADLIB',
  // dlsym failed: requested symbol does not exist in the library.
  ENOSYM: 'ENOSYM',
  // Argument count / shape did not match the bound signature.
  EBADARGS: 'EBADARGS',
  // Type string was not recognized (e.g. unknown 'u128').
  EBADTYPE: 'EBADTYPE',
  // Pointer was null or otherwise unusable for the requested op.
  EBADPTR: 'EBADPTR',
  // Feature exists in the upstream API but is not implemented here yet.
  ENOTIMPL: 'ENOTIMPL',
})

// Platform shared-library suffix.
const suffix =
  process.platform === 'win32'
    ? 'dll'
    : process.platform === 'darwin'
      ? 'dylib'
      : 'so'

// FFIError carries an optional `.code` (one of FFI_ERROR_CODES) so
// callers can branch on the failure mode without string-matching the
// message. Constructor accepts either:
//   new FFIError(message)
//   new FFIError(message, code)
//   new FFIError(message, { code, cause })
class FFIError extends ErrorCtor {
  constructor(message, codeOrOptions) {
    super(message)
    let code
    let cause
    if (typeof codeOrOptions === 'string') {
      code = codeOrOptions
    } else if (codeOrOptions !== undefined && codeOrOptions !== null) {
      code = codeOrOptions.code
      cause = codeOrOptions.cause
    }
    this.name = 'FFIError'
    if (code !== undefined) {
      this.code = code
    }
    // Cause is set as a plain own property (matching the pattern
    // upstream's internal/errors.js uses). The Error(msg, options)
    // constructor would also work for setting cause, but doing it
    // here keeps the spread of construction strategies inside FFIError
    // narrow and easier to audit.
    if (cause !== undefined) {
      this.cause = cause
    }
    ErrorCaptureStackTrace(this, FFIError)
  }
}

ObjectSetPrototypeOf(FFIError.prototype, ErrorCtor.prototype)

function validateType(type) {
  if (typeof type !== 'string' || !VALID_TYPES[type]) {
    throw new FFIError(
      `Invalid FFI type: "${type}". Allowed types are listed in ` +
        '`require("node:smol-ffi").types`.',
      FFI_ERROR_CODES.EBADTYPE,
    )
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

// Build a monomorphic JS wrapper around a native function ID.
//
// Returns a function that:
//   - throws when `isClosed()` returns true (carrying `closedMessage` /
//     `closedCode`)
//   - primes the V8 Fast API target (when `hasFast`) so the trampoline
//     can dispatch without going through the slow Call() path
//   - finally calls `binding().call(fnId, ...args)`.
//
// The arity switch generates per-arg-count wrappers so V8 can inline the
// call site; the `...args` default is for >6 params and intentionally
// blocks inlining (rest args are slow but pass through the marshaling
// path correctly). Shared between Library.func (closed = library closed)
// and CFunction (closed = .close() called).
function buildCallWrapper({
  fnId,
  hasFast,
  argc,
  isClosed,
  closedMessage,
  closedCode,
}) {
  const b = binding()
  const call = b.call
  const setTarget = hasFast ? b.setTarget : undefined
  const closedErr = () => new FFIError(closedMessage, closedCode)
  switch (argc) {
    case 0:
      return hasFast
        ? () => {
            if (isClosed()) { throw closedErr() }
            setTarget(fnId)
            return call(fnId)
          }
        : () => {
            if (isClosed()) { throw closedErr() }
            return call(fnId)
          }
    case 1:
      return hasFast
        ? a0 => {
            if (isClosed()) { throw closedErr() }
            setTarget(fnId)
            return call(fnId, a0)
          }
        : a0 => {
            if (isClosed()) { throw closedErr() }
            return call(fnId, a0)
          }
    case 2:
      return hasFast
        ? (a0, a1) => {
            if (isClosed()) { throw closedErr() }
            setTarget(fnId)
            return call(fnId, a0, a1)
          }
        : (a0, a1) => {
            if (isClosed()) { throw closedErr() }
            return call(fnId, a0, a1)
          }
    case 3:
      return hasFast
        ? (a0, a1, a2) => {
            if (isClosed()) { throw closedErr() }
            setTarget(fnId)
            return call(fnId, a0, a1, a2)
          }
        : (a0, a1, a2) => {
            if (isClosed()) { throw closedErr() }
            return call(fnId, a0, a1, a2)
          }
    case 4:
      return (a0, a1, a2, a3) => {
        if (isClosed()) { throw closedErr() }
        if (setTarget) { setTarget(fnId) }
        return call(fnId, a0, a1, a2, a3)
      }
    case 5:
      return (a0, a1, a2, a3, a4) => {
        if (isClosed()) { throw closedErr() }
        return call(fnId, a0, a1, a2, a3, a4)
      }
    case 6:
      return (a0, a1, a2, a3, a4, a5) => {
        if (isClosed()) { throw closedErr() }
        return call(fnId, a0, a1, a2, a3, a4, a5)
      }
    default:
      return (...args) => {
        if (isClosed()) { throw closedErr() }
        return call(fnId, ...args)
      }
  }
}

// Represents a loaded native library.
class Library {
  #id
  // Path the library was opened with. May be undefined for libraries
  // constructed without a path (legacy callers). When present, close()
  // evicts the cache entry so the next open() reloads cleanly.
  #path
  #closed = false
  #functions = new SafeMap()
  #callbacks = new SafeMap()
  // SafeSet of every symbol name resolved through this library
  // (via func, funcs, or symbol). Used by list() to enumerate the
  // public surface this library has exposed to JS.
  #symbolNames = new SafeSet()

  constructor(id, path) {
    this.#id = id
    this.#path = path
  }

  get id() {
    return this.#id
  }

  get path() {
    return this.#path
  }

  // Returns an array of every symbol name previously resolved through
  // this library (via func, funcs, or symbol). Useful for diagnostics
  // and for surfacing the dynamic shape of a wrapped library.
  list() {
    return ArrayFrom(SetPrototypeValues(this.#symbolNames))
  }

  // Define a callable function from this library.
  // Supports both positional and signature-object forms:
  //   lib.func('sqrt', 'f64', ['f64'])
  //   lib.func('sqrt', { result: 'f64', parameters: ['f64'] })
  func(name, returnTypeOrSig, paramTypes) {
    if (this.#closed) {
      throw new FFIError('Library has been closed', FFI_ERROR_CODES.EBADLIB)
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
        throw new FFIError(
          'paramTypes must be an array',
          FFI_ERROR_CODES.EBADARGS,
        )
      }
      for (let i = 0; i < params.length; i++) {
        validateType(params[i])
      }
    }

    let result
    try {
      result = binding().sym(this.#id, name, returnType, params)
    } catch (err) {
      // The native binding throws plain Error/TypeError; classify based on
      // message text and rewrap as FFIError with a structured .code. The
      // text matching is fragile (binding.cc owns these strings) but the
      // surface area is small (3 native error texts) and a missing match
      // falls through to a generic FFIError preserving the original cause.
      const msg = (err && err.message) || ''
      let code = FFI_ERROR_CODES.ENOSYM
      if (msg.indexOf('Symbol not found') === -1 &&
          msg.indexOf('dlsym') === -1) {
        code = FFI_ERROR_CODES.EBADARGS
      }
      throw new FFIError(`func("${name}"): ${msg}`, {
        __proto__: null,
        code,
        cause: err,
      })
    }
    const fnId = result[0]
    const hasFast = result[1]
    const argc = params ? params.length : 0
    // Capture a closure over `this.#closed`. Arrow inherits `this`; private
    // fields are class-lexically scoped so the access reads correctly.
    const isClosed = () => this.#closed
    const wrapper = buildCallWrapper({
      __proto__: null,
      fnId,
      hasFast,
      argc,
      isClosed,
      closedMessage: 'Library has been closed',
      closedCode: FFI_ERROR_CODES.EBADLIB,
    })

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
    SetPrototypeAdd(this.#symbolNames, name)
    return wrapper
  }

  // Batch resolve multiple functions at once.
  // definitions: { name: { result, parameters }, ... }
  // OR: { name: [returnType, [paramTypes]], ... }
  funcs(definitions) {
    if (this.#closed) {
      throw new FFIError('Library has been closed', FFI_ERROR_CODES.EBADLIB)
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
      throw new FFIError('Library has been closed', FFI_ERROR_CODES.EBADLIB)
    }
    if (typeof name !== 'string') {
      throw new TypeErrorCtor('Symbol name must be a string')
    }
    let ptr
    try {
      ptr = binding().dlsym(this.#id, name)
    } catch (err) {
      throw new FFIError(`Symbol not found: "${name}"`, {
        __proto__: null,
        code: FFI_ERROR_CODES.ENOSYM,
        cause: err,
      })
    }
    SetPrototypeAdd(this.#symbolNames, name)
    return ptr
  }

  // Register a JS function as a native callback pointer.
  // Returns a BigInt pointer that can be passed to native code.
  registerCallback(returnTypeOrSig, paramTypesOrFn, maybeFn) {
    if (this.#closed) {
      throw new FFIError('Library has been closed', FFI_ERROR_CODES.EBADLIB)
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
      if (value === ptr) {
        foundId = key
      }
    })

    if (foundId === undefined) {
      throw new FFIError('Callback not found for this pointer')
    }

    binding().unregisterCallback(foundId)
    MapPrototypeDelete(callbacks, foundId)
  }

  close() {
    if (this.#closed) {
      return
    }
    this.#closed = true
    // Evict from the dlopen cache first so a concurrent open() of the
    // same path can't hand out this dying handle. The eviction is
    // unconditional even if the cache value isn't us — defensive
    // against external callers who replaced the cache entry, which
    // shouldn't happen but the check is free.
    if (this.#path !== undefined &&
        MapPrototypeGet(LIBRARY_CACHE, this.#path) === this) {
      MapPrototypeDelete(LIBRARY_CACHE, this.#path)
    }
    // Unregister every live callback BEFORE closing the library. Just
    // dropping the map leaked the native trampoline/thunk allocations
    // the binding pinned per registerCallback(), and if any native
    // code still held the callback pointer its invocation path raced
    // with the subsequent binding().close() → potential UAF on the
    // dispatch side. Unregister in try/catch so a single bad id
    // doesn't strand the rest.
    MapPrototypeForEach(this.#callbacks, (_ptr, cbId) => {
      try {
        binding().unregisterCallback(cbId)
      } catch {
        // Best-effort: keep unregistering the remaining callbacks.
      }
    })
    binding().close(this.#id)
    this.#functions = new SafeMap()
    this.#callbacks = new SafeMap()
  }

  get closed() {
    return this.#closed
  }
}

// Cache of absolute-path → live Library so repeated dlopen()/open()
// of the same library is free. Closing a library evicts the entry.
// Keyed on the exact path string the caller passed; we deliberately
// do NOT canonicalize via fs.realpath here — that would add an extra
// syscall per cache lookup on the hot path and break callers that
// rely on per-path identity for testing/isolation.
const LIBRARY_CACHE = new SafeMap()

// Open a native library by path. Cached: re-opening the same path
// returns the existing Library instance (incrementing no refcount —
// the cache IS the refcount, since close() evicts).
function open(path) {
  if (typeof path !== 'string') {
    throw new TypeErrorCtor('Library path must be a string')
  }
  if (MapPrototypeHas(LIBRARY_CACHE, path)) {
    const cached = MapPrototypeGet(LIBRARY_CACHE, path)
    if (!cached.closed) {
      return cached
    }
    MapPrototypeDelete(LIBRARY_CACHE, path)
  }
  let id
  try {
    id = binding().open(path)
  } catch (err) {
    throw new FFIError(`Failed to load library: "${path}"`, {
      __proto__: null,
      code: FFI_ERROR_CODES.EBADLIB,
      cause: err,
    })
  }
  const lib = new Library(id, path)
  MapPrototypeSet(LIBRARY_CACHE, path, lib)
  return lib
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

// dlopen.find(name): probe common path forms for a library and return
// the first that exists on disk. Tries `lib{name}.{suffix}` first (the
// POSIX convention) and falls back to `{name}.{suffix}` (Windows /
// platforms that don't use the lib prefix). Returns undefined when no
// candidate exists — callers should treat that as ENOENT and fall back
// to whatever discovery they were doing before.
//
// Search semantics: paths are existsSync'd verbatim. If `name` is a
// bare library name like 'sqlite3', the probe checks 'libsqlite3.so'
// (or .dylib / .dll) relative to the CWD. Callers that want the
// system loader path (LD_LIBRARY_PATH / DYLD_LIBRARY_PATH / system32)
// should pre-resolve via their own search or just call open() with
// the bare suffixed name and let the OS resolver handle it. This
// helper is the cheap path: it sees what the filesystem can show
// without going through dlopen() first.
function dlopenFind(name) {
  if (typeof name !== 'string') {
    throw new TypeErrorCtor('Library name must be a string')
  }
  const fsMod = lazyFs()
  const candidates = [`lib${name}.${suffix}`, `${name}.${suffix}`]
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      if (fsMod.existsSync(candidate)) {
        return candidate
      }
    } catch {
      // Existence probes shouldn't throw on EACCES / ENOENT, but if
      // the caller stubbed fs.existsSync, swallow and keep probing.
    }
  }
  return undefined
}

// Attach find as a static helper on dlopen so callers can do
// `dlopen.find('sqlite3')` without a separate import.
ObjectDefineProperty(dlopen, 'find', {
  __proto__: null,
  value: dlopenFind,
  writable: false,
  configurable: false,
  enumerable: false,
})

// Max bytes ptrToBuffer will copy (128 MB). Prevents accidental OOM.
const kMaxPtrReadLength = 128 * 1024 * 1024

function ptrToBuffer(ptr, length, copy) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt')
  }
  if (ptr === 0n && length > 0) {
    throw new FFIError(
      'Cannot read from null pointer',
      FFI_ERROR_CODES.EBADPTR,
    )
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
  if (ptr === 0n) {
    throw new FFIError(
      'Cannot read string from null pointer',
      FFI_ERROR_CODES.EBADPTR,
    )
  }
  return binding().ptrToString(ptr)
}

function ptrToArrayBuffer(ptr, length, copy) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt')
  }
  if (ptr === 0n && length > 0) {
    throw new FFIError(
      'Cannot read from null pointer',
      FFI_ERROR_CODES.EBADPTR,
    )
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

// Byte sizes used by read.batch to advance offset between reads.
// Keyed on the canonical 1/2/4/8-byte type names (smol-ffi's `i32`,
// `u8`, ...). `ptr` is 8 bytes on every platform we ship (we don't
// support 32-bit targets); this stays correct even on i386 Linux
// builds because we don't run JS on those.
const TYPE_SIZES = ObjectFreeze({
  __proto__: null,
  i8: 1, u8: 1, bool: 1, char: 1,
  i16: 2, u16: 2,
  i32: 4, u32: 4, int: 4, uint: 4, f32: 4, float: 4,
  i64: 8, u64: 8, f64: 8, double: 8, pointer: 8, ptr: 8,
})

// Type → accessor map for read.batch. Cached at module load so the
// hot path is a single map lookup. Keys mirror the user-facing type
// strings from `types`.
const READERS_BY_TYPE = ObjectFreeze({
  __proto__: null,
  i8: getInt8, u8: getUint8, char: getInt8, bool: getUint8,
  i16: getInt16, u16: getUint16,
  i32: getInt32, u32: getUint32, int: getInt32, uint: getUint32,
  f32: getFloat32, float: getFloat32,
  i64: getInt64, u64: getUint64,
  f64: getFloat64, double: getFloat64,
  // pointer / ptr read as unsigned 64-bit BigInt (matches the shape
  // bufferToPtr/dlsym return).
  pointer: getUint64, ptr: getUint64,
})

// readBatch(ptr, types) — read each type from `ptr` at auto-advancing
// offsets. Example: readBatch(p, ['i32', 'u8', 'f64']) reads at
// offsets 0, 4, 5 and returns [int32, uint8, float64].
// This is the equivalent of a fixed-shape struct read; no alignment
// padding is inserted (the caller is responsible for matching the
// native layout, including any padding bytes).
function readBatch(ptr, fieldTypes) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt')
  }
  if (ptr === 0n) {
    throw new FFIError(
      'Cannot read from null pointer',
      FFI_ERROR_CODES.EBADPTR,
    )
  }
  if (!ArrayIsArray(fieldTypes)) {
    throw new FFIError(
      'fieldTypes must be an array of type strings',
      FFI_ERROR_CODES.EBADARGS,
    )
  }
  const out = []
  let offset = 0
  for (let i = 0; i < fieldTypes.length; i++) {
    const t = fieldTypes[i]
    const reader = READERS_BY_TYPE[t]
    const size = TYPE_SIZES[t]
    if (reader === undefined || size === undefined) {
      throw new FFIError(
        `read.batch: unsupported field type "${t}" at index ${i}. ` +
          'Use one of: i8, u8, i16, u16, i32, u32, i64, u64, f32, f64, ' +
          'pointer, ptr, bool, char, int, uint, float, double.',
        FFI_ERROR_CODES.EBADTYPE,
      )
    }
    ArrayPrototypePush(out, reader(ptr, offset))
    offset += size
  }
  return out
}

// readPtr(ptr, offset?) — read a pointer-sized BigInt at offset. Alias
// for getUint64 to make pointer-reads grep-friendly at the call site.
function readPtr(ptr, offset) {
  return getUint64(ptr, offset)
}

// bun-style `read` namespace. Each accessor takes (ptr, offset?) and
// returns the value. The shape matches https://bun.sh/docs/api/ffi#reading-pointers
// so code lifted from bun stays grep-friendly.
const read = ObjectFreeze({
  __proto__: null,
  i8: getInt8,
  u8: getUint8,
  i16: getInt16,
  u16: getUint16,
  i32: getInt32,
  u32: getUint32,
  i64: getInt64,
  u64: getUint64,
  f32: getFloat32,
  f64: getFloat64,
  ptr: readPtr,
  batch: readBatch,
})

module.exports = {
  __proto__: null,

  // Library lifecycle
  open,
  dlopen,
  Library,
  FFIError,
  FFI_ERROR_CODES,

  // Internal helpers exposed for sibling internal modules
  // (internal/socketsecurity/ffi-callable). NOT part of the public surface;
  // callers from `node:smol-ffi` should go through the named exports.
  binding,
  buildCallWrapper,
  validateType,

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

  // bun-style read namespace + batch reader
  read,
  readBatch,
  readPtr,
}
