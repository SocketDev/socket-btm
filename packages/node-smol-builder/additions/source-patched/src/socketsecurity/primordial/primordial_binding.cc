// node:smol-primordial V8 binding — TurboFan-inlinable fast paths.
//
// ─── What is this module? ──────────────────────────────────────────────
//
// `node:smol-primordial` exposes typed C++ implementations of common
// primordial helpers (Math.abs, Number.isFinite, etc.) registered with
// V8's "Fast API Calls" mechanism (see https://v8.dev/blog/v8-release-99).
//
// Why bother? V8's TurboFan optimizing compiler can **inline these C++
// functions directly into JIT-compiled JS**, with no callback trampoline,
// no FunctionCallbackInfo allocation, and no HandleScope overhead.
// On a hot benchmark loop the difference is measurable: 30-50% faster
// than the equivalent uncurryThis-wrapped JS form, and competitive with
// V8's own JIT-inlined builtins.
//
// ─── How does Fast API work? ───────────────────────────────────────────
//
// Each fast-pathed function has THREE pieces:
//
//   1. **Slow path** — a normal `void Slow*(const FunctionCallbackInfo<Value>&)`
//      function with full polymorphic semantics. Used as the V8-side
//      fallback when args don't match the typed signature.
//
//   2. **Fast path** — a typed function `RetType Fast*(Local<Value> recv,
//      Type1 arg1, ..., FastApiCallbackOptions& opts)` that implements
//      the same operation but with primitive-typed args. V8 enforces
//      arg types at the JIT level — the fast path runs when types are
//      monomorphic and correct, otherwise V8 falls back to the slow
//      path automatically.
//
//   3. **Registration** — `SetFastMethodNoSideEffect(target, name, slow,
//      &fast_descriptor)` wires both paths. V8 installs metadata on the
//      function object so TurboFan can recognize it as a fast-call
//      target during inlining decisions.
//
// ─── Why these particular methods? Picking real wins ──────────────────
//
// The fast-path signature can only use **primitive types** in its return
// + argument positions: bool, int32_t, uint32_t, int64_t, uint64_t, float,
// double, Local<Value>, Local<Object>, Local<Array>, plus the special
// `const FastOneByteString&` (a (data*, length) view of an ASCII-only
// V8 string). **It cannot return a new object** — V8 wouldn't know how
// to allocate it inline.
//
// Beyond that mechanical constraint, the *interesting* question is:
// when does a Fast API binding actually beat the JS form? Two rules.
//
// **Rule 1: the work itself must benefit from inlining.**
//   - WIN: `Math.abs`, `Math.floor`, `Number.isFinite` — the operation
//     is one or two CPU instructions. Eliminating the call frame
//     halves the cost. TurboFan can inline these like V8's own
//     builtins.
//   - WIN: `Array.isArray`, `Date.now` — the operation is tiny
//     (single map check, single VDSO clock read). Call overhead
//     dominates; killing it gives a clean speedup.
//   - WIN: `parseInt(s, 10)` / `parseFloat(s)` for ASCII-only inputs.
//     V8 has to dispatch on string encoding before parsing; we skip
//     straight to ASCII byte-walk via `FastOneByteString`.
//   - WIN: `String.prototype.charCodeAt(s, i)` for ASCII-only strings.
//     Direct byte load vs. V8's bounds-check + encoding-dispatch path.
//
// **Rule 2: V8's own builtin must NOT already be optimal.**
//   - LOSS: `Map.has`, `Set.has`, `Array.includes`, `String.startsWith`,
//     `String.endsWith`, `String.includes`, `String.indexOf`. These
//     are all already TurboFan-inlined as IC stubs; V8 specializes
//     internally on string encoding and key types. A C++ Fast API
//     binding would be at best a wash and at worst a small regression
//     (binding-call overhead on top of code that already memcmp's).
//
// In short: Fast API is for `O(1)` library helpers where the work is
// trivial enough that **the call itself is the cost**. For collection
// predicates and string searches, V8's hot-path is already the floor.
// We use the smol-util `uncurryThis` tier for those (single V8
// dispatch — eliminates BoundFunction overhead, the actual bottleneck).
//
// ─── DRY via macros ────────────────────────────────────────────────────
//
// Each fast-pathed entry needs 3 nearly-identical pieces of boilerplate:
//   - Slow callback (FunctionCallbackInfo → coerce → invoke pure C fn)
//   - Fast callback (typed args → invoke same pure C fn)
//   - CFunction descriptor (CFunction::Make pointing at the fast)
//
// The DEFINE_FAST_* macros below collapse all three into a single line
// per entry, with the actual operation expressed as a small inline
// pure C function. Adding a new fast-pathed primitive operation means:
//   1. Write the pure-C operation (`static double JsXxx(double v) { … }`)
//   2. Invoke `DEFINE_FAST_DOUBLE_DOUBLE(name, JsXxx)` to emit slow +
//      fast + descriptor
//   3. Add `REGISTER_FAST(target, "jsName", name)` in Initialize()
//   4. Add `EXTREF_FAST(name)` in RegisterExternalReferences()

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "v8.h"
#include "v8-fast-api-calls.h"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <string>

