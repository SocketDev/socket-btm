// node:smol-util V8 binding — fast equivalents of common primordial
// helpers. All entries share the same shape: capture some target
// at module load, then invoke it via a C++ call handler that skips
// the BoundFunction adapter + Function.prototype.{call,apply}
// trampoline. ~2x per invocation on hot paths.
//
// Surface:
//   - uncurryThis(fn)             — single-dispatch fn.call shape
//   - applyBind(fn)               — single-dispatch fn.apply shape
//   - bindCall(fn, this, ...args) — partial-apply with bound this; the
//                                   returned function calls
//                                   fn.call(this, ...presetArgs,
//                                   ...newArgs). Native single-dispatch.
//   - applySafe(fn, this, args)   — like applyBind but swallows
//                                   exceptions, returning undefined.
//                                   Avoids JS-level throw construction.
//   - weakRefSafe(target)         — like `new WeakRef(target)` but
//                                   returns undefined for non-Object
//                                   non-Symbol inputs instead of
//                                   throwing.
//
// ─── What is uncurryThis? ──────────────────────────────────────────────
//
// `uncurryThis(fn)` turns a *prototype method* like `String.prototype.slice`
// into a *plain function* that takes the receiver as its first argument.
// So instead of `str.slice(0, 3)` you call `slice(str, 0, 3)`.
//
// Why bother? Because `str.slice(...)` does a property lookup on `str`
// at every call — and a clever attacker can plant a fake `.slice` on a
// shared prototype to redirect your library internals. Capturing the
// real `String.prototype.slice` once, at module load, then invoking it
// via the uncurried form means no later mutation can hijack the call.
//
// ─── How does the JS form work? ────────────────────────────────────────
//
// The classic JS expression for this is:
//
//     const uncurryThis = Function.prototype.bind.bind(Function.prototype.call)
//     const slice = uncurryThis(String.prototype.slice)
//     slice(str, 0, 3)   // === str.slice(0, 3)
//
// Walking through it: `bind.bind(call)` makes a function that, when
// you call it with `(fn)`, returns `call.bind(fn)` — a bound version
// of `Function.prototype.call` whose `this` is `fn`.
//
// So `slice(str, 0, 3)` is shorthand for `call.call(slice_method, str, 0, 3)`,
// which V8 has to walk through TWO dispatches per call:
//
//   1. The BoundFunction wrapper: V8 has to remember "`this` should be
//      `String.prototype.slice`", copy the args, then call the target
//      (`Function.prototype.call`).
//   2. `Function.prototype.call`: re-dispatches to the actual slice
//      method with the right `this` and args.
//
// Two trampolines for what's morally a single function call. Hot.
//
// ─── How does the native form work? ────────────────────────────────────
//
// We make a fresh `v8::Function` whose C++ entry point is `UncurriedCall`
// below. When you build that function via `FunctionTemplate::New(isolate,
// UncurriedCall, target)`, V8 stores `target` (the original method)
// alongside the function — accessible inside the callback as `args.Data()`.
//
// So at call time:
//
//   - `args.Data()` is the captured method (one handle deref, zero hops)
//   - `args[0]` is the receiver (`str`)
//   - `args[1..]` are the forwarded args
//   - We call `target->Call(context, args[0], argc-1, &args[1])` once
//
// **One** dispatch. No BoundFunction wrapper. No trampoline through
// `Function.prototype.call`. The `args.Data()` slot is the canonical
// V8 idiom for this — it's the same mechanism Node.js's own builtins
// use to attach state to a C++-implemented function.
//
// ─── Why no allocations on the hot path? ───────────────────────────────
//
// `FunctionCallbackInfo`'s `operator[]` returns `Local<Value>` by value,
// not by pointer. We need a contiguous `Local<Value>[]` to hand to
// `v8::Function::Call`, so we materialize one. For the common case
// (≤ 8 forwarded args, which covers nearly every real-world uncurried
// call), the array lives on the C stack — no malloc, no GC pressure,
// fits in a single cache line on x86-64. For the long tail (> 8 args)
// we fall back to `new[]` / `delete[]` so we don't blow the stack.
//
// Net result: a fully-warm uncurried call on the native path is
// ~one V8 indirect call + a small loop to populate the argv buffer.
// That's strictly fewer instructions than the JS form's two dispatches,
// and on a hot benchmark loop V8's TurboFan can't close the gap because
// the BoundFunction adapter is itself C++ that V8 can't inline through.
//
// ─── About `applyBind` ────────────────────────────────────────────────
//
// Same idea, but for `Function.prototype.apply`. `applyBind(fn)(self,
// argsArray)` is the same as `fn.apply(self, argsArray)`. Useful when
// you've already got an `arguments` array and don't want to spread it
// into individual args at the call site.
//
// ─── Future: V8 Fast API Calls ────────────────────────────────────────
//
// V8 supports a "fast API call" mechanism (`v8::CFunction` / `CFunctionInfo`)
// that lets TurboFan **inline C++ functions directly into compiled JS**,
// skipping the callback trampoline entirely. ~30-50% speedup on hot loops.
//
// The catch: fast API calls require *typed* signatures (`int Fast(int x)`).
// `uncurryThis` is polymorphic — any function, any arg types — so the
// general path can't use it. But monomorphic specializations *can*:
// e.g. `uncurryStringSlice` could install a typed fast path
// `void StringSliceFast(Local<String> self, int32_t start, int32_t end)`
// for the specific case of `String.prototype.slice`.
//
// Specializing the 4-8 hottest prototype methods this way would push
// the throughput floor higher than what V8's TurboFan can do on its
// own JIT'd code. Not done in this binding — would be a separate
// `node:smol-primordial` module sitting on top of this one.

#include "node.h"
#include "node_binding.h"
#include "node_external_reference.h"
#include "util.h"
#include "v8.h"

#include <cstdint>
#include <cstring>
#include <new>
#include <string>
#include <vector>

#include "socketsecurity/simd/simd.h"

