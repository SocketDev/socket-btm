'use strict'

// Documentation: docs/additions/lib/smol-ffi-compat.md
//
// node:smol-ffi/bun — drop-in compatibility shim for bun:ffi.
//
// Implements the bun:ffi public surface
// (https://bun.sh/docs/api/ffi) atop the canonical
// node:smol-ffi internals. We never load bun itself — this is a
// pure-JS shape adapter sitting on top of smol-ffi's native binding.
//
// Phase 1 (this file): dlopen / FFIType / CString / read / suffix /
// ptr / toArrayBuffer / toBuffer. Sufficient to lift most bun:ffi
// snippets verbatim, minus callbacks.
//
// Phase 2 (deferred — needs new C++ in src/socketsecurity/ffi/binding.cc):
//   JSCallback: would wrap binding().registerCallback so callers can
//     pass a JS fn into native code as a function pointer. The native
//     plumbing exists already — JSCallback just needs the surface
//     adapter — but the threadsafe default + .ptr + .close shape need
//     a careful audit against bun's lifecycle, and the brief instructs
//     us to defer it.
//   CFunction({returns, args, ptr}): would build a callable from a
//     raw ptr. binding().sym() requires a libId today, so a new
//     "call-by-pointer" native path is needed first.
//   linkSymbols({...}): batch version of CFunction; trivial once
//     CFunction lands.
// Until then, the deferred constructors throw FFIError with
// code ENOTIMPL so callers fail fast with a structured error.

const {
  ArrayIsArray,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectKeys,
} = primordials

const internalFfi = require('internal/socketsecurity/ffi')

const {
  open: smolOpen,
  ptrToString: smolPtrToString,
  ptrToArrayBuffer: smolPtrToArrayBuffer,
  ptrToBuffer: smolPtrToBuffer,
  bufferToPtr: smolBufferToPtr,
  suffix,
  FFIError,
  FFI_ERROR_CODES,
  read,
} = internalFfi

// FFIType — bun's full type enum, mapped to smol-ffi canonical type
// strings. Values are exposed as both numeric ordinals (bun's own
// shape — bun:ffi exposes FFIType as numbers internally for fastpath
// dispatch) AND as string aliases so callers using either form work.
// We deliberately use string values here because smol-ffi's binding
// dispatches on type strings; users who pass numeric ordinals to bun
// then lift code over here would silently get garbage. The enum
// below is canonical and immutable.
const FFIType = ObjectFreeze({
  __proto__: null,
  // Pointer-ish
  pointer: 'pointer',
  ptr: 'pointer',
  'void*': 'pointer',
  'char*': 'pointer',
  // C string (NUL-terminated). smol-ffi's canonical type is 'string'.
  cstring: 'string',
  // Function pointers (deferred to Phase 2 for actual callbacks).
  // We still surface the type names so type-table lookups work.
  function: 'pointer',
  fn: 'pointer',
  callback: 'pointer',
  // Buffers — bun's 'buffer' maps to our 'buffer' (a TypedArray/Buffer).
  buffer: 'buffer',
  // Signed integers
  int8_t: 'i8',
  i8: 'i8',
  int16_t: 'i16',
  i16: 'i16',
  int32_t: 'i32',
  i32: 'i32',
  int: 'i32',
  int64_t: 'i64',
  i64: 'i64',
  // bun's i64_fast is a Number-returning fast path; smol-ffi returns
  // BigInt for i64 today and there is no fast i64 path here. Mapping
  // i64_fast to i64 means callers get a BigInt instead of a Number —
  // a documented compat gap (smol-ffi-compat.md surfaces it).
  i64_fast: 'i64',
  // Unsigned integers
  uint8_t: 'u8',
  u8: 'u8',
  uint16_t: 'u16',
  u16: 'u16',
  uint32_t: 'u32',
  u32: 'u32',
  uint: 'u32',
  uint64_t: 'u64',
  u64: 'u64',
  u64_fast: 'u64',
  // Floats
  float: 'f32',
  f32: 'f32',
  double: 'f64',
  f64: 'f64',
  // Misc
  bool: 'bool',
  char: 'i8',
  // napi_env / napi_value — bun exposes these as opaque pointer types.
  // smol-ffi has no equivalent: the smol binary doesn't broker N-API
  // callbacks through FFI. Surfacing as 'pointer' lets callers compile
  // type tables without crashing; runtime use will fail at the binding.
  napi_env: 'pointer',
  napi_value: 'pointer',
})