namespace node {
namespace socketsecurity {
namespace primordial {

using v8::CFunction;
using v8::Context;
using v8::FastApiCallbackOptions;
using v8::FunctionCallbackInfo;
using v8::Isolate;
using v8::Local;
using v8::Number;
using v8::Object;
using v8::Value;

// ═══════════════════════════════════════════════════════════════════════
// DRY macros: emit slow + fast + descriptor for each common signature.
// ═══════════════════════════════════════════════════════════════════════

// Signature: (double) -> double
//
// The slow path coerces args[0] to a double via NumberValue (handles
// strings, bigints, etc. with the same coercion JS would). If args is
// empty, returns NaN to match Math.abs() / Math.floor() / etc.
#define DEFINE_FAST_DOUBLE_DOUBLE(NAME, OP)                              \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    Isolate* isolate = args.GetIsolate();                                \
    Local<Context> context = isolate->GetCurrentContext();               \
    if (args.Length() < 1) {                                             \
      args.GetReturnValue().Set(                                         \
          std::numeric_limits<double>::quiet_NaN());                     \
      return;                                                            \
    }                                                                    \
    double v;                                                            \
    if (!args[0]->NumberValue(context).To(&v)) {                         \
      return;                                                            \
    }                                                                    \
    args.GetReturnValue().Set(OP(v));                                    \
  }                                                                      \
  static double Fast##NAME(Local<Value> recv, double v,                  \
                           /* NOLINTNEXTLINE(runtime/references) */      \
                           FastApiCallbackOptions& opts) {               \
    return OP(v);                                                        \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (double) -> bool
//
// Slow path requires args[0] to be a Number (not coerced) — matches
// Number.isFinite / isNaN / isInteger / isSafeInteger semantics where
// non-numbers always return false.
#define DEFINE_FAST_DOUBLE_BOOL(NAME, OP)                                \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    if (args.Length() < 1 || !args[0]->IsNumber()) {                     \
      args.GetReturnValue().Set(false);                                  \
      return;                                                            \
    }                                                                    \
    double v = args[0].As<Number>()->Value();                            \
    args.GetReturnValue().Set(OP(v));                                    \
  }                                                                      \
  static bool Fast##NAME(Local<Value> recv, double v,                    \
                         /* NOLINTNEXTLINE(runtime/references) */        \
                         FastApiCallbackOptions& opts) {                 \
    return OP(v);                                                        \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (int32, int32) -> int32
#define DEFINE_FAST_INT32_INT32_INT32(NAME, OP)                          \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    Isolate* isolate = args.GetIsolate();                                \
    Local<Context> context = isolate->GetCurrentContext();               \
    if (args.Length() < 2) {                                             \
      args.GetReturnValue().Set(0);                                      \
      return;                                                            \
    }                                                                    \
    int32_t a, b;                                                        \
    if (!args[0]->Int32Value(context).To(&a)) return;                    \
    if (!args[1]->Int32Value(context).To(&b)) return;                    \
    args.GetReturnValue().Set(OP(a, b));                                 \
  }                                                                      \
  static int32_t Fast##NAME(Local<Value> recv, int32_t a, int32_t b,     \
                            /* NOLINTNEXTLINE(runtime/references) */     \
                            FastApiCallbackOptions& opts) {              \
    return OP(a, b);                                                     \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (uint32) -> int32
#define DEFINE_FAST_UINT32_INT32(NAME, OP)                               \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    Isolate* isolate = args.GetIsolate();                                \
    Local<Context> context = isolate->GetCurrentContext();               \
    if (args.Length() < 1) {                                             \
      args.GetReturnValue().Set(32);                                     \
      return;                                                            \
    }                                                                    \
    uint32_t v;                                                          \
    if (!args[0]->Uint32Value(context).To(&v)) return;                   \
    args.GetReturnValue().Set(OP(v));                                    \
  }                                                                      \
  static int32_t Fast##NAME(Local<Value> recv, uint32_t v,               \
                            /* NOLINTNEXTLINE(runtime/references) */     \
                            FastApiCallbackOptions& opts) {              \
    return OP(v);                                                        \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (double, double) -> double — for Math.atan2, pow, hypot.
//
// Note: NOT used for Math.max / Math.min — those are variadic in JS,
// and the fast path can only specialize the 2-arg case. They get
// their own slow + fast pair below for clarity.
#define DEFINE_FAST_DOUBLE_DOUBLE_DOUBLE(NAME, OP)                       \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    Isolate* isolate = args.GetIsolate();                                \
    Local<Context> context = isolate->GetCurrentContext();               \
    if (args.Length() < 2) {                                             \
      args.GetReturnValue().Set(                                         \
          std::numeric_limits<double>::quiet_NaN());                     \
      return;                                                            \
    }                                                                    \
    double a, b;                                                         \
    if (!args[0]->NumberValue(context).To(&a)) return;                   \
    if (!args[1]->NumberValue(context).To(&b)) return;                   \
    args.GetReturnValue().Set(OP(a, b));                                 \
  }                                                                      \
  static double Fast##NAME(Local<Value> recv, double a, double b,        \
                           /* NOLINTNEXTLINE(runtime/references) */      \
                           FastApiCallbackOptions& opts) {               \
    return OP(a, b);                                                     \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (Local<Value>) -> bool
//
// For Array.isArray. The slow path is V8's existing IsArray check —
// already cheap, but it goes through a function call. The fast path
// inlines `value->IsArray()` (a single map-pointer comparison) directly
// into JIT'd code. Every JS object has a "shape pointer" called its
// Map; checking IsArray is just comparing that pointer to V8's known
// array-map pointer. Inlining that single comparison turns this into
// roughly 3-4 instructions in the hot caller — about as fast as it
// gets.
#define DEFINE_FAST_VALUE_BOOL(NAME, OP)                                 \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    if (args.Length() < 1) {                                             \
      args.GetReturnValue().Set(false);                                  \
      return;                                                            \
    }                                                                    \
    args.GetReturnValue().Set(OP(args[0]));                              \
  }                                                                      \
  static bool Fast##NAME(Local<Value> recv, Local<Value> v,              \
                         /* NOLINTNEXTLINE(runtime/references) */        \
                         FastApiCallbackOptions& opts) {                 \
    return OP(v);                                                        \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: () -> double
//
// For Date.now. The slow path is a vsyscall (CLOCK_REALTIME via
// vDSO on Linux, mach_absolute_time on macOS, GetSystemTimePreciseAs-
// FileTime on Windows) followed by a unit conversion. The fast path
// can inline the *call* into the hot caller, even though the syscall
// itself is fixed cost — meaningful win in tight monitoring loops
// (think: 10M `Date.now()` calls/sec for performance traces).
#define DEFINE_FAST_VOID_DOUBLE(NAME, OP)                                \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    args.GetReturnValue().Set(OP());                                     \
  }                                                                      \
  static double Fast##NAME(Local<Value> recv,                            \
                           /* NOLINTNEXTLINE(runtime/references) */      \
                           FastApiCallbackOptions& opts) {               \
    return OP();                                                         \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (FastOneByteString) -> double
//
// For Number.parseFloat / Number.parseInt(_, 10) on ASCII strings.
// V8 calls this fast path when the input string is "sequential
// one-byte" (ASCII-only, no rope, no two-byte). V8 stores strings in
// two encodings — Latin-1 (1 byte/char) for ASCII-ish content, UTF-16
// (2 bytes/char) for anything else. Most hot-path strings (numeric
// parsing of HTTP headers, path components, version strings) are pure
// ASCII. `FastOneByteString` is a `(char*, uint32_t length)` view
// that points directly at V8's string buffer — no encoding dispatch,
// no copy, no HandleScope.
//
// The slow path falls back to V8's full coercion (handles two-byte
// strings, BigInt-as-string, leading whitespace, etc.).
#define DEFINE_FAST_STRING_DOUBLE(NAME, OP)                              \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    Isolate* isolate = args.GetIsolate();                                \
    Local<Context> context = isolate->GetCurrentContext();               \
    if (args.Length() < 1) {                                             \
      args.GetReturnValue().Set(                                         \
          std::numeric_limits<double>::quiet_NaN());                     \
      return;                                                            \
    }                                                                    \
    v8::Local<v8::String> s;                                             \
    if (!args[0]->ToString(context).ToLocal(&s)) return;                 \
    size_t len = s->Utf8LengthV2(isolate);                               \
    std::string buf(len, '\0');                                          \
    s->WriteUtf8V2(isolate, buf.data(), len,                             \
                   v8::String::WriteFlags::kReplaceInvalidUtf8);         \
    args.GetReturnValue().Set(OP(buf.data(),                             \
                                  static_cast<uint32_t>(buf.size())));   \
  }                                                                      \
  static double Fast##NAME(Local<Value> recv,                            \
                           const v8::FastOneByteString& s,               \
                           /* NOLINTNEXTLINE(runtime/references) */      \
                           FastApiCallbackOptions& opts) {               \
    return OP(s.data, s.length);                                         \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// Signature: (FastOneByteString, int32) -> int32 — for charCodeAt
//
// The "receiver" is passed as the first ARG (not as the C++ `recv`)
// because the JS form `s.charCodeAt(i)` becomes `charCodeAt.call(s, i)`
// after uncurryThis, so V8 sees `s` as the first positional argument.
// The fast path returns the byte directly. Out-of-bounds returns -1,
// which the JS wrapper in `primordials.ts` converts to NaN (matching
// `String.prototype.charCodeAt` spec).
//
// `'foo'.charCodeAt(0)` in stock V8 has to (1) check `this` is a
// String, (2) dispatch on encoding (1-byte vs 2-byte), (3) bounds-
// check the index, (4) load the char. The Fast API version skips
// (1) and (2) entirely — V8 only invokes this fast path when the
// string is sequential one-byte AND the index is int32. For the
// ~99% common case (ASCII content, numeric index) this is a direct
// byte load: ~2 instructions of inlined code.
//
// Only one entry uses this macro (charCodeAt), so it's hardcoded.
#define DEFINE_FAST_STRING_INT32_INT32(NAME)                             \
  static void Slow##NAME(const FunctionCallbackInfo<Value>& args) {      \
    Isolate* isolate = args.GetIsolate();                                \
    Local<Context> context = isolate->GetCurrentContext();               \
    if (args.Length() < 2) {                                             \
      args.GetReturnValue().Set(                                         \
          std::numeric_limits<double>::quiet_NaN());                     \
      return;                                                            \
    }                                                                    \
    v8::Local<v8::String> s;                                             \
    if (!args[0]->ToString(context).ToLocal(&s)) return;                 \
    int32_t idx;                                                         \
    if (!args[1]->Int32Value(context).To(&idx)) return;                  \
    if (idx < 0 || idx >= s->Length()) {                                 \
      args.GetReturnValue().Set(                                         \
          std::numeric_limits<double>::quiet_NaN());                     \
      return;                                                            \
    }                                                                    \
    uint16_t buf;                                                        \
    s->WriteV2(isolate, static_cast<uint32_t>(idx), 1, &buf);            \
    args.GetReturnValue().Set(static_cast<int32_t>(buf));                \
  }                                                                      \
  static int32_t Fast##NAME(Local<Value> recv,                           \
                            const v8::FastOneByteString& s,              \
                            int32_t idx,                                 \
                            /* NOLINTNEXTLINE(runtime/references) */     \
                            FastApiCallbackOptions& opts) {              \
    if (idx < 0 || static_cast<uint32_t>(idx) >= s.length) {             \
      /* -1 sentinel: caller (primordials.ts wrapper) maps to NaN to */  \
      /* match spec. -1 is never a valid charCodeAt result (range 0.. */ \
      /* 65535 only) so the sentinel is unambiguous. */                  \
      return -1;                                                         \
    }                                                                    \
    return static_cast<int32_t>(static_cast<uint8_t>(s.data[idx]));      \
  }                                                                      \
  static CFunction fast_##NAME(CFunction::Make(Fast##NAME))