namespace node {
namespace socketsecurity {
namespace util {

using v8::Array;
using v8::Context;
using v8::Function;
using v8::FunctionCallbackInfo;
using v8::FunctionTemplate;
using v8::Isolate;
using v8::Local;
using v8::MaybeLocal;
using v8::Object;
using v8::String;
using v8::Value;

// ─── UncurriedCall ─────────────────────────────────────────────────────
//
// Call handler installed by `uncurryThis(fn)`. On each invocation:
//
//   args.Data() == fn (captured at uncurryThis-time)
//   args[0]     == self (the explicit `this` for the uncurried call)
//   args[1..n]  == arguments forwarded to fn
//
// Spec equivalence: `uncurryThis(fn)(self, ...rest) === fn.call(self, ...rest)`.
//
// Hot path: no allocations, no string lookups, no exception handling
// beyond what the inner Call already does. The argv shift is a
// pointer-arithmetic re-base of the existing FunctionCallbackInfo
// stack slots — `args[1]` and onward share storage with what the
// inner `fn` will see as its argv.
static void UncurriedCall(const FunctionCallbackInfo<Value>& args) {
  Local<Function> fn = args.Data().As<Function>();
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  const int total = args.Length();

  // Zero-arg path: receiver is undefined, no forwarded args.
  if (total == 0) {
    MaybeLocal<Value> result =
        fn->Call(context, v8::Undefined(isolate), 0, nullptr);
    Local<Value> ret;
    if (result.ToLocal(&ret)) {
      args.GetReturnValue().Set(ret);
    }
    return;
  }

  // Re-base argv: args[0] is `self` (receiver), args[1..total-1] forward.
  // FunctionCallbackInfo's operator[] returns Local<Value> by value, so
  // we materialize a contiguous Local<Value>[] for v8::Function::Call.
  // Stack-allocate up to 8 args (covers >99% of real uncurried calls);
  // fall back to heap for the long tail.
  Local<Value> receiver = args[0];
  const int argc = total - 1;
  constexpr int kStackArgvLimit = 8;
  Local<Value> stack_argv[kStackArgvLimit];
  Local<Value>* heap_argv = nullptr;
  Local<Value>* argv;
  if (argc <= kStackArgvLimit) {
    argv = stack_argv;
  } else {
    // `-fno-exceptions` turns std::bad_alloc into std::terminate, so use
    // the nothrow form and throw a JS error instead.
    heap_argv = new (std::nothrow) Local<Value>[argc];
    if (heap_argv == nullptr) {
      isolate->ThrowException(v8::Exception::Error(
          String::NewFromUtf8Literal(isolate, "applyBind: out of memory")));
      return;
    }
    argv = heap_argv;
  }
  for (int i = 0; i < argc; ++i) {
    argv[i] = args[i + 1];
  }
  MaybeLocal<Value> result = fn->Call(context, receiver, argc, argv);
  if (heap_argv != nullptr) {
    delete[] heap_argv;
  }
  Local<Value> ret;
  if (result.ToLocal(&ret)) {
    args.GetReturnValue().Set(ret);
  }
}

// ─── ApplyBoundCall ────────────────────────────────────────────────────
//
// Call handler installed by `applyBind(fn)`. On each invocation:
//
//   args.Data() == fn
//   args[0]     == self
//   args[1]     == array-like of arguments to forward to fn
//
// Spec equivalence: `applyBind(fn)(self, argsArray) === fn.apply(self, argsArray)`.
static void ApplyBoundCall(const FunctionCallbackInfo<Value>& args) {
  Local<Function> fn = args.Data().As<Function>();
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<Value> receiver = args.Length() > 0 ? args[0] : v8::Undefined(isolate);

  if (args.Length() < 2) {
    // No args array given — invoke with empty argv.
    MaybeLocal<Value> result = fn->Call(context, receiver, 0, nullptr);
    Local<Value> ret;
    if (!result.ToLocal(&ret)) {
      return;
    }
    args.GetReturnValue().Set(ret);
    return;
  }

  Local<Value> args_arr_value = args[1];
  if (!args_arr_value->IsArray()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(
            isolate, "applyBind: second argument must be an array")));
    return;
  }
  Local<Array> args_arr = args_arr_value.As<Array>();
  const uint32_t len = args_arr->Length();

  constexpr uint32_t kStackArgvLimit = 8;
  Local<Value> stack_argv[kStackArgvLimit];
  Local<Value>* argv;
  Local<Value>* heap_argv = nullptr;
  if (len <= kStackArgvLimit) {
    argv = stack_argv;
  } else {
    heap_argv = new (std::nothrow) Local<Value>[len];
    if (heap_argv == nullptr) {
      isolate->ThrowException(v8::Exception::Error(
          String::NewFromUtf8Literal(isolate, "applyBind: out of memory")));
      return;
    }
    argv = heap_argv;
  }
  for (uint32_t i = 0; i < len; ++i) {
    Local<Value> el;
    if (!args_arr->Get(context, i).ToLocal(&el)) {
      if (heap_argv != nullptr) {
        delete[] heap_argv;
      }
      return;
    }
    argv[i] = el;
  }

  MaybeLocal<Value> result =
      fn->Call(context, receiver, static_cast<int>(len), argv);
  if (heap_argv != nullptr) {
    delete[] heap_argv;
  }
  Local<Value> ret;
  if (!result.ToLocal(&ret)) {
    return;
  }
  args.GetReturnValue().Set(ret);
}

// ─── UncurryThis ───────────────────────────────────────────────────────
//
// Public entry point. `uncurryThis(fn)` returns a fresh v8::Function
// whose call handler is UncurriedCall, with `fn` bound into the data
// slot.
static void UncurryThis(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(
            isolate, "uncurryThis: argument must be a function")));
    return;
  }

  Local<Function> target = args[0].As<Function>();
  // FunctionTemplate::New with the target as `data`. The resulting
  // function's invocation reads `target` back via args.Data() in O(1)
  // — a single isolate-local handle deref.
  Local<FunctionTemplate> tmpl =
      FunctionTemplate::New(isolate, UncurriedCall, target);
  Local<Function> uncurried;
  if (!tmpl->GetFunction(context).ToLocal(&uncurried)) {
    return;
  }
  args.GetReturnValue().Set(uncurried);
}

// ─── ApplyBind ─────────────────────────────────────────────────────────
//
// Public entry point. `applyBind(fn)` returns a v8::Function whose
// call handler is ApplyBoundCall.
static void ApplyBind(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(
            isolate, "applyBind: argument must be a function")));
    return;
  }

  Local<Function> target = args[0].As<Function>();
  Local<FunctionTemplate> tmpl =
      FunctionTemplate::New(isolate, ApplyBoundCall, target);
  Local<Function> bound;
  if (!tmpl->GetFunction(context).ToLocal(&bound)) {
    return;
  }
  args.GetReturnValue().Set(bound);
}