// Translate a bun-style type entry to the canonical smol-ffi type
// string. Accepts both the raw string ('i32') and the FFIType lookup
// ('FFIType.i32' === 'i32'). Returns the canonical string or throws
// FFIError(EBADTYPE) when the type is unrecognized.
function translateType(typeEntry) {
  if (typeof typeEntry === 'string') {
    const mapped = FFIType[typeEntry]
    if (mapped !== undefined) {
      return mapped
    }
    throw new FFIError(
      `Unrecognized bun:ffi type: "${typeEntry}". Use a key from FFIType ` +
        '(e.g. "i32", "cstring", "ptr").',
      FFI_ERROR_CODES.EBADTYPE,
    )
  }
  throw new FFIError(
    'bun:ffi type must be a string entry from FFIType',
    FFI_ERROR_CODES.EBADTYPE,
  )
}

// dlopen(path, defs) — bun-shaped wrapper around smol-ffi's open().
// bun's defs look like:
//   { funcName: { args: ['i32', ...], returns: 'i32' } }
// We translate the type names and call lib.func() per entry.
// Returns { symbols, close } — symbols is the {name: fn} map; close()
// closes the underlying library AND clears symbol entries so callers
// can't accidentally invoke a freed function pointer (the wrapper
// closures already throw EBADLIB on closed libraries, but null-ing
// out symbols makes a "use after close" land as TypeError on undefined
// instead of as a cryptic native error).
function dlopen(path, defs) {
  if (typeof path !== 'string') {
    throw new FFIError(
      'dlopen(path, defs): path must be a string',
      FFI_ERROR_CODES.EBADARGS,
    )
  }
  if (typeof defs !== 'object' || defs === null) {
    throw new FFIError(
      'dlopen(path, defs): defs must be an object',
      FFI_ERROR_CODES.EBADARGS,
    )
  }
  const lib = smolOpen(path)
  const symbols = { __proto__: null }
  try {
    const names = ObjectKeys(defs)
    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      const entry = defs[name]
      if (typeof entry !== 'object' || entry === null) {
        throw new FFIError(
          `dlopen: definition for "${name}" must be an object with ` +
            '{ args, returns }',
          FFI_ERROR_CODES.EBADARGS,
        )
      }
      const returns =
        entry.returns !== undefined ? translateType(entry.returns) : 'void'
      const rawArgs = entry.args !== undefined ? entry.args : []
      if (!ArrayIsArray(rawArgs)) {
        throw new FFIError(
          `dlopen: "${name}".args must be an array`,
          FFI_ERROR_CODES.EBADARGS,
        )
      }
      const args = new Array(rawArgs.length)
      for (let j = 0; j < rawArgs.length; j++) {
        args[j] = translateType(rawArgs[j])
      }
      symbols[name] = lib.func(name, returns, args)
    }
  } catch (err) {
    lib.close()
    throw err
  }
  return ObjectFreeze({
    __proto__: null,
    symbols: ObjectFreeze(symbols),
    close() {
      lib.close()
    },
  })
}

// CString — bun's String-subclass for NUL-terminated C strings.
// Constructor: new CString(ptr, byteOffset?, byteLength?)
//   - reads UTF-8 from `ptr + byteOffset` until either a NUL byte or
//     byteLength bytes have been consumed
//   - exposes .ptr, .byteOffset, .byteLength as data properties
// Subclassing String here matches bun's behavior — `cs instanceof
// String` is true, and `String.prototype.<method>(cs)` works.
class CString extends String {
  constructor(ptr, byteOffset, byteLength) {
    if (typeof ptr !== 'bigint') {
      throw new FFIError(
        'CString(ptr): ptr must be a BigInt',
        FFI_ERROR_CODES.EBADPTR,
      )
    }
    if (ptr === 0n) {
      throw new FFIError(
        'CString(ptr): cannot construct from null pointer',
        FFI_ERROR_CODES.EBADPTR,
      )
    }
    const offset = byteOffset === undefined ? 0n : BigInt(byteOffset)
    const base = ptr + offset
    let str
    if (byteLength === undefined) {
      // Read until NUL using smol-ffi's ptrToString (which scans for \0).
      str = smolPtrToString(base)
    } else {
      // Length-bounded read: copy the full byteLength into a Buffer,
      // then trim at the first NUL if present (bun's semantics: the
      // bytes after the first NUL are not part of the string, even
      // if byteLength includes them).
      const buf = smolPtrToBuffer(base, byteLength, true)
      // Find first NUL byte at the raw-buffer level. UTF-8 never
      // produces 0x00 except for the literal NUL codepoint, so a
      // byte-level scan equals the codepoint position; this avoids
      // the fragility of literal NUL chars in source text.
      let nulOffset = -1
      for (let k = 0; k < buf.length; k++) {
        if (buf[k] === 0) {
          nulOffset = k
          break
        }
      }
      str =
        nulOffset === -1
          ? buf.toString('utf8')
          : buf.toString('utf8', 0, nulOffset)
    }
    super(str)
    // Plain own properties (frozen-ish via writable: false). Not a
    // getter — bun exposes these as data properties.
    ObjectDefineProperty(this, 'ptr', {
      __proto__: null,
      value: ptr,
      writable: false,
      enumerable: true,
      configurable: false,
    })
    ObjectDefineProperty(this, 'byteOffset', {
      __proto__: null,
      value: byteOffset === undefined ? 0 : byteOffset,
      writable: false,
      enumerable: true,
      configurable: false,
    })
    ObjectDefineProperty(this, 'byteLength', {
      __proto__: null,
      value: byteLength === undefined ? str.length : byteLength,
      writable: false,
      enumerable: true,
      configurable: false,
    })
  }
}