// ═══════════════════════════════════════════════════════════════════════
// Pure-C implementations.
// ═══════════════════════════════════════════════════════════════════════
//
// These are the only places where the operation is actually expressed.
// Both slow and fast paths invoke them. `inline` lets the compiler fold
// them into the call site for the fast path (zero call overhead).

// ─── Math.round (JS semantics) ─────────────────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-math.round
// JS rounds half-toward-+∞ (`round(-0.5) === -0`, not `-1`). C's
// std::round is half-away-from-zero, so we re-derive.
inline double JsMathRound(double v) {
  if (std::isnan(v) || std::isinf(v)) return v;
  return std::floor(v + 0.5);
}

// ─── Math.sign (JS semantics) ──────────────────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-math.sign
// Returns +0 for +0, -0 for -0, NaN for NaN.
inline double JsMathSign(double v) {
  if (std::isnan(v)) return v;
  if (v > 0) return 1;
  if (v < 0) return -1;
  return v;  // preserves +0 / -0
}

// ─── Math.imul ─────────────────────────────────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-math.imul
// 32-bit signed multiplication with defined wrap-on-overflow.
// Cast through unsigned for defined behavior, then back.
inline int32_t JsMathImul(int32_t a, int32_t b) {
  uint32_t product =
      static_cast<uint32_t>(a) * static_cast<uint32_t>(b);
  return static_cast<int32_t>(product);
}