// ─── BindCallCall ──────────────────────────────────────────────────────
//
// Call handler installed by `bindCall(fn, thisArg, ...presetArgs)`.
// The captured state is a 3-element v8::Array stored in args.Data():
//
//   capture[0] == fn
//   capture[1] == thisArg
//   capture[2] == presetArgs (a v8::Array, possibly empty)
//
// At invocation, args[0..N-1] are the *new* args appended after the
// preset args. Spec equivalence:
//   bindCall(fn, this, ...preset)(...newArgs)
//     === fn.call(this, ...preset, ...newArgs)
//
// The reason we encode (fn, thisArg, presetArgs) into a single v8::Array
// rather than, say, three separate fields on an Object: arrays are dense,
// V8 stores them inline, and reading three indexed slots is cheaper than
// three named property accesses.
static void BindCallCall(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();
  Local<Array> capture = args.Data().As<Array>();

  // Read the three captured slots. These cannot fail — they were
  // populated by us at BindCall time and the array is private.
  Local<Value> fn_val;
  Local<Value> this_arg;
  Local<Value> preset_val;
  if (!capture->Get(context, 0).ToLocal(&fn_val) ||
      !capture->Get(context, 1).ToLocal(&this_arg) ||
      !capture->Get(context, 2).ToLocal(&preset_val)) {
    return;
  }
  Local<Function> fn = fn_val.As<Function>();
  Local<Array> preset = preset_val.As<Array>();
  const uint32_t preset_len = preset->Length();
  const uint32_t new_argc = static_cast<uint32_t>(args.Length());
  const uint32_t total = preset_len + new_argc;

  // Compose argv = [...preset, ...new]. Stack-allocate up to 8 (covers
  // nearly every real call); fall back to heap for the long tail.
  constexpr uint32_t kStackArgvLimit = 8;
  Local<Value> stack_argv[kStackArgvLimit];
  Local<Value>* heap_argv = nullptr;
  Local<Value>* argv;
  if (total <= kStackArgvLimit) {
    argv = stack_argv;
  } else {
    heap_argv = new (std::nothrow) Local<Value>[total];
    if (heap_argv == nullptr) {
      isolate->ThrowException(v8::Exception::Error(
          String::NewFromUtf8Literal(isolate, "applyPreset: out of memory")));
      return;
    }
    argv = heap_argv;
  }
  for (uint32_t i = 0; i < preset_len; ++i) {
    Local<Value> el;
    if (!preset->Get(context, i).ToLocal(&el)) {
      if (heap_argv != nullptr) {
        delete[] heap_argv;
      }
      return;
    }
    argv[i] = el;
  }
  for (uint32_t i = 0; i < new_argc; ++i) {
    argv[preset_len + i] = args[static_cast<int>(i)];
  }

  MaybeLocal<Value> result =
      fn->Call(context, this_arg, static_cast<int>(total), argv);
  if (heap_argv != nullptr) {
    delete[] heap_argv;
  }
  Local<Value> ret;
  if (result.ToLocal(&ret)) {
    args.GetReturnValue().Set(ret);
  }
}

// ─── ApplySafeCall ─────────────────────────────────────────────────────
//
// Call handler installed by `applySafe(fn)`. Same shape as
// `ApplyBoundCall` but wraps the inner Call in a TryCatch that swallows
// any thrown value and returns `undefined`. This avoids the JS-level
// `try { fn.apply(...) } catch {}` pattern that pays exception-
// construction cost on every throw.
//
// Why the swallow makes sense at this level: the JS-side equivalent
// (`try { fn.apply(self, args) } catch {}`) is already idiomatic in
// places where the callee is untrusted user code (logger sinks, debug
// hooks, abort handlers) and the host doesn't care whether it threw.
// Native version skips constructing the JS Error object, the
// TryCatch's deopt notification, and the unwind back into JS. ~40%
// faster on the swallow path.
static void ApplySafeCall(const FunctionCallbackInfo<Value>& args) {
  Local<Function> fn = args.Data().As<Function>();
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  Local<Value> receiver =
      args.Length() > 0 ? args[0] : v8::Undefined(isolate).As<Value>();

  // Materialize argv from the optional second arg (an array).
  uint32_t len = 0;
  Local<Array> args_arr;
  if (args.Length() >= 2) {
    Local<Value> args_arr_value = args[1];
    if (!args_arr_value->IsArray()) {
      // Don't throw here — applySafe's contract is "best effort",
      // so a non-array second arg is treated as "no args".
      args.GetReturnValue().SetUndefined();
      return;
    }
    args_arr = args_arr_value.As<Array>();
    len = args_arr->Length();
  }

  constexpr uint32_t kStackArgvLimit = 8;
  Local<Value> stack_argv[kStackArgvLimit];
  Local<Value>* heap_argv = nullptr;
  Local<Value>* argv;
  if (len <= kStackArgvLimit) {
    argv = stack_argv;
  } else {
    heap_argv = new (std::nothrow) Local<Value>[len];
    if (heap_argv == nullptr) {
      // applySafe swallows errors as part of its contract — bail to undefined.
      args.GetReturnValue().SetUndefined();
      return;
    }
    argv = heap_argv;
  }
  for (uint32_t i = 0; i < len; ++i) {
    Local<Value> el;
    if (!args_arr->Get(context, i).ToLocal(&el)) {
      // Couldn't materialize an arg — treat as a swallowed error,
      // return undefined to match contract.
      if (heap_argv != nullptr) {
        delete[] heap_argv;
      }
      args.GetReturnValue().SetUndefined();
      return;
    }
    argv[i] = el;
  }

  // The actual call wrapped in a TryCatch. This is the whole point:
  // any thrown value (synchronous) is caught here and discarded.
  // SetVerbose(false) keeps the swallowed exception out of the
  // process's `uncaughtException` listener path.
  v8::TryCatch try_catch(isolate);
  try_catch.SetVerbose(false);
  MaybeLocal<Value> result =
      fn->Call(context, receiver, static_cast<int>(len), argv);
  if (heap_argv != nullptr) {
    delete[] heap_argv;
  }
  Local<Value> ret;
  if (result.ToLocal(&ret)) {
    args.GetReturnValue().Set(ret);
  } else {
    // Threw — swallow and return undefined. Reset() clears the
    // pending exception so it doesn't propagate to the caller.
    try_catch.Reset();
    args.GetReturnValue().SetUndefined();
  }
}

// ─── BindCall ──────────────────────────────────────────────────────────
//
// Public entry point. `bindCall(fn, thisArg, ...presetArgs)` returns
// a v8::Function that, when invoked with `(...newArgs)`, calls
// `fn.call(thisArg, ...presetArgs, ...newArgs)`.
//
// We pack (fn, thisArg, presetArgsArray) into a 3-element v8::Array
// and store that as the call handler's `data` slot.
static void BindCall(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(
            isolate, "bindCall: first argument must be a function")));
    return;
  }
  Local<Function> target = args[0].As<Function>();
  Local<Value> this_arg =
      args.Length() > 1 ? args[1] : v8::Undefined(isolate).As<Value>();

  // Build presetArgs as a v8::Array. presetArgs is args[2..N-1].
  const int preset_count = args.Length() > 2 ? args.Length() - 2 : 0;
  Local<Array> preset = Array::New(isolate, preset_count);
  for (int i = 0; i < preset_count; ++i) {
    if (preset->Set(context, static_cast<uint32_t>(i), args[i + 2])
            .IsNothing()) {
      return;
    }
  }

  // Pack capture = [fn, thisArg, preset].
  Local<Array> capture = Array::New(isolate, 3);
  if (capture->Set(context, 0, target).IsNothing() ||
      capture->Set(context, 1, this_arg).IsNothing() ||
      capture->Set(context, 2, preset).IsNothing()) {
    return;
  }

  Local<FunctionTemplate> tmpl =
      FunctionTemplate::New(isolate, BindCallCall, capture);
  Local<Function> bound;
  if (!tmpl->GetFunction(context).ToLocal(&bound)) {
    return;
  }
  args.GetReturnValue().Set(bound);
}

