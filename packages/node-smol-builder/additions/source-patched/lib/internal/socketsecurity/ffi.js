'use strict';

// node:smol-ffi — Cross-platform Foreign Function Interface
// Load native libraries and call C functions directly from JavaScript.

const {
  ArrayBufferIsView,
  ArrayIsArray,
  Error: ErrorCtor,
  ErrorCaptureStackTrace,
  NumberIsSafeInteger,
  ObjectDefineProperty,
  ObjectFreeze,
  ObjectSetPrototypeOf,
  SafeMap,
  MapPrototypeSet,
  TypeError: TypeErrorCtor,
} = primordials;

let _ffiBinding;
function binding() {
  if (!_ffiBinding) _ffiBinding = internalBinding('smol_ffi');
  return _ffiBinding;
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
  buffer: true,
});

class FFIError extends ErrorCtor {
  constructor(message) {
    super(message);
    this.name = 'FFIError';
    ErrorCaptureStackTrace(this, FFIError);
  }
}

ObjectSetPrototypeOf(FFIError.prototype, ErrorCtor.prototype);

function validateType(type) {
  if (typeof type !== 'string' || !VALID_TYPES[type]) {
    throw new TypeErrorCtor(`Invalid FFI type: "${type}"`);
  }
}

// Represents a loaded native library.
class Library {
  #id;
  #closed = false;
  #functions = new SafeMap();

  constructor(id) {
    this.#id = id;
  }

  // Define a callable function from this library.
  // Returns a JavaScript function that calls the native symbol.
  func(name, returnType, paramTypes) {
    if (this.#closed) {
      throw new FFIError('Library has been closed');
    }
    if (typeof name !== 'string') {
      throw new TypeErrorCtor('Function name must be a string');
    }
    validateType(returnType);
    if (paramTypes !== undefined) {
      if (!ArrayIsArray(paramTypes)) {
        throw new TypeErrorCtor('paramTypes must be an array');
      }
      for (let i = 0; i < paramTypes.length; i++) {
        validateType(paramTypes[i]);
      }
    }

    const fnId = binding().sym(this.#id, name, returnType, paramTypes);
    const b = binding();

    // Create a callable wrapper.
    const wrapper = (...args) => {
      if (this.#closed) {
        throw new FFIError('Library has been closed');
      }
      return b.call(fnId, ...args);
    };

    ObjectDefineProperty(wrapper, 'name', {
      __proto__: null,
      value: name,
      configurable: true,
    });
    ObjectDefineProperty(wrapper, 'length', {
      __proto__: null,
      value: paramTypes ? paramTypes.length : 0,
      configurable: true,
    });

    MapPrototypeSet(this.#functions, name, fnId);
    return wrapper;
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    binding().close(this.#id);
    this.#functions = new SafeMap();
  }

  get closed() {
    return this.#closed;
  }
}

// Open a native library by path.
function open(path) {
  if (typeof path !== 'string') {
    throw new TypeErrorCtor('Library path must be a string');
  }
  const id = binding().open(path);
  return new Library(id);
}

// Max bytes ptrToBuffer will copy (128 MB). Prevents accidental OOM.
const kMaxPtrReadLength = 128 * 1024 * 1024;

function ptrToBuffer(ptr, length) {
  if (typeof ptr !== 'bigint') {
    throw new TypeErrorCtor('ptr must be a BigInt');
  }
  if (ptr === 0n) {
    throw new TypeErrorCtor('Cannot read from null pointer');
  }
  if (!NumberIsSafeInteger(length) || length < 0) {
    throw new TypeErrorCtor('length must be a non-negative integer');
  }
  if (length > kMaxPtrReadLength) {
    throw new TypeErrorCtor(
      'length exceeds maximum (128 MB). Pass smaller chunks.');
  }
  return binding().ptrToBuffer(ptr, length);
}

function bufferToPtr(buffer) {
  if (!ArrayBufferIsView(buffer)) {
    throw new TypeErrorCtor('buffer must be a TypedArray or Buffer');
  }
  return binding().bufferToPtr(buffer);
}

module.exports = {
  __proto__: null,
  open,
  ptrToBuffer,
  bufferToPtr,
  Library,
  FFIError,
};