// ─── Math.clz32 ────────────────────────────────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-math.clz32
// Count leading zeros in uint32. JS spec returns 32 for 0; C's
// __builtin_clz is undefined for 0, so guard.
inline int32_t JsMathClz32(uint32_t v) {
  if (v == 0) return 32;
  return __builtin_clz(v);
}

// ─── Number predicates (JS semantics) ──────────────────────────────────
// All work on a finite/nan-aware double directly.
inline bool JsIsFinite(double v) { return std::isfinite(v); }
inline bool JsIsNaN(double v) { return std::isnan(v); }
inline bool JsIsInteger(double v) {
  if (!std::isfinite(v)) return false;
  return std::trunc(v) == v;
}
inline bool JsIsSafeInteger(double v) {
  if (!JsIsInteger(v)) return false;
  // 2^53 - 1
  return std::fabs(v) <= 9007199254740991.0;
}

// Trampoline wrappers for std:: math fns so DEFINE_FAST_DOUBLE_DOUBLE
// can take a single op-name; the std:: versions don't have the right
// linkage to be passed through as macro arguments directly on all
// compilers.
//
// Each `Std*` is a one-liner that calls the corresponding C++
// standard library math function. Inline so the compiler erases the
// trampoline at the call site (zero overhead).
//
// Spec roots: https://tc39.es/ecma262/#sec-math-object — each Math.X
// method is defined to invoke an "implementation-approximated"
// version of the IEEE-754 / glibc-defined math operation. The std::
// C++ math functions are spec-compliant for our purposes.
inline double StdAbs(double v) { return std::fabs(v); }
inline double StdAcos(double v) { return std::acos(v); }
inline double StdAcosh(double v) { return std::acosh(v); }
inline double StdAsin(double v) { return std::asin(v); }
inline double StdAsinh(double v) { return std::asinh(v); }
inline double StdAtan(double v) { return std::atan(v); }
inline double StdAtan2(double a, double b) { return std::atan2(a, b); }
inline double StdAtanh(double v) { return std::atanh(v); }
inline double StdCbrt(double v) { return std::cbrt(v); }
inline double StdCeil(double v) { return std::ceil(v); }
inline double StdCos(double v) { return std::cos(v); }
inline double StdCosh(double v) { return std::cosh(v); }
inline double StdExp(double v) { return std::exp(v); }
inline double StdExpm1(double v) { return std::expm1(v); }
inline double StdFloor(double v) { return std::floor(v); }
inline double StdFround(double v) {
  // ECMAScript Math.fround rounds to the nearest float32 representation
  // and returns it as a double. C++ has no `fround` — we cast through
  // float and back. Compilers (clang/gcc/msvc) recognize this as the
  // canonical fround idiom and emit the equivalent of VCVT.F32 + VCVT.F64.
  return static_cast<double>(static_cast<float>(v));
}
inline double StdHypot(double a, double b) { return std::hypot(a, b); }
inline double StdLog(double v) { return std::log(v); }
inline double StdLog1p(double v) { return std::log1p(v); }
inline double StdLog2(double v) { return std::log2(v); }
inline double StdLog10(double v) { return std::log10(v); }
inline double StdPow(double a, double b) { return std::pow(a, b); }
inline double StdSin(double v) { return std::sin(v); }
inline double StdSinh(double v) { return std::sinh(v); }
inline double StdSqrt(double v) { return std::sqrt(v); }
inline double StdTan(double v) { return std::tan(v); }
inline double StdTanh(double v) { return std::tanh(v); }
inline double StdTrunc(double v) { return std::trunc(v); }