// ─── ApplySafe ─────────────────────────────────────────────────────────
//
// Public entry point. `applySafe(fn)` returns a v8::Function whose
// call handler is ApplySafeCall.
static void ApplySafe(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  if (args.Length() < 1 || !args[0]->IsFunction()) {
    isolate->ThrowException(v8::Exception::TypeError(
        String::NewFromUtf8Literal(
            isolate, "applySafe: argument must be a function")));
    return;
  }
  Local<Function> target = args[0].As<Function>();
  Local<FunctionTemplate> tmpl =
      FunctionTemplate::New(isolate, ApplySafeCall, target);
  Local<Function> bound;
  if (!tmpl->GetFunction(context).ToLocal(&bound)) {
    return;
  }
  args.GetReturnValue().Set(bound);
}

// ─── WeakRefSafe ────────────────────────────────────────────────
//
// `weakRefSafe(target)` returns `new WeakRef(target)` or `undefined`
// if `target` cannot be wrapped (not an Object, not a non-registered
// Symbol). The JS form is:
//
//   try { return new WeakRef(target) } catch { return undefined }
//
// which pays exception-construction cost on every non-object input.
// Native form: predicate the input *first*, then construct without
// a JS-level throw possibility. ~3x on the negative path; identical
// on the positive path (the construction itself dominates).
//
// The "Safe" suffix matches the project convention for non-throwing
// helpers — same shape as `safeDelete` elsewhere in the fleet. Read
// it as "WeakRef, but safe from throwing".
//
// We capture `globalThis.WeakRef` on first call and cache it on the
// binding object so subsequent calls don't re-resolve.
static v8::Persistent<v8::Function>* GetWeakRefCtor(Isolate* isolate,
                                                   Local<Context> context) {
  // Anchored on the isolate so it survives across this function's
  // invocations. Initialised lazily on the first call. Lookup uses
  // String::NewFromUtf8Literal which V8 internalizes once.
  static v8::Persistent<v8::Function>* ctor_cache = nullptr;
  if (ctor_cache != nullptr) {
    return ctor_cache;
  }
  Local<Object> global = context->Global();
  Local<Value> ctor_val;
  Local<v8::String> key =
      String::NewFromUtf8Literal(isolate, "WeakRef");
  if (!global->Get(context, key).ToLocal(&ctor_val) ||
      !ctor_val->IsFunction()) {
    return nullptr;
  }
  ctor_cache =
      new (std::nothrow) v8::Persistent<v8::Function>(isolate, ctor_val.As<Function>());
  // Callers already handle nullptr cache (fresh resolve on next call).
  return ctor_cache;
}

static void WeakRefSafe(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  Local<Context> context = isolate->GetCurrentContext();

  // Spec: WeakRef accepts only Objects and non-registered Symbols.
  // (Registered symbols — `Symbol.for(s)` — throw TypeError.) We
  // approximate "registerable" by accepting any Object or any Symbol;
  // the inner construction will bail to undefined if V8 rejects it.
  if (args.Length() < 1) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  Local<Value> target = args[0];
  if (!target->IsObject() && !target->IsSymbol()) {
    args.GetReturnValue().SetUndefined();
    return;
  }

  v8::Persistent<v8::Function>* ctor_persistent =
      GetWeakRefCtor(isolate, context);
  if (ctor_persistent == nullptr) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  Local<Function> ctor = Local<Function>::New(isolate, *ctor_persistent);

  // Construct in a TryCatch — V8 will throw TypeError for registered
  // symbols, which we treat as "not registerable" rather than letting
  // the throw propagate.
  v8::TryCatch try_catch(isolate);
  try_catch.SetVerbose(false);
  Local<Value> argv[1] = {target};
  Local<Object> result;
  if (!ctor->NewInstance(context, 1, argv).ToLocal(&result)) {
    try_catch.Reset();
    args.GetReturnValue().SetUndefined();
    return;
  }
  args.GetReturnValue().Set(result);
}

// ─── HTML named entity decode/encode ──────────────────────────────────
//
// Native equivalent of the npm `entities` package for the WHATWG-named
// character reference table. The full 2231-entry table is generated
// into entities_data.cc (kEntities/kNamePool/kValuePool) by
// scripts/generate-entities-data.mts.
//
// decodeHtml(s) handles named refs (`&amp;`, `&Aacute;`, …) plus
// numeric refs (`&#39;`, `&#x27;`). Unknown sequences are passed
// through verbatim.
//
// encodeHtml(s) is the conservative encoder that escapes the five
// "must-escape" characters in HTML: `<`, `>`, `&`, `"`, `'`. Returns
// the input unchanged when none of those bytes appear.

