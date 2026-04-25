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

// Hoist prototype refs so each entry below is a one-liner instead of
// typing `Array.prototype.X` / `String.prototype.X` repeatedly.
const ArrayProto = Array.prototype
const DateProto = Date.prototype
const FunctionProto = Function.prototype
const MapProto = Map.prototype
const NumberProto = Number.prototype
const RegExpProto = RegExp.prototype
const SetProto = Set.prototype
const StringProto = String.prototype
const URLSearchParamsProto = URLSearchParams.prototype

globalThis.primordials = {
  __proto__: null,

  // Array
  Array,
  ArrayFrom: Array.from.bind(Array),
  ArrayIsArray: Array.isArray,
  ArrayPrototypeAt: uncurryThis(ArrayProto.at),
  ArrayPrototypeConcat: uncurryThis(ArrayProto.concat),
  ArrayPrototypeEvery: uncurryThis(ArrayProto.every),
  ArrayPrototypeFilter: uncurryThis(ArrayProto.filter),
  ArrayPrototypeFind: uncurryThis(ArrayProto.find),
  ArrayPrototypeFindIndex: uncurryThis(ArrayProto.findIndex),
  ArrayPrototypeFlat: uncurryThis(ArrayProto.flat),
  ArrayPrototypeForEach: uncurryThis(ArrayProto.forEach),
  ArrayPrototypeIncludes: uncurryThis(ArrayProto.includes),
  ArrayPrototypeIndexOf: uncurryThis(ArrayProto.indexOf),
  ArrayPrototypeJoin: uncurryThis(ArrayProto.join),
  ArrayPrototypeMap: uncurryThis(ArrayProto.map),
  ArrayPrototypePop: uncurryThis(ArrayProto.pop),
  ArrayPrototypePush: uncurryThis(ArrayProto.push),
  ArrayPrototypeReduce: uncurryThis(ArrayProto.reduce),
  ArrayPrototypeReverse: uncurryThis(ArrayProto.reverse),
  ArrayPrototypeShift: uncurryThis(ArrayProto.shift),
  ArrayPrototypeSlice: uncurryThis(ArrayProto.slice),
  ArrayPrototypeSome: uncurryThis(ArrayProto.some),
  ArrayPrototypeSort: uncurryThis(ArrayProto.sort),
  ArrayPrototypeSplice: uncurryThis(ArrayProto.splice),
  ArrayPrototypeUnshift: uncurryThis(ArrayProto.unshift),

  // ArrayBuffer
  ArrayBufferIsView: ArrayBuffer.isView.bind(ArrayBuffer),

  // BigInt
  BigInt,

  // Boolean
  Boolean,

  // Date
  Date,
  DateNow: Date.now.bind(Date),
  DatePrototypeGetTime: uncurryThis(DateProto.getTime),

  // Error
  Error,
  ErrorCaptureStackTrace: Error.captureStackTrace?.bind(Error) ?? (() => {}),

  // Function
  FunctionPrototypeBind: uncurryThis(FunctionProto.bind),
  FunctionPrototypeCall: uncurryThis(FunctionProto.call),

  // JSON
  JSONParse: JSON.parse,
  JSONStringify: JSON.stringify,

  // Iterator (shared prototype of Array/Map/Set iterators)
  IteratorPrototypeNext: uncurryThis(
    Object.getPrototypeOf(Object.getPrototypeOf([].keys())).next,
  ),
  IteratorPrototypeReturn: uncurryThis(
    Object.getPrototypeOf(Object.getPrototypeOf([].keys())).return ??
      function () {
        return { value: undefined, done: true }
      },
  ),

  // Map
  Map,
  MapPrototypeClear: uncurryThis(MapProto.clear),
  MapPrototypeDelete: uncurryThis(MapProto.delete),
  MapPrototypeEntries: uncurryThis(MapProto.entries),
  MapPrototypeForEach: uncurryThis(MapProto.forEach),
  MapPrototypeGet: uncurryThis(MapProto.get),
  MapPrototypeHas: uncurryThis(MapProto.has),
  MapPrototypeKeys: uncurryThis(MapProto.keys),
  MapPrototypeSet: uncurryThis(MapProto.set),
  MapPrototypeValues: uncurryThis(MapProto.values),

  // Math
  MathAbs: Math.abs,
  MathCeil: Math.ceil,
  MathFloor: Math.floor,
  MathImul: Math.imul,
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
  NumberPrototypeToFixed: uncurryThis(NumberProto.toFixed),
  NumberPrototypeToString: uncurryThis(NumberProto.toString),

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
  RegExpPrototypeExec: uncurryThis(RegExpProto.exec),
  RegExpPrototypeTest: uncurryThis(RegExpProto.test),
  RegExpPrototypeSymbolMatch: uncurryThis(RegExpProto[Symbol.match]),
  RegExpPrototypeSymbolReplace: uncurryThis(RegExpProto[Symbol.replace]),

  // Set
  Set,
  SetPrototypeAdd: uncurryThis(SetProto.add),
  SetPrototypeDelete: uncurryThis(SetProto.delete),
  SetPrototypeForEach: uncurryThis(SetProto.forEach),
  SetPrototypeHas: uncurryThis(SetProto.has),

  // String
  String,
  StringPrototypeCharCodeAt: uncurryThis(StringProto.charCodeAt),
  StringPrototypeEndsWith: uncurryThis(StringProto.endsWith),
  StringPrototypeIncludes: uncurryThis(StringProto.includes),
  StringPrototypeIndexOf: uncurryThis(StringProto.indexOf),
  StringPrototypeLastIndexOf: uncurryThis(StringProto.lastIndexOf),
  StringPrototypeMatch: uncurryThis(StringProto.match),
  StringPrototypePadStart: uncurryThis(StringProto.padStart),
  StringPrototypeRepeat: uncurryThis(StringProto.repeat),
  StringPrototypeReplace: uncurryThis(StringProto.replace),
  StringPrototypeReplaceAll: uncurryThis(StringProto.replaceAll),
  StringPrototypeSlice: uncurryThis(StringProto.slice),
  StringPrototypeSplit: uncurryThis(StringProto.split),
  StringPrototypeStartsWith: uncurryThis(StringProto.startsWith),
  StringPrototypeSubstring: uncurryThis(StringProto.substring),
  StringPrototypeToLowerCase: uncurryThis(StringProto.toLowerCase),
  StringPrototypeToUpperCase: uncurryThis(StringProto.toUpperCase),
  StringPrototypeTrim: uncurryThis(StringProto.trim),
  StringPrototypeTrimEnd: uncurryThis(StringProto.trimEnd),
  StringPrototypeTrimStart: uncurryThis(StringProto.trimStart),

  // Symbol
  Symbol,
  SymbolFor: Symbol.for,
  SymbolIterator: Symbol.iterator,
  SymbolToStringTag: Symbol.toStringTag,

  // TypeError
  TypeError,

  // URL
  URL,
  URLSearchParamsPrototypeForEach: uncurryThis(URLSearchParamsProto.forEach),

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
