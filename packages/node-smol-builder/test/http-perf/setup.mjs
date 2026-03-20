/**
 * Vitest setup for http-perf tests.
 * Recreates Node.js primordials exactly from upstream source.
 * See: upstream/node/lib/internal/per_context/primordials.js
 */

/* eslint-disable no-restricted-globals */

const primordials = globalThis.primordials = { __proto__: null };

const {
  defineProperty: ReflectDefineProperty,
  getOwnPropertyDescriptor: ReflectGetOwnPropertyDescriptor,
  ownKeys: ReflectOwnKeys,
} = Reflect;

// `uncurryThis` is equivalent to `func => Function.prototype.call.bind(func)`.
// It is using `bind.bind(call)` to avoid using `Function.prototype.bind`
// and `Function.prototype.call` after it may have been mutated by users.
const { apply, bind, call } = Function.prototype;
const uncurryThis = bind.bind(call);
primordials.uncurryThis = uncurryThis;

// `applyBind` is equivalent to `func => Function.prototype.apply.bind(func)`.
// It is using `bind.bind(apply)` to avoid using `Function.prototype.bind`
// and `Function.prototype.apply` after it may have been mutated by users.
const applyBind = bind.bind(apply);
primordials.applyBind = applyBind;

// Methods that accept a variable number of arguments, and thus it's useful to
// also create `${prefix}${key}Apply`, which uses `Function.prototype.apply`,
// instead of `Function.prototype.call`, and thus doesn't require iterator
// destructuring.
const varargsMethods = [
  'ArrayOf',
  'ArrayPrototypePush',
  'ArrayPrototypeUnshift',
  'MathHypot',
  'MathMax',
  'MathMin',
  'StringFromCharCode',
  'StringFromCodePoint',
  'StringPrototypeConcat',
  'TypedArrayOf',
];

function getNewKey(key) {
  return typeof key === 'symbol' ?
    `Symbol${key.description[7].toUpperCase()}${key.description.slice(8)}` :
    `${key[0].toUpperCase()}${key.slice(1)}`;
}

function copyAccessor(dest, prefix, key, { enumerable, get, set }) {
  ReflectDefineProperty(dest, `${prefix}Get${key}`, {
    __proto__: null,
    value: uncurryThis(get),
    enumerable,
  });
  if (set !== undefined) {
    ReflectDefineProperty(dest, `${prefix}Set${key}`, {
      __proto__: null,
      value: uncurryThis(set),
      enumerable,
    });
  }
}

function copyPropsRenamed(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const name = `${prefix}${newKey}`;
      ReflectDefineProperty(dest, name, { __proto__: null, ...desc });
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, `${name}Apply`, {
          __proto__: null,
          value: applyBind(desc.value, src),
        });
      }
    }
  }
}

function copyPropsRenamedBound(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const { value } = desc;
      if (typeof value === 'function') {
        desc.value = value.bind(src);
      }

      const name = `${prefix}${newKey}`;
      ReflectDefineProperty(dest, name, { __proto__: null, ...desc });
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, `${name}Apply`, {
          __proto__: null,
          value: applyBind(value, src),
        });
      }
    }
  }
}

function copyPrototype(src, dest, prefix) {
  for (const key of ReflectOwnKeys(src)) {
    const newKey = getNewKey(key);
    const desc = ReflectGetOwnPropertyDescriptor(src, key);
    if ('get' in desc) {
      copyAccessor(dest, prefix, newKey, desc);
    } else {
      const { value } = desc;
      if (typeof value === 'function') {
        desc.value = uncurryThis(value);
      }

      const name = `${prefix}${newKey}`;
      ReflectDefineProperty(dest, name, { __proto__: null, ...desc });
      if (varargsMethods.includes(name)) {
        ReflectDefineProperty(dest, `${name}Apply`, {
          __proto__: null,
          value: applyBind(value),
        });
      }
    }
  }
}

// Create copies of configurable value properties of the global object
['Proxy', 'globalThis'].forEach((name) => {
  primordials[name] = globalThis[name];
});

// Create copies of URI handling functions
[decodeURI, decodeURIComponent, encodeURI, encodeURIComponent].forEach((fn) => {
  primordials[fn.name] = fn;
});

// Create copies of the namespace objects
['Atomics', 'JSON', 'Math', 'Proxy', 'Reflect'].forEach((name) => {
  copyPropsRenamed(globalThis[name], primordials, name);
});

// Create copies of intrinsic objects
[
  'AggregateError',
  'Array',
  'ArrayBuffer',
  'BigInt',
  'BigInt64Array',
  'BigUint64Array',
  'Boolean',
  'DataView',
  'Date',
  'Error',
  'EvalError',
  'FinalizationRegistry',
  'Float32Array',
  'Float64Array',
  'Function',
  'Int16Array',
  'Int32Array',
  'Int8Array',
  'Map',
  'Number',
  'Object',
  'RangeError',
  'ReferenceError',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'SyntaxError',
  'TypeError',
  'URIError',
  'Uint16Array',
  'Uint32Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'WeakMap',
  'WeakRef',
  'WeakSet',
].forEach((name) => {
  const original = globalThis[name];
  primordials[name] = original;
  copyPropsRenamed(original, primordials, name);
  copyPrototype(original.prototype, primordials, `${name}Prototype`);
});