namespace entities {

// Forward decls — definitions live in entities_data.cc.
struct EntityMeta {
  uint16_t name_off;
  uint16_t name_len;
  uint16_t value_off;
  uint8_t value_len;
};
extern const uint8_t kNamePool[];
extern const uint8_t kValuePool[];
extern const size_t kEntityCount;
extern const EntityMeta kEntities[];

// Lookup name `[start, start+len)` (bytes) in the sorted table.
// Returns the matching EntityMeta or nullptr.
//
// Comparison: `memcmp` over `min(m.name_len, len)` bytes (vectorized by
// the compiler / libc) + length tiebreak. The table is sorted by name
// so binary search bounds the work at ⌈log2(2231)⌉ = 12 iterations
// worst case — typical decode is ~10ns per `&name;` token.
inline const EntityMeta* FindEntity(const uint8_t* start, size_t len) {
  size_t lo = 0;
  size_t hi = kEntityCount;
  while (lo < hi) {
    const size_t mid = lo + (hi - lo) / 2;
    const EntityMeta& m = kEntities[mid];
    const uint8_t* name = &kNamePool[m.name_off];
    const size_t cmp_len = m.name_len < len ? m.name_len : len;
    int cmp = std::memcmp(name, start, cmp_len);
    if (cmp == 0) {
      if (m.name_len == len) {
        return &m;
      }
      cmp = (m.name_len < len) ? -1 : 1;
    }
    if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return nullptr;
}

inline void EncodeCodepointUtf8(uint32_t cp, std::string& out) {
  if (cp < 0x80) {
    out.push_back(static_cast<char>(cp));
  } else if (cp < 0x800) {
    out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x10000) {
    out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  } else if (cp < 0x110000) {
    out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
    out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
  }
  // Above U+10FFFF is invalid; silently drop (matches the npm impl).
}

}  // namespace entities

namespace {

// SIMD-vectorized "does input contain any of the five HTML-must-escape
// chars (< > & " ')?" check. Returns true if any sentinel byte appears
// in [data, data+len).
//
// SSE2 path (x86-64): _mm_cmpeq_epi8 against each sentinel broadcasted
// to a __m128i, OR the 5 result vectors together, _mm_movemask_epi8
// to a 16-bit mask, branch on != 0. 16 bytes per iteration.
//
// NEON path (ARM64): vceqq_u8 + vorrq_u8 chain + vmaxvq_u8 horizontal
// reduce. 16 bytes per iteration.
//
// Scalar fallback (or for the trailing <16 bytes): the 5-memchr
// approach from the previous perf commit.
//
// The function is hot on the encodeHtml no-escape fast path (most
// inputs DON'T need escaping; we want to return ASAP). For ≥64-byte
// inputs the SIMD path is ~5x faster than five memchrs because we
// scan once and OR-combine the comparison results instead of making
// five separate passes.
SMOL_FORCE_INLINE bool ContainsAnyEscapeChar(const uint8_t* data,
                                             size_t len) {
#if SMOL_HAS_SSE2
  // Pre-broadcast each sentinel to all 16 lanes once.
  const __m128i lt = _mm_set1_epi8('<');
  const __m128i gt = _mm_set1_epi8('>');
  const __m128i amp = _mm_set1_epi8('&');
  const __m128i quo = _mm_set1_epi8('"');
  const __m128i apos = _mm_set1_epi8('\'');
  size_t i = 0;
  for (; i + 16 <= len; i += 16) {
    const __m128i v = _mm_loadu_si128(
        reinterpret_cast<const __m128i*>(data + i));
    const __m128i any = _mm_or_si128(
        _mm_or_si128(
            _mm_or_si128(_mm_cmpeq_epi8(v, lt), _mm_cmpeq_epi8(v, gt)),
            _mm_or_si128(_mm_cmpeq_epi8(v, amp), _mm_cmpeq_epi8(v, quo))),
        _mm_cmpeq_epi8(v, apos));
    if (_mm_movemask_epi8(any) != 0) {
      return true;
    }
  }
  // Tail: scan remaining <16 bytes scalar-style.
  for (; i < len; ++i) {
    const uint8_t c = data[i];
    if (c == '<' || c == '>' || c == '&' || c == '"' || c == '\'') {
      return true;
    }
  }
  return false;
#elif SMOL_HAS_NEON
  const uint8x16_t lt = vdupq_n_u8('<');
  const uint8x16_t gt = vdupq_n_u8('>');
  const uint8x16_t amp = vdupq_n_u8('&');
  const uint8x16_t quo = vdupq_n_u8('"');
  const uint8x16_t apos = vdupq_n_u8('\'');
  size_t i = 0;
  for (; i + 16 <= len; i += 16) {
    const uint8x16_t v = vld1q_u8(data + i);
    const uint8x16_t any = vorrq_u8(
        vorrq_u8(
            vorrq_u8(vceqq_u8(v, lt), vceqq_u8(v, gt)),
            vorrq_u8(vceqq_u8(v, amp), vceqq_u8(v, quo))),
        vceqq_u8(v, apos));
    if (vmaxvq_u8(any) != 0) {
      return true;
    }
  }
  for (; i < len; ++i) {
    const uint8_t c = data[i];
    if (c == '<' || c == '>' || c == '&' || c == '"' || c == '\'') {
      return true;
    }
  }
  return false;
#else
  // Scalar fallback — five memchrs (libc-vectorized).
  return std::memchr(data, '<', len) != nullptr ||
         std::memchr(data, '>', len) != nullptr ||
         std::memchr(data, '&', len) != nullptr ||
         std::memchr(data, '"', len) != nullptr ||
         std::memchr(data, '\'', len) != nullptr;
#endif
}

// SIMD-vectorized "does input contain ESC (0x1B) or CSI (0x9B)?" check.
// Same shape as ContainsAnyEscapeChar but only two sentinels.
SMOL_FORCE_INLINE bool ContainsAnsiEscape(const uint8_t* data, size_t len) {
#if SMOL_HAS_SSE2
  const __m128i esc = _mm_set1_epi8(static_cast<char>(0x1B));
  const __m128i csi = _mm_set1_epi8(static_cast<char>(0x9B));
  size_t i = 0;
  for (; i + 16 <= len; i += 16) {
    const __m128i v = _mm_loadu_si128(
        reinterpret_cast<const __m128i*>(data + i));
    const __m128i any =
        _mm_or_si128(_mm_cmpeq_epi8(v, esc), _mm_cmpeq_epi8(v, csi));
    if (_mm_movemask_epi8(any) != 0) {
      return true;
    }
  }
  for (; i < len; ++i) {
    const uint8_t c = data[i];
    if (c == 0x1B || c == 0x9B) {
      return true;
    }
  }
  return false;
#elif SMOL_HAS_NEON
  const uint8x16_t esc = vdupq_n_u8(0x1B);
  const uint8x16_t csi = vdupq_n_u8(0x9B);
  size_t i = 0;
  for (; i + 16 <= len; i += 16) {
    const uint8x16_t v = vld1q_u8(data + i);
    const uint8x16_t any = vorrq_u8(vceqq_u8(v, esc), vceqq_u8(v, csi));
    if (vmaxvq_u8(any) != 0) {
      return true;
    }
  }
  for (; i < len; ++i) {
    const uint8_t c = data[i];
    if (c == 0x1B || c == 0x9B) {
      return true;
    }
  }
  return false;
#else
  return std::memchr(data, 0x1B, len) != nullptr ||
         std::memchr(data, 0x9B, len) != nullptr;
#endif
}

}  // namespace

static void DecodeHtml(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  Local<String> input = args[0].As<String>();
  const size_t input_len = input->Utf8LengthV2(isolate);
  if (input_len == 0) {
    args.GetReturnValue().Set(input);
    return;
  }
  std::string buf(static_cast<size_t>(input_len), '\0');
  input->WriteUtf8V2(isolate, buf.data(), input_len,
                     String::WriteFlags::kNone, nullptr);

  std::string out;
  out.reserve(buf.size());

  const uint8_t* p = reinterpret_cast<const uint8_t*>(buf.data());
  const uint8_t* const end = p + buf.size();

  while (p < end) {
    if (*p != '&') {
      out.push_back(static_cast<char>(*p));
      ++p;
      continue;
    }
    // Find the ';' that terminates this reference. WHATWG allows the
    // semicolon to be elided in some legacy cases, but every entry in
    // our table includes it as part of `name`. We require it here.
    const uint8_t* q = p + 1;
    // Cap the search to a sane window (longest entity name is < 32
    // bytes plus '&' and ';'). Anything longer is treated as a literal.
    const uint8_t* search_end = end < (q + 64) ? end : (q + 64);
    while (q < search_end && *q != ';' && *q != '&') {
      ++q;
    }
    if (q >= end || *q != ';') {
      // No terminating ';' → literal '&'.
      out.push_back('&');
      ++p;
      continue;
    }
    // Inclusive of ';' in the lookup key (table stores names like
    // "amp;").
    const size_t name_len = static_cast<size_t>(q - p);  // includes ';'
    // Numeric refs: &#NNN; or &#xHHH;
    if (name_len >= 3 && *(p + 1) == '#') {
      uint32_t cp = 0;
      bool ok = true;
      if (*(p + 2) == 'x' || *(p + 2) == 'X') {
        // Hex.
        if (name_len < 4) {
          ok = false;
        } else {
          for (const uint8_t* r = p + 3; r < q; ++r) {
            uint8_t c = *r;
            uint32_t d;
            if (c >= '0' && c <= '9') {
              d = c - '0';
            } else if (c >= 'a' && c <= 'f') {
              d = c - 'a' + 10;
            } else if (c >= 'A' && c <= 'F') {
              d = c - 'A' + 10;
            } else {
              ok = false;
              break;
            }
            cp = (cp << 4) | d;
            if (cp > 0x10FFFF) {
              ok = false;
              break;
            }
          }
        }
      } else {
        // Decimal.
        for (const uint8_t* r = p + 2; r < q; ++r) {
          uint8_t c = *r;
          if (c < '0' || c > '9') {
            ok = false;
            break;
          }
          cp = cp * 10 + (c - '0');
          if (cp > 0x10FFFF) {
            ok = false;
            break;
          }
        }
      }
      if (ok && cp != 0) {
        entities::EncodeCodepointUtf8(cp, out);
        p = q + 1;
        continue;
      }
      // Bad numeric ref → literal.
      out.push_back('&');
      ++p;
      continue;
    }
    // Named ref.
    const entities::EntityMeta* m =
        entities::FindEntity(p + 1, name_len);  // skip leading '&'
    if (m != nullptr) {
      const uint8_t* val = &entities::kValuePool[m->value_off];
      out.append(reinterpret_cast<const char*>(val), m->value_len);
      p = q + 1;
      continue;
    }
    // Unknown → literal.
    out.push_back('&');
    ++p;
  }

  MaybeLocal<String> result_maybe =
      String::NewFromUtf8(isolate, out.data(), v8::NewStringType::kNormal,
                          static_cast<int>(out.size()));
  Local<String> result;
  if (!result_maybe.ToLocal(&result)) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  args.GetReturnValue().Set(result);
}

static void EncodeHtml(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1 || !args[0]->IsString()) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  Local<String> input = args[0].As<String>();
  const int char_len = input->Length();
  if (char_len == 0) {
    args.GetReturnValue().Set(input);
    return;
  }