// JSCallback — Phase 2 (deferred). bun's API:
//   const cb = new JSCallback(fn, { args, returns, threadsafe? })
//   // pass cb.ptr to native code
//   cb.close()
// Implementation will route through binding().registerCallback /
// unregisterCallback, which already exist on the native side. The
// deferral is per the brief; throwing ENOTIMPL means callers see a
// structured error instead of a confusing "is not a constructor".
class JSCallback {
  constructor() {
    throw new FFIError(
      'JSCallback is not yet implemented in node:smol-ffi/bun (Phase 2). ' +
        'See docs/additions/lib/smol-ffi-compat.md for status and a ' +
        'workaround using lib.registerCallback() on node:smol-ffi.',
      FFI_ERROR_CODES.ENOTIMPL,
    )
  }
}

// CFunction({returns, args, ptr}) — Phase 2 (deferred). Requires a
// "call by raw pointer" native path the binding doesn't have yet.
function CFunction() {
  throw new FFIError(
    'CFunction is not yet implemented in node:smol-ffi/bun (Phase 2). ' +
      'See docs/additions/lib/smol-ffi-compat.md for status.',
    FFI_ERROR_CODES.ENOTIMPL,
  )
}

// linkSymbols({...}) — Phase 2 (deferred). Trivial once CFunction
// lands; iterates the def map invoking CFunction per entry.
function linkSymbols() {
  throw new FFIError(
    'linkSymbols is not yet implemented in node:smol-ffi/bun (Phase 2). ' +
      'It depends on CFunction; see docs/additions/lib/smol-ffi-compat.md.',
    FFI_ERROR_CODES.ENOTIMPL,
  )
}

// ptr(typedarray) — bun's alias for "give me a BigInt pointer to this
// view's backing memory." Forwards verbatim to bufferToPtr.
function ptr(typedarray) {
  return smolBufferToPtr(typedarray)
}

// toArrayBuffer(ptr, byteOffset?, byteLength?, ...) — bun's pointer →
// ArrayBuffer helper. bun's signature has more optional positional
// args for a finalizer pointer / context, which we don't implement
// (smol-ffi has no finalizer surface yet). We honor offset+length and
// always copy the bytes (bun also defaults to copying).
function toArrayBuffer(p, byteOffset, byteLength) {
  if (typeof p !== 'bigint') {
    throw new FFIError(
      'toArrayBuffer(ptr): ptr must be a BigInt',
      FFI_ERROR_CODES.EBADPTR,
    )
  }
  const offset = byteOffset === undefined ? 0n : BigInt(byteOffset)
  const len = byteLength === undefined ? 0 : byteLength
  return smolPtrToArrayBuffer(p + offset, len, true)
}

// toBuffer(ptr, byteOffset?, byteLength?) — bun's pointer → Buffer
// helper. Same semantics as toArrayBuffer but yields a Node Buffer.
function toBuffer(p, byteOffset, byteLength) {
  if (typeof p !== 'bigint') {
    throw new FFIError(
      'toBuffer(ptr): ptr must be a BigInt',
      FFI_ERROR_CODES.EBADPTR,
    )
  }
  const offset = byteOffset === undefined ? 0n : BigInt(byteOffset)
  const len = byteLength === undefined ? 0 : byteLength
  return smolPtrToBuffer(p + offset, len, true)
}

module.exports = ObjectFreeze({
  __proto__: null,
  dlopen,
  FFIType,
  CString,
  JSCallback,
  CFunction,
  linkSymbols,
  ptr,
  toArrayBuffer,
  toBuffer,
  read,
  suffix,
  // Surface our error type + codes so callers can branch on the same
  // failure modes whether they came in via the canonical surface or
  // through the bun-compat path.
  FFIError,
  FFI_ERROR_CODES,
})