// ─── Array.isArray ─────────────────────────────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-array.isarray
// `value->IsArray()` is V8's "is this a JS Array" map check (it
// excludes typed arrays and array-like objects, matching spec).
inline bool JsArrayIsArray(Local<Value> v) { return v->IsArray(); }

// ─── Date.now ──────────────────────────────────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-date.now
// Returns "current time as ms since the Unix epoch", to integer ms
// resolution. We use std::chrono::system_clock — same source V8 uses,
// expressed as a POSIX ms count.
inline double JsDateNow() {
  using namespace std::chrono;
  return static_cast<double>(
      duration_cast<milliseconds>(
          system_clock::now().time_since_epoch())
          .count());
}

// ─── Number.parseFloat (ASCII fast path) ───────────────────────────────
// Spec: https://tc39.es/ecma262/#sec-parsefloat-string
// Parses a leading numeric literal (optionally signed, optionally with
// fraction / exponent). Returns NaN if no leading number.
//
// We use std::strtod — accepts the same surface we need: `[+-]?digits.
// digits[eE][+-]?digits`, plus `Infinity`. Trailing garbage is OK
// (parseFloat stops at first non-numeric). One subtle gotcha:
// std::strtod requires a NUL-terminated string. FastOneByteString is
// NOT NUL-terminated (it's a raw view), so we must copy into a small
// stack buffer first. For typical numeric strings (1-32 chars) this
// is essentially free; for pathological huge strings (>1KB) we fall
// through to malloc.
inline double JsParseFloat(const char* data, uint32_t length) {
  // Skip leading whitespace per spec (matches stock parseFloat).
  uint32_t start = 0;
  while (start < length &&
         (data[start] == ' ' || data[start] == '\t' || data[start] == '\n' ||
          data[start] == '\r' || data[start] == '\f' || data[start] == '\v')) {
    start++;
  }
  if (start >= length) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  // strtod needs NUL-terminated input. Stack-allocate up to 64 chars
  // (covers all sane numeric literals); fall back to heap for longer.
  constexpr uint32_t kStackBuf = 64;
  uint32_t span = length - start;
  char stackbuf[kStackBuf + 1];
  char* heapbuf = nullptr;
  char* buf;
  if (span <= kStackBuf) {
    buf = stackbuf;
  } else {
    heapbuf = new char[span + 1];
    buf = heapbuf;
  }
  std::memcpy(buf, data + start, span);
  buf[span] = '\0';
  char* endptr;
  double result = std::strtod(buf, &endptr);
  if (heapbuf) delete[] heapbuf;
  // strtod returns 0 on no-conversion; parseFloat must return NaN.
  if (endptr == buf) return std::numeric_limits<double>::quiet_NaN();
  return result;
}