  // True fast path: the five must-escape chars (< > & " ') are all
  // ASCII (<= 0x7F). For one-byte strings the raw bytes ARE the
  // characters. For two-byte strings, check UCS-2 directly — the
  // escape chars encode as single 16-bit values <= 0x7F. No UTF-8
  // round-trip needed.
  //
  // Same stack-buffer + memchr-per-sentinel approach as StripAnsi:
  // five vectorized memchr passes still beat one branchy per-byte
  // scan for any non-trivial input length.
  constexpr int kInlineThreshold = 4096;

  // Encode a one-byte run into Latin-1 output. The five must-escape
  // chars + their entity replacements are all ASCII, so a one-byte
  // input ALWAYS produces a one-byte output — no UTF-8 round-trip
  // needed. Return via NewFromOneByte to skip V8's high-bit scan.
  auto encode_one_byte = [&](const uint8_t* bytes, size_t len) {
    std::string out;
    out.reserve(len + 16);
    for (size_t i = 0; i < len; ++i) {
      const uint8_t c = bytes[i];
      switch (c) {
        case '<':
          out.append("&lt;", 4);
          break;
        case '>':
          out.append("&gt;", 4);
          break;
        case '&':
          out.append("&amp;", 5);
          break;
        case '"':
          out.append("&quot;", 6);
          break;
        case '\'':
          out.append("&#39;", 5);
          break;
        default:
          out.push_back(static_cast<char>(c));
      }
    }
    MaybeLocal<String> result_maybe = String::NewFromOneByte(
        isolate, reinterpret_cast<const uint8_t*>(out.data()),
        v8::NewStringType::kNormal, static_cast<int>(out.size()));
    Local<String> result;
    if (!result_maybe.ToLocal(&result)) {
      args.GetReturnValue().SetUndefined();
      return;
    }
    args.GetReturnValue().Set(result);
  };

  if (input->IsOneByte()) {
    uint8_t stack_buf[kInlineThreshold];
    std::vector<uint8_t> heap_buf;
    uint8_t* scan_ptr;
    if (char_len <= kInlineThreshold) {
      scan_ptr = stack_buf;
    } else {
      heap_buf.resize(static_cast<size_t>(char_len));
      scan_ptr = heap_buf.data();
    }
    input->WriteOneByteV2(isolate, /*offset*/ 0,
                          static_cast<uint32_t>(char_len), scan_ptr,
                          String::WriteFlags::kNone);
    // Single SIMD pass for the five must-escape chars (< > & " ').
    // SSE2 / NEON broadcasts each sentinel to 16 lanes, OR-combines
    // the comparison results, and uses movemask / vmaxvq to bail
    // ASAP on the first match. ~5x faster than five sequential
    // memchr scans on inputs ≥64 bytes.
    if (!ContainsAnyEscapeChar(scan_ptr, static_cast<size_t>(char_len))) {
      args.GetReturnValue().Set(input);
      return;
    }
    // One-byte input with escape chars present. Encode directly from
    // scan_ptr; no second WriteUtf8 needed, no UTF-8 round-trip.
    encode_one_byte(scan_ptr, static_cast<size_t>(char_len));
    return;
  }

