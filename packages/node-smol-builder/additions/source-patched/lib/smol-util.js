'use strict'

// node:smol-util — fast native equivalents of common primordial helpers.
//
// Surface:
//   - uncurryThis(fn)             — like bind.bind(call)(fn). Single
//                                   V8 dispatch instead of two. ~2x.
//   - applyBind(fn)               — like bind.bind(apply)(fn). Same
//                                   shape, for fn.apply(self, args).
//   - bindCall(fn, this, ...preset) — partial-apply with bound this.
//                                   The returned function calls
//                                   fn.call(this, ...preset, ...new).
//                                   Native single-dispatch.
//   - applySafe(fn)               — like applyBind but the returned
//                                   function swallows synchronous
//                                   throws and returns undefined.
//                                   Avoids JS-level throw construction
//                                   on the swallow path.
//   - weakRefSafe(target)         — like `new WeakRef(target)` but
//                                   returns undefined for inputs that
//                                   would throw (non-Object, non-Symbol)
//                                   instead of throwing.
//
// All entries are backed by a native binding (smol_util) implemented
// in src/socketsecurity/util/. The native form bypasses V8's
// BoundFunction adapter + Function.prototype.{call,apply} trampoline,
// reading the captured state via args.Data() and invoking
// v8::Function::Call (or v8::Function::NewInstance) directly.

const { ObjectFreeze } = primordials

const {
  applyBind,
  applySafe,
  bindCall,
  uncurryThis,
  weakRefSafe,
} = require('internal/socketsecurity/util')

module.exports = ObjectFreeze({
  __proto__: null,
  applyBind,
  applySafe,
  bindCall,
  uncurryThis,
  weakRefSafe,
})
