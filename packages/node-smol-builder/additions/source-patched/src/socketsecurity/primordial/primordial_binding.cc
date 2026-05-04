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
// ─── Why these particular methods? ─────────────────────────────────────
//
// The fast-path signature can only use **primitive types** in its return
// + argument positions: bool, int32_t, uint32_t, int64_t, uint64_t, float,
// double, Local<Value>, Local<Object>, Local<String>. **It cannot return
// a new object** — V8 wouldn't know how to allocate it inline.
//
// So we pick prototype methods that:
//   a. Take primitive args (numbers, optional secondary args)
//   b. Return primitive results (bool, number)
//
// Math.abs / Math.floor / Math.imul are perfect: `(double) -> double`
// or `(int32, int32) -> int32`. Number.isFinite / isNaN are
// `(double) -> bool`. These compile down to a single instruction or
// two on modern CPUs and TurboFan can inline them as if they were
// V8 builtins.
//
// String predicates are harder (they need careful handling of one-byte
// vs two-byte string encodings and offset normalization). Those will
// be a follow-up module — this binding focuses on the "easy wins".
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

#include <cmath>
#include <cstdint>
#include <limits>

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
  // Math (unary, double → double)
  REGISTER_FAST(target, "mathAbs", MathAbs);
  REGISTER_FAST(target, "mathAcos", MathAcos);
  REGISTER_FAST(target, "mathAcosh", MathAcosh);
  REGISTER_FAST(target, "mathAsin", MathAsin);
  REGISTER_FAST(target, "mathAsinh", MathAsinh);
  REGISTER_FAST(target, "mathAtan", MathAtan);
  REGISTER_FAST(target, "mathAtanh", MathAtanh);
  REGISTER_FAST(target, "mathCbrt", MathCbrt);
  REGISTER_FAST(target, "mathCeil", MathCeil);
  REGISTER_FAST(target, "mathCos", MathCos);
  REGISTER_FAST(target, "mathCosh", MathCosh);
  REGISTER_FAST(target, "mathExp", MathExp);
  REGISTER_FAST(target, "mathExpm1", MathExpm1);
  REGISTER_FAST(target, "mathFloor", MathFloor);
  REGISTER_FAST(target, "mathFround", MathFround);
  REGISTER_FAST(target, "mathLog", MathLog);
  REGISTER_FAST(target, "mathLog1p", MathLog1p);
  REGISTER_FAST(target, "mathLog2", MathLog2);
  REGISTER_FAST(target, "mathLog10", MathLog10);
  REGISTER_FAST(target, "mathRound", MathRound);
  REGISTER_FAST(target, "mathSign", MathSign);
  REGISTER_FAST(target, "mathSin", MathSin);
  REGISTER_FAST(target, "mathSinh", MathSinh);
  REGISTER_FAST(target, "mathSqrt", MathSqrt);
  REGISTER_FAST(target, "mathTan", MathTan);
  REGISTER_FAST(target, "mathTanh", MathTanh);
  REGISTER_FAST(target, "mathTrunc", MathTrunc);
  // Math (binary, double × double → double)
  REGISTER_FAST(target, "mathAtan2", MathAtan2);
  REGISTER_FAST(target, "mathHypot", MathHypot);
  REGISTER_FAST(target, "mathPow", MathPow);
  // Math (other signatures)
  REGISTER_FAST(target, "mathImul", MathImul);
  REGISTER_FAST(target, "mathClz32", MathClz32);
  // Number predicates
  REGISTER_FAST(target, "numberIsFinite", NumberIsFinite);
  REGISTER_FAST(target, "numberIsInteger", NumberIsInteger);
  REGISTER_FAST(target, "numberIsNaN", NumberIsNaN);
  REGISTER_FAST(target, "numberIsSafeInteger", NumberIsSafeInteger);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
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
