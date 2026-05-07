// node:smol-util — fast native equivalents of common primordial helpers.
//
// Currently exposes:
//   - uncurryThis(fn): like bind.bind(call)(fn), single-dispatch at call time
//   - applyBind(fn):   like bind.bind(apply)(fn), single-dispatch at call time
//
// Both produce a v8::Function whose call handler is C++ that calls the
// captured `fn` directly via v8::Function::Call, bypassing the bound-
// function adapter + Function.prototype.call/apply trampoline that the
// JS form hits twice per invocation.

#ifndef SRC_SOCKETSECURITY_UTIL_UTIL_H_
#define SRC_SOCKETSECURITY_UTIL_UTIL_H_

#if defined(NODE_WANT_INTERNALS) && NODE_WANT_INTERNALS

#include "v8.h"

namespace node {
namespace socketsecurity {
namespace util {

// Slot index in the per-Function ObjectTemplate where the captured
// target function reference lives. Must be < kInternalFieldCount on
// the FunctionTemplate (set to 1 in util_binding.cc).
inline constexpr int kCapturedFunctionSlot = 0;

}  // namespace util
}  // namespace socketsecurity
}  // namespace node

#endif  // NODE_WANT_INTERNALS

#endif  // SRC_SOCKETSECURITY_UTIL_UTIL_H_