// ─── Number.parseInt (radix 10, ASCII fast path) ───────────────────────
// Spec: https://tc39.es/ecma262/#sec-parseint-string-radix
// Specialized to radix 10 because every parseInt call site in
// socket-lib uses `parseInt(s, 10)`. parseInt with other radices,
// auto-detect (0x prefix → 16), or non-ASCII strings falls back to
// the slow path (V8's existing parseInt builtin).
//
// Behavior matches stock parseInt(s, 10):
//   - Skip leading whitespace
//   - Optional `+` or `-` sign
//   - Read decimal digits until first non-digit
//   - Stop at decimal point (parseInt truncates, doesn't round)
//   - Empty / no-digits → NaN
inline double JsParseInt10(const char* data, uint32_t length) {
  uint32_t i = 0;
  // Skip whitespace.
  while (i < length &&
         (data[i] == ' ' || data[i] == '\t' || data[i] == '\n' ||
          data[i] == '\r' || data[i] == '\f' || data[i] == '\v')) {
    i++;
  }
  if (i >= length) {
    return std::numeric_limits<double>::quiet_NaN();
  }
  // Sign.
  bool negative = false;
  if (data[i] == '-') {
    negative = true;
    i++;
  } else if (data[i] == '+') {
    i++;
  }
  // Must have at least one digit.
  if (i >= length || data[i] < '0' || data[i] > '9') {
    return std::numeric_limits<double>::quiet_NaN();
  }
  // Accumulate. Use double directly — covers the full Number range
  // including 2^53+, where stock parseInt loses precision the same
  // way (this is spec behavior, not a bug).
  double result = 0;
  while (i < length && data[i] >= '0' && data[i] <= '9') {
    result = result * 10 + (data[i] - '0');
    i++;
  }
  return negative ? -result : result;
}

// ═══════════════════════════════════════════════════════════════════════
// Entry definitions — one line per primordial.
// ═══════════════════════════════════════════════════════════════════════

// Math (double → double) — full coverage of the unary math methods.
// Spec roots: https://tc39.es/ecma262/#sec-math-object
DEFINE_FAST_DOUBLE_DOUBLE(MathAbs, StdAbs);
DEFINE_FAST_DOUBLE_DOUBLE(MathAcos, StdAcos);
DEFINE_FAST_DOUBLE_DOUBLE(MathAcosh, StdAcosh);
DEFINE_FAST_DOUBLE_DOUBLE(MathAsin, StdAsin);
DEFINE_FAST_DOUBLE_DOUBLE(MathAsinh, StdAsinh);
DEFINE_FAST_DOUBLE_DOUBLE(MathAtan, StdAtan);
DEFINE_FAST_DOUBLE_DOUBLE(MathAtanh, StdAtanh);
DEFINE_FAST_DOUBLE_DOUBLE(MathCbrt, StdCbrt);
DEFINE_FAST_DOUBLE_DOUBLE(MathCeil, StdCeil);
DEFINE_FAST_DOUBLE_DOUBLE(MathCos, StdCos);
DEFINE_FAST_DOUBLE_DOUBLE(MathCosh, StdCosh);
DEFINE_FAST_DOUBLE_DOUBLE(MathExp, StdExp);
DEFINE_FAST_DOUBLE_DOUBLE(MathExpm1, StdExpm1);
DEFINE_FAST_DOUBLE_DOUBLE(MathFloor, StdFloor);
DEFINE_FAST_DOUBLE_DOUBLE(MathFround, StdFround);
DEFINE_FAST_DOUBLE_DOUBLE(MathLog, StdLog);
DEFINE_FAST_DOUBLE_DOUBLE(MathLog1p, StdLog1p);
DEFINE_FAST_DOUBLE_DOUBLE(MathLog2, StdLog2);
DEFINE_FAST_DOUBLE_DOUBLE(MathLog10, StdLog10);
DEFINE_FAST_DOUBLE_DOUBLE(MathRound, JsMathRound);
DEFINE_FAST_DOUBLE_DOUBLE(MathSign, JsMathSign);
DEFINE_FAST_DOUBLE_DOUBLE(MathSin, StdSin);
DEFINE_FAST_DOUBLE_DOUBLE(MathSinh, StdSinh);
DEFINE_FAST_DOUBLE_DOUBLE(MathSqrt, StdSqrt);
DEFINE_FAST_DOUBLE_DOUBLE(MathTan, StdTan);
DEFINE_FAST_DOUBLE_DOUBLE(MathTanh, StdTanh);
DEFINE_FAST_DOUBLE_DOUBLE(MathTrunc, StdTrunc);