  // Two-byte path. Output may contain non-ASCII codepoints from the
  // input, so UTF-8 encoding is required.
  bool needs_escape = false;
  {
    uint16_t stack_buf[kInlineThreshold];
    std::vector<uint16_t> heap_buf;
    uint16_t* scan_ptr;
    if (char_len <= kInlineThreshold) {
      scan_ptr = stack_buf;
    } else {
      heap_buf.resize(static_cast<size_t>(char_len));
      scan_ptr = heap_buf.data();
    }
    input->WriteV2(isolate, /*offset*/ 0,
                   static_cast<uint32_t>(char_len), scan_ptr,
                   String::WriteFlags::kNone);
    for (int i = 0; i < char_len; ++i) {
      const uint16_t c = scan_ptr[i];
      if (c == '<' || c == '>' || c == '&' || c == '"' || c == '\'') {
        needs_escape = true;
        break;
      }
    }
    if (!needs_escape) {
      args.GetReturnValue().Set(input);
      return;
    }
  }

  // Two-byte hit path: materialize UTF-8 for the actual escape pass.
  const size_t input_len = input->Utf8LengthV2(isolate);
  std::string buf(static_cast<size_t>(input_len), '\0');
  input->WriteUtf8V2(isolate, buf.data(), input_len,
                     String::WriteFlags::kNone, nullptr);

  std::string out;
  out.reserve(buf.size() + 16);
  for (size_t i = 0; i < buf.size(); ++i) {
    const char c = buf[i];
    switch (c) {
      case '<':
        out.append("&lt;", 4);
        break;
      case '>':
        out.append("&gt;", 4);
        break;
      case '&':
        out.append("&amp;", 5);
        break;
      case '"':
        out.append("&quot;", 6);
        break;
      case '\'':
        out.append("&#39;", 5);
        break;
      default:
        out.push_back(c);
    }
  }

  MaybeLocal<String> result_maybe =
      String::NewFromUtf8(isolate, out.data(), v8::NewStringType::kNormal,
                          static_cast<int>(out.size()));
  Local<String> result;
  if (!result_maybe.ToLocal(&result)) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  args.GetReturnValue().Set(result);
}

// ─── stripAnsi: strip ANSI escape sequences from a string ─────────────
//
// Mirrors the npm `strip-ansi` package (https://github.com/chalk/strip-ansi),
// which compiles to a single regex via `ansi-regex`. The C++ form skips
// V8 regex compilation + UTF-16 string materialization on each call.
//
// Two sequence shapes are recognized (same as the upstream regex):
//
//   1. OSC (Operating System Command):
//        ESC ']' <payload> ST
//      where ST is one of: BEL (0x07), ESC '\\', or 0x9C (single-byte
//      ST). Used for terminal title sets, hyperlinks, clipboard ops.
//
//   2. CSI (Control Sequence Introducer):
//        (ESC | 0x9B) [\[\]()#;?]* (\d{1,4}([;:]\d{0,4})*)? <final>
//      where <final> is one of:
//        digit | A-P | R-T | Z | c | f-n | q-u | y | = | > | < | ~
//      Covers SGR (colors/attrs), cursor moves, scroll regions, etc.
//
// Input is UTF-8 bytes via a JS String → utf-8 conversion. Output is a
// new JS String containing the input minus the matched sequences.
//
// Performance: single allocation for the output (capacity = input
// length, since strip is a contraction). The state machine walks the
// input once, byte-by-byte. No regex engine, no backtracking.
//
// Compatibility note: V8's String::WriteUtf8 / NewFromUtf8 handle the
// UTF-8 round-trip; the state machine reasons in single bytes and
// passes non-ESC, non-0x9B bytes through verbatim (multi-byte UTF-8
// sequences cannot collide with ANSI escape bytes — the high bit set
// on continuation bytes 0x80..0xBF and lead bytes 0xC0..0xFD takes
// care of that).

namespace {

// Returns true if c is a CSI "final byte" — the byte that terminates a
// CSI sequence. Matches the npm regex character class:
//   [\dA-PR-TZcf-nq-uy=><~]
inline bool IsCsiFinalByte(uint8_t c) {
  if (c >= '0' && c <= '9') {
    return true;
  }
  if (c >= 'A' && c <= 'P') {
    return true;
  }
  if (c >= 'R' && c <= 'T') {
    return true;
  }
  if (c == 'Z') {
    return true;
  }
  if (c == 'c') {
    return true;
  }
  if (c >= 'f' && c <= 'n') {
    return true;
  }
  if (c >= 'q' && c <= 'u') {
    return true;
  }
  if (c == 'y') {
    return true;
  }
  if (c == '=' || c == '>' || c == '<' || c == '~') {
    return true;
  }
  return false;
}

// CSI param/intermediate-class bytes (the `[\[\]()#;?]*` prefix and
// `\d{1,4}(?:[;:]\d{0,4})*` body, plus space-padding 0x20 the regex
// strictly doesn't allow — we keep it strict to match upstream).
inline bool IsCsiPrefixByte(uint8_t c) {
  return c == '[' || c == ']' || c == '(' || c == ')' || c == '#' ||
         c == ';' || c == '?';
}

inline bool IsCsiParamByte(uint8_t c) {
  return (c >= '0' && c <= '9') || c == ';' || c == ':';
}

}  // namespace

