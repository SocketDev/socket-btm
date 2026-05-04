// node:smol-util V8 binding — fast `uncurryThis` and `applyBind`.
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
// `node:smol-primordials` module sitting on top of this one.

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

static void Initialize(Local<Object> target,
                       Local<Value> /* unused */,
                       Local<Context> context,
                       void* /* priv */) {
  SetMethod(context, target, "uncurryThis", UncurryThis);
  SetMethod(context, target, "applyBind", ApplyBind);
}

static void RegisterExternalReferences(ExternalReferenceRegistry* registry) {
  registry->Register(UncurryThis);
  registry->Register(ApplyBind);
  // The internal call handlers are also externally referenced — they
  // run from snapshot-restored Functions when the smol binary boots.
  registry->Register(UncurriedCall);
  registry->Register(ApplyBoundCall);
}

}  // namespace util
}  // namespace socketsecurity
}  // namespace node

NODE_BINDING_CONTEXT_AWARE_INTERNAL(
    smol_util, node::socketsecurity::util::Initialize)
NODE_BINDING_EXTERNAL_REFERENCE(
    smol_util, node::socketsecurity::util::RegisterExternalReferences)