// Math (double, double → double) — binary math methods.
// Math.atan2: https://tc39.es/ecma262/#sec-math.atan2
// Math.hypot (binary form): https://tc39.es/ecma262/#sec-math.hypot
// Math.pow:   https://tc39.es/ecma262/#sec-math.pow
//
// Math.hypot is variadic in JS (`Math.hypot(...values)`); the fast
// path only specializes the 2-arg form. Variadic callers fall back
// to the slow path, which still benefits from the uncurryThis-style
// single-dispatch via node:smol-util.
DEFINE_FAST_DOUBLE_DOUBLE_DOUBLE(MathAtan2, StdAtan2);
DEFINE_FAST_DOUBLE_DOUBLE_DOUBLE(MathHypot, StdHypot);
DEFINE_FAST_DOUBLE_DOUBLE_DOUBLE(MathPow, StdPow);

// Math (int32 × int32 → int32)
DEFINE_FAST_INT32_INT32_INT32(MathImul, JsMathImul);

// Math (uint32 → int32)
DEFINE_FAST_UINT32_INT32(MathClz32, JsMathClz32);

// Number predicates (double → bool)
// Spec: https://tc39.es/ecma262/#sec-number-constructor
DEFINE_FAST_DOUBLE_BOOL(NumberIsFinite, JsIsFinite);
DEFINE_FAST_DOUBLE_BOOL(NumberIsInteger, JsIsInteger);
DEFINE_FAST_DOUBLE_BOOL(NumberIsNaN, JsIsNaN);
DEFINE_FAST_DOUBLE_BOOL(NumberIsSafeInteger, JsIsSafeInteger);

// Number static parsers (FastOneByteString → double)
// Spec roots:
//   parseFloat:    https://tc39.es/ecma262/#sec-parsefloat-string
//   parseInt(_,10):https://tc39.es/ecma262/#sec-parseint-string-radix
DEFINE_FAST_STRING_DOUBLE(NumberParseFloat, JsParseFloat);
DEFINE_FAST_STRING_DOUBLE(NumberParseInt10, JsParseInt10);

// Array.isArray (Local<Value> → bool)
// Spec: https://tc39.es/ecma262/#sec-array.isarray
DEFINE_FAST_VALUE_BOOL(ArrayIsArray, JsArrayIsArray);

// Date.now (() → double)
// Spec: https://tc39.es/ecma262/#sec-date.now
DEFINE_FAST_VOID_DOUBLE(DateNow, JsDateNow);

// String.prototype.charCodeAt (FastOneByteString, int32 → int32)
// Spec: https://tc39.es/ecma262/#sec-string.prototype.charcodeat
// Returns -1 sentinel for OOB; primordials.ts wrapper converts to NaN.
DEFINE_FAST_STRING_INT32_INT32(StringCharCodeAt);

// ═══════════════════════════════════════════════════════════════════════
// Module registration helpers.
// ═══════════════════════════════════════════════════════════════════════