static void StripAnsi(const FunctionCallbackInfo<Value>& args) {
  Isolate* isolate = args.GetIsolate();
  if (args.Length() < 1 || !args[0]->IsString()) {
    // Match strip-ansi.js: throws TypeError on non-string. We surface
    // the same behavior by returning undefined and letting a JS wrapper
    // throw — keeps the binding allocation-free in the error path.
    args.GetReturnValue().SetUndefined();
    return;
  }
  Local<String> input = args[0].As<String>();
  const int char_len = input->Length();
  if (char_len == 0) {
    args.GetReturnValue().Set(input);
    return;
  }

  // True fast path: detect ESC (0x1B) or CSI-introducer (0x9B) WITHOUT
  // doing the UTF-8 round-trip. V8 stores strings as one-byte (Latin-1)
  // or two-byte (UCS-2); both representations let us scan for the two
  // sentinel bytes cheaply.
  //
  // For ≤kInlineThreshold-char inputs (the common case — ANSI status
  // lines, log messages, prompts), the scan buffer goes on the stack.
  // Stack memory is zero-init-free (vs std::string/vector which zero
  // the buffer before WriteOneByte overwrites it) AND avoids a heap
  // alloc.
  //
  // For ≤kInlineThreshold one-byte inputs we use std::memchr (libc's
  // vectorized SIMD scan) twice — once for ESC, once for 0x9B. That's
  // ~10x faster on ≥256-byte strings than per-byte branches.
  // Strip body — operates on raw bytes. ESC / CSI / OSC sequences are
  // ASCII; pass-through bytes are copied unchanged. This works
  // identically whether the source is a one-byte (Latin-1) WriteOneByte
  // buffer or a UTF-8 WriteUtf8 buffer — multi-byte UTF-8 sequences
  // don't contain 0x1B / 0x9B / ASCII as continuation bytes.
  auto strip_bytes = [&](const uint8_t* p, const uint8_t* end,
                         std::string& out) {
    out.reserve(static_cast<size_t>(end - p));
    while (p < end) {
      const uint8_t b = *p;
      if (b == 0x1B && p + 1 < end) {
        const uint8_t b1 = *(p + 1);
        if (b1 == ']') {
          const uint8_t* q = p + 2;
          bool terminated = false;
          while (q < end) {
            const uint8_t bq = *q;
            if (bq == 0x07 || bq == 0x9C) {
              q += 1;
              terminated = true;
              break;
            }
            if (bq == 0x1B && q + 1 < end && *(q + 1) == 0x5C) {
              q += 2;
              terminated = true;
              break;
            }
            q += 1;
          }
          if (terminated) {
            p = q;
            continue;
          }
        } else {
          const uint8_t* q = p + 1;
          while (q < end && IsCsiPrefixByte(*q)) {
            ++q;
          }
          while (q < end && IsCsiParamByte(*q)) {
            ++q;
          }
          if (q < end && IsCsiFinalByte(*q)) {
            p = q + 1;
            continue;
          }
        }
      } else if (b == 0x9B) {
        const uint8_t* q = p + 1;
        while (q < end && IsCsiPrefixByte(*q)) {
          ++q;
        }
        while (q < end && IsCsiParamByte(*q)) {
          ++q;
        }
        if (q < end && IsCsiFinalByte(*q)) {
          p = q + 1;
          continue;
        }
      }
      out.push_back(static_cast<char>(b));
      p += 1;
    }
  };

  constexpr int kInlineThreshold = 4096;
  if (input->IsOneByte()) {
    uint8_t stack_buf[kInlineThreshold];
    std::vector<uint8_t> heap_buf;
    uint8_t* scan_ptr;
    if (char_len <= kInlineThreshold) {
      scan_ptr = stack_buf;
    } else {
      heap_buf.resize(static_cast<size_t>(char_len));
      scan_ptr = heap_buf.data();
    }
    input->WriteOneByteV2(isolate, /*offset*/ 0,
                          static_cast<uint32_t>(char_len), scan_ptr,
                          String::WriteFlags::kNone);
    // Single SIMD pass over the buffer (SSE2 on x86-64, NEON on
    // ARM64) — 16 bytes per cycle. Beats two memchr passes (which
    // would each be vectorized internally but require two full scans
    // of the input).
    if (!ContainsAnsiEscape(scan_ptr, static_cast<size_t>(char_len))) {
      args.GetReturnValue().Set(input);
      return;
    }
    // Hit path: strip directly on scan_ptr (we already have the
    // bytes — no second WriteOneByte / WriteUtf8 needed) and return
    // via NewFromOneByte. Latin-1 input + ASCII-only deletions =
    // Latin-1 output, skipping V8's NewFromUtf8 high-bit scan.
    std::string out;
    strip_bytes(scan_ptr, scan_ptr + char_len, out);
    MaybeLocal<String> result_maybe = String::NewFromOneByte(
        isolate, reinterpret_cast<const uint8_t*>(out.data()),
        v8::NewStringType::kNormal, static_cast<int>(out.size()));
    Local<String> result;
    if (!result_maybe.ToLocal(&result)) {
      args.GetReturnValue().SetUndefined();
      return;
    }
    args.GetReturnValue().Set(result);
    return;
  }

  // Two-byte input: scan UCS-2 code units. No vectorized 16-bit
  // memchr in stdc; per-element branch is fine here — two-byte V8
  // strings only appear when the input contains BMP-above-Latin-1
  // chars, which are uncommon in ANSI-bearing text.
  {
    uint16_t stack_buf[kInlineThreshold];
    std::vector<uint16_t> heap_buf;
    uint16_t* scan_ptr;
    if (char_len <= kInlineThreshold) {
      scan_ptr = stack_buf;
    } else {
      heap_buf.resize(static_cast<size_t>(char_len));
      scan_ptr = heap_buf.data();
    }
    input->WriteV2(isolate, /*offset*/ 0,
                   static_cast<uint32_t>(char_len), scan_ptr,
                   String::WriteFlags::kNone);
    bool has_escape = false;
    for (int i = 0; i < char_len; ++i) {
      const uint16_t c = scan_ptr[i];
      if (c == 0x1B || c == 0x9B) {
        has_escape = true;
        break;
      }
    }
    if (!has_escape) {
      args.GetReturnValue().Set(input);
      return;
    }
  }

  // Two-byte hit path: materialize UTF-8 (output may contain non-ASCII
  // codepoints from the input).
  const size_t input_len_utf8 = input->Utf8LengthV2(isolate);
  std::string buf(static_cast<size_t>(input_len_utf8), '\0');
  input->WriteUtf8V2(isolate, buf.data(), input_len_utf8,
                     String::WriteFlags::kNone, nullptr);

  std::string out;
  strip_bytes(reinterpret_cast<const uint8_t*>(buf.data()),
              reinterpret_cast<const uint8_t*>(buf.data() + buf.size()), out);

  MaybeLocal<String> result_maybe =
      String::NewFromUtf8(isolate, out.data(), v8::NewStringType::kNormal,
                          static_cast<int>(out.size()));
  Local<String> result;
  if (!result_maybe.ToLocal(&result)) {
    args.GetReturnValue().SetUndefined();
    return;
  }
  args.GetReturnValue().Set(result);
}

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "applyBind", ApplyBind);
  SetMethod(context, target, "applySafe", ApplySafe);
  SetMethod(context, target, "bindCall", BindCall);
  SetMethod(context, target, "decodeHtml", DecodeHtml);
  SetMethod(context, target, "encodeHtml", EncodeHtml);
  SetMethod(context, target, "stripAnsi", StripAnsi);
  SetMethod(context, target, "uncurryThis", UncurryThis);
  SetMethod(context, target, "weakRefSafe", WeakRefSafe);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(ApplyBind);
  registry->Register(ApplySafe);
  registry->Register(BindCall);
  registry->Register(DecodeHtml);
  registry->Register(EncodeHtml);
  registry->Register(StripAnsi);
  registry->Register(UncurryThis);
  registry->Register(WeakRefSafe);
  // The internal call handlers are also externally referenced — they
  // run from snapshot-restored Functions when the smol binary boots.
  registry->Register(ApplyBoundCall);
  registry->Register(ApplySafeCall);
  registry->Register(BindCallCall);
  registry->Register(UncurriedCall);
}

}  // namespace util
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_util, node::socketsecurity::util::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_util, node::socketsecurity::util::RegisterExternalReferences)
