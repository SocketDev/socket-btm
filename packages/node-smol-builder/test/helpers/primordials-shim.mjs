/**
 * Primordials shim for vitest.
 *
 * Node.js internal modules use `primordials` (a frozen set of built-in
 * prototypes captured before user code runs). This shim provides the
 * same API so additions/ JS files can be imported in vitest.
 */

const uncurryThis =
  fn =>
  (thisArg, ...args) =>
    fn.call(thisArg, ...args)
const uncurryThisGetter = (obj, key) => {
  const desc = Object.getOwnPropertyDescriptor(obj, key)
  if (desc && desc.get) return thisArg => desc.get.call(thisArg)
  return thisArg => thisArg[key]
}

globalThis.primordials = {
  __proto__: null,

  // Array
  Array,
  ArrayFrom: Array.from.bind(Array),
  ArrayIsArray: Array.isArray,
  ArrayPrototypeAt: uncurryThis(Array.prototype.at),
  ArrayPrototypeConcat: uncurryThis(Array.prototype.concat),
  ArrayPrototypeEvery: uncurryThis(Array.prototype.every),
  ArrayPrototypeFilter: uncurryThis(Array.prototype.filter),
  ArrayPrototypeFind: uncurryThis(Array.prototype.find),
  ArrayPrototypeFindIndex: uncurryThis(Array.prototype.findIndex),
  ArrayPrototypeFlat: uncurryThis(Array.prototype.flat),
  ArrayPrototypeForEach: uncurryThis(Array.prototype.forEach),
  ArrayPrototypeIncludes: uncurryThis(Array.prototype.includes),
  ArrayPrototypeIndexOf: uncurryThis(Array.prototype.indexOf),
  ArrayPrototypeJoin: uncurryThis(Array.prototype.join),
  ArrayPrototypeMap: uncurryThis(Array.prototype.map),
  ArrayPrototypePop: uncurryThis(Array.prototype.pop),
  ArrayPrototypePush: uncurryThis(Array.prototype.push),
  ArrayPrototypeReduce: uncurryThis(Array.prototype.reduce),
  ArrayPrototypeShift: uncurryThis(Array.prototype.shift),
  ArrayPrototypeSlice: uncurryThis(Array.prototype.slice),
  ArrayPrototypeSome: uncurryThis(Array.prototype.some),
  ArrayPrototypeSort: uncurryThis(Array.prototype.sort),
  ArrayPrototypeSplice: uncurryThis(Array.prototype.splice),
  ArrayPrototypeUnshift: uncurryThis(Array.prototype.unshift),

  // ArrayBuffer
  ArrayBufferIsView: ArrayBuffer.isView.bind(ArrayBuffer),

  // BigInt
  BigInt,

  // Boolean
  Boolean,

  // Date
  Date,
  DateNow: Date.now.bind(Date),
  DatePrototypeGetTime: uncurryThis(Date.prototype.getTime),

  // Error
  Error,
  ErrorCaptureStackTrace: Error.captureStackTrace?.bind(Error) ?? (() => {}),

  // Function
  FunctionPrototypeBind: uncurryThis(Function.prototype.bind),
  FunctionPrototypeCall: uncurryThis(Function.prototype.call),

  // JSON
  JSONParse: JSON.parse,
  JSONStringify: JSON.stringify,

  // Map
  Map,
  MapPrototypeDelete: uncurryThis(Map.prototype.delete),
  MapPrototypeEntries: uncurryThis(Map.prototype.entries),
  MapPrototypeForEach: uncurryThis(Map.prototype.forEach),
  MapPrototypeGet: uncurryThis(Map.prototype.get),
  MapPrototypeHas: uncurryThis(Map.prototype.has),
  MapPrototypeKeys: uncurryThis(Map.prototype.keys),
  MapPrototypeSet: uncurryThis(Map.prototype.set),
  MapPrototypeValues: uncurryThis(Map.prototype.values),

  // Math
  MathAbs: Math.abs,
  MathCeil: Math.ceil,
  MathFloor: Math.floor,
  MathMax: Math.max,
  MathMin: Math.min,
  MathRound: Math.round,

  // Number
  Number,
  NumberIsFinite: Number.isFinite,
  NumberIsInteger: Number.isInteger,
  NumberIsNaN: Number.isNaN,
  NumberIsSafeInteger: Number.isSafeInteger,
  NumberParseFloat: Number.parseFloat,
  NumberParseInt: Number.parseInt,

  // Object
  ObjectAssign: Object.assign,
  ObjectCreate: Object.create,
  ObjectDefineProperties: Object.defineProperties,
  ObjectDefineProperty: Object.defineProperty,
  ObjectEntries: Object.entries,
  ObjectFreeze: Object.freeze,
  ObjectGetOwnPropertyDescriptor: Object.getOwnPropertyDescriptor,
  ObjectGetOwnPropertyNames: Object.getOwnPropertyNames,
  ObjectGetPrototypeOf: Object.getPrototypeOf,
  ObjectHasOwn: Object.hasOwn,
  ObjectKeys: Object.keys,
  ObjectSetPrototypeOf: Object.setPrototypeOf,
  ObjectValues: Object.values,

  // RegExp
  RegExp,
  RegExpPrototypeExec: uncurryThis(RegExp.prototype.exec),
  RegExpPrototypeTest: uncurryThis(RegExp.prototype.test),
  RegExpPrototypeSymbolMatch: uncurryThis(RegExp.prototype[Symbol.match]),
  RegExpPrototypeSymbolReplace: uncurryThis(RegExp.prototype[Symbol.replace]),

  // Set
  Set,
  SetPrototypeAdd: uncurryThis(Set.prototype.add),
  SetPrototypeDelete: uncurryThis(Set.prototype.delete),
  SetPrototypeHas: uncurryThis(Set.prototype.has),

  // String
  String,
  StringPrototypeCharCodeAt: uncurryThis(String.prototype.charCodeAt),
  StringPrototypeEndsWith: uncurryThis(String.prototype.endsWith),
  StringPrototypeIncludes: uncurryThis(String.prototype.includes),
  StringPrototypeIndexOf: uncurryThis(String.prototype.indexOf),
  StringPrototypeLastIndexOf: uncurryThis(String.prototype.lastIndexOf),
  StringPrototypeMatch: uncurryThis(String.prototype.match),
  StringPrototypePadStart: uncurryThis(String.prototype.padStart),
  StringPrototypeRepeat: uncurryThis(String.prototype.repeat),
  StringPrototypeReplace: uncurryThis(String.prototype.replace),
  StringPrototypeReplaceAll: uncurryThis(String.prototype.replaceAll),
  StringPrototypeSlice: uncurryThis(String.prototype.slice),
  StringPrototypeSplit: uncurryThis(String.prototype.split),
  StringPrototypeStartsWith: uncurryThis(String.prototype.startsWith),
  StringPrototypeToLowerCase: uncurryThis(String.prototype.toLowerCase),
  StringPrototypeToUpperCase: uncurryThis(String.prototype.toUpperCase),
  StringPrototypeTrim: uncurryThis(String.prototype.trim),
  StringPrototypeTrimEnd: uncurryThis(String.prototype.trimEnd),
  StringPrototypeTrimStart: uncurryThis(String.prototype.trimStart),

  // Symbol
  Symbol,
  SymbolFor: Symbol.for,
  SymbolIterator: Symbol.iterator,
  SymbolToStringTag: Symbol.toStringTag,

  // TypeError
  TypeError,

  // URL
  URL,
  URLSearchParamsPrototypeForEach: uncurryThis(
    URLSearchParams.prototype.forEach,
  ),

  // Safe collections (in test shim, just use regular Map/Set)
  SafeMap: Map,
  SafeSet: Set,
  SafeWeakMap: WeakMap,
  SafeWeakSet: WeakSet,

  // URI encoding/decoding
  decodeURIComponent,
  encodeURIComponent,

  // Utilities
  hardenRegExp: re => re,
  uncurryThis,
}