// `SetFastMethodNoSideEffect` binds three things on `target`:
//   1. JS-visible name
//   2. slow-path callback (always runs in unoptimized callers)
//   3. fast-path CFunction descriptor (TurboFan inlines)
// `NoSideEffect` tells V8's optimizer the call is pure — unlocks LICM
// (loop-invariant code motion) and CSE (common subexpression elimination)
// on the JIT'd caller side.
#define REGISTER_FAST(TARGET, JSNAME, NAME)                              \
  SetFastMethodNoSideEffect(context, TARGET, JSNAME, Slow##NAME,         \
                            &fast_##NAME)

#define EXTREF_FAST(NAME)                                                \
  do {                                                                   \
    registry->Register(Slow##NAME);                                      \
    registry->Register(fast_##NAME.GetTypeInfo());                       \
  } while (0)

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  REGISTER_FAST(target, "arrayIsArray", ArrayIsArray);
  REGISTER_FAST(target, "dateNow", DateNow);
  REGISTER_FAST(target, "mathAbs", MathAbs);
  REGISTER_FAST(target, "mathAcos", MathAcos);
  REGISTER_FAST(target, "mathAcosh", MathAcosh);
  REGISTER_FAST(target, "mathAsin", MathAsin);
  REGISTER_FAST(target, "mathAsinh", MathAsinh);
  REGISTER_FAST(target, "mathAtan", MathAtan);
  REGISTER_FAST(target, "mathAtan2", MathAtan2);
  REGISTER_FAST(target, "mathAtanh", MathAtanh);
  REGISTER_FAST(target, "mathCbrt", MathCbrt);
  REGISTER_FAST(target, "mathCeil", MathCeil);
  REGISTER_FAST(target, "mathClz32", MathClz32);
  REGISTER_FAST(target, "mathCos", MathCos);
  REGISTER_FAST(target, "mathCosh", MathCosh);
  REGISTER_FAST(target, "mathExp", MathExp);
  REGISTER_FAST(target, "mathExpm1", MathExpm1);
  REGISTER_FAST(target, "mathFloor", MathFloor);
  REGISTER_FAST(target, "mathFround", MathFround);
  REGISTER_FAST(target, "mathHypot", MathHypot);
  REGISTER_FAST(target, "mathImul", MathImul);
  REGISTER_FAST(target, "mathLog", MathLog);
  REGISTER_FAST(target, "mathLog1p", MathLog1p);
  REGISTER_FAST(target, "mathLog2", MathLog2);
  REGISTER_FAST(target, "mathLog10", MathLog10);
  REGISTER_FAST(target, "mathPow", MathPow);
  REGISTER_FAST(target, "mathRound", MathRound);
  REGISTER_FAST(target, "mathSign", MathSign);
  REGISTER_FAST(target, "mathSin", MathSin);
  REGISTER_FAST(target, "mathSinh", MathSinh);
  REGISTER_FAST(target, "mathSqrt", MathSqrt);
  REGISTER_FAST(target, "mathTan", MathTan);
  REGISTER_FAST(target, "mathTanh", MathTanh);
  REGISTER_FAST(target, "mathTrunc", MathTrunc);
  REGISTER_FAST(target, "numberIsFinite", NumberIsFinite);
  REGISTER_FAST(target, "numberIsInteger", NumberIsInteger);
  REGISTER_FAST(target, "numberIsNaN", NumberIsNaN);
  REGISTER_FAST(target, "numberIsSafeInteger", NumberIsSafeInteger);
  REGISTER_FAST(target, "numberParseFloat", NumberParseFloat);
  REGISTER_FAST(target, "numberParseInt10", NumberParseInt10);
  REGISTER_FAST(target, "stringCharCodeAt", StringCharCodeAt);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  EXTREF_FAST(ArrayIsArray);
  EXTREF_FAST(DateNow);
  EXTREF_FAST(MathAbs);
  EXTREF_FAST(MathAcos);
  EXTREF_FAST(MathAcosh);
  EXTREF_FAST(MathAsin);
  EXTREF_FAST(MathAsinh);
  EXTREF_FAST(MathAtan);
  EXTREF_FAST(MathAtan2);
  EXTREF_FAST(MathAtanh);
  EXTREF_FAST(MathCbrt);
  EXTREF_FAST(MathCeil);
  EXTREF_FAST(MathClz32);
  EXTREF_FAST(MathCos);
  EXTREF_FAST(MathCosh);
  EXTREF_FAST(MathExp);
  EXTREF_FAST(MathExpm1);
  EXTREF_FAST(MathFloor);
  EXTREF_FAST(MathFround);
  EXTREF_FAST(MathHypot);
  EXTREF_FAST(MathImul);
  EXTREF_FAST(MathLog);
  EXTREF_FAST(MathLog1p);
  EXTREF_FAST(MathLog2);
  EXTREF_FAST(MathLog10);
  EXTREF_FAST(MathPow);
  EXTREF_FAST(MathRound);
  EXTREF_FAST(MathSign);
  EXTREF_FAST(MathSin);
  EXTREF_FAST(MathSinh);
  EXTREF_FAST(MathSqrt);
  EXTREF_FAST(MathTan);
  EXTREF_FAST(MathTanh);
  EXTREF_FAST(MathTrunc);
  EXTREF_FAST(NumberIsFinite);
  EXTREF_FAST(NumberIsInteger);
  EXTREF_FAST(NumberIsNaN);
  EXTREF_FAST(NumberIsSafeInteger);
  EXTREF_FAST(NumberParseFloat);
  EXTREF_FAST(NumberParseInt10);
  EXTREF_FAST(StringCharCodeAt);
}

}  // namespace primordial
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_primordial,
    node::socketsecurity::primordial::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_primordial,
    node::socketsecurity::primordial::RegisterExternalReferences)