// Create copies of intrinsic objects that require a valid `this` to call
// static methods.
['Promise'].forEach((name) => {
  const original = globalThis[name];
  primordials[name] = original;
  copyPropsRenamedBound(original, primordials, name);
  copyPrototype(original.prototype, primordials, `${name}Prototype`);
});

// Create copies of abstract intrinsic objects that are not directly exposed
// on the global object.
[
  { name: 'TypedArray', original: Reflect.getPrototypeOf(Uint8Array) },
  { name: 'ArrayIterator', original: {
    prototype: Reflect.getPrototypeOf(Array.prototype[Symbol.iterator]()),
  } },
  { name: 'StringIterator', original: {
    prototype: Reflect.getPrototypeOf(String.prototype[Symbol.iterator]()),
  } },
].forEach(({ name, original }) => {
  primordials[name] = original;
  copyPrototype(original, primordials, name);
  copyPrototype(original.prototype, primordials, `${name}Prototype`);
});

primordials.IteratorPrototype = Reflect.getPrototypeOf(primordials.ArrayIteratorPrototype);

// Safe collections (simplified for testing - full version uses makeSafe)
primordials.SafeMap = Map;
primordials.SafeSet = Set;
primordials.SafeWeakMap = WeakMap;
primordials.SafeWeakSet = WeakSet;
primordials.SafeWeakRef = WeakRef;
primordials.SafeFinalizationRegistry = FinalizationRegistry;

// hardenRegExp implementation from Node.js source
const {
  ObjectDefineProperties,
  ObjectDefineProperty,
  ReflectApply,
  ReflectConstruct,
  ReflectGet,
  ReflectSet,
  RegExpPrototype,
  RegExpPrototypeExec,
  RegExpPrototypeGetDotAll,
  RegExpPrototypeGetFlags,
  RegExpPrototypeGetGlobal,
  RegExpPrototypeGetHasIndices,
  RegExpPrototypeGetIgnoreCase,
  RegExpPrototypeGetMultiline,
  RegExpPrototypeGetSource,
  RegExpPrototypeGetSticky,
  RegExpPrototypeGetUnicode,
  SymbolIterator,
  SymbolMatch,
  SymbolMatchAll,
  SymbolReplace,
  SymbolSearch,
  SymbolSpecies,
  SymbolSplit,
} = primordials;

const {
  exec: OriginalRegExpPrototypeExec,
  [SymbolMatch]: OriginalRegExpPrototypeSymbolMatch,
  [SymbolMatchAll]: OriginalRegExpPrototypeSymbolMatchAll,
  [SymbolReplace]: OriginalRegExpPrototypeSymbolReplace,
  [SymbolSearch]: OriginalRegExpPrototypeSymbolSearch,
  [SymbolSplit]: OriginalRegExpPrototypeSymbolSplit,
} = RegExpPrototype;

class RegExpLikeForStringSplitting {
  #regex;
  constructor() {
    this.#regex = ReflectConstruct(RegExp, arguments);
  }

  get lastIndex() {
    return ReflectGet(this.#regex, 'lastIndex');
  }
  set lastIndex(value) {
    ReflectSet(this.#regex, 'lastIndex', value);
  }

  exec() {
    return ReflectApply(OriginalRegExpPrototypeExec, this.#regex, arguments);
  }
}
Object.setPrototypeOf(RegExpLikeForStringSplitting.prototype, null);

/**
 * @param {RegExp} pattern
 * @returns {RegExp}
 */
primordials.hardenRegExp = function hardenRegExp(pattern) {
  ObjectDefineProperties(pattern, {
    [SymbolMatch]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolMatch,
    },
    [SymbolMatchAll]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolMatchAll,
    },
    [SymbolReplace]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolReplace,
    },
    [SymbolSearch]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolSearch,
    },
    [SymbolSplit]: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeSymbolSplit,
    },
    constructor: {
      __proto__: null,
      configurable: true,
      value: {
        [SymbolSpecies]: RegExpLikeForStringSplitting,
      },
    },
    dotAll: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetDotAll(pattern),
    },
    exec: {
      __proto__: null,
      configurable: true,
      value: OriginalRegExpPrototypeExec,
    },
    global: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetGlobal(pattern),
    },
    hasIndices: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetHasIndices(pattern),
    },
    ignoreCase: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetIgnoreCase(pattern),
    },
    multiline: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetMultiline(pattern),
    },
    source: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetSource(pattern),
    },
    sticky: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetSticky(pattern),
    },
    unicode: {
      __proto__: null,
      configurable: true,
      value: RegExpPrototypeGetUnicode(pattern),
    },
  });
  ObjectDefineProperty(pattern, 'flags', {
    __proto__: null,
    configurable: true,
    value: RegExpPrototypeGetFlags(pattern),
  });
  return pattern;
};

/**
 * @param {string} str
 * @param {RegExp} regexp
 * @returns {number}
 */
primordials.SafeStringPrototypeSearch = (str, regexp) => {
  regexp.lastIndex = 0;
  const match = RegExpPrototypeExec(regexp, str);
  return match ? match.index : -1;
};

Object.setPrototypeOf(primordials, null);
Object.freeze(primordials);
