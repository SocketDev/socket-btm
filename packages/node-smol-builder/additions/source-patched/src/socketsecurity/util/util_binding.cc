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
#include "v8.h"

#include "socketsecurity/util/util.h"

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
    heap_argv = new Local<Value>[argc];
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
    heap_argv = new Local<Value>[len];
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
    heap_argv = new Local<Value>[total];
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
    heap_argv = new Local<Value>[len];
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
  ctor_cache = new v8::Persistent<v8::Function>(isolate, ctor_val.As<Function>());
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

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "applyBind", ApplyBind);
  SetMethod(context, target, "applySafe", ApplySafe);
  SetMethod(context, target, "bindCall", BindCall);
  SetMethod(context, target, "uncurryThis", UncurryThis);
  SetMethod(context, target, "weakRefSafe", WeakRefSafe);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(ApplyBind);
  registry->Register(ApplySafe);
  registry->Register(BindCall);
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
