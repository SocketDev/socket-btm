'use strict'

// node:smol-util — fast native equivalents of common primordial helpers.
//
// Currently exposes:
//   - uncurryThis(fn): like bind.bind(call)(fn) but ~2x faster (single
//     dispatch instead of two)
//   - applyBind(fn):   like bind.bind(apply)(fn) but ~2x faster
//
// Backed by a native binding (smol_util) implemented in
// src/socketsecurity/util/. The native form bypasses V8's
// BoundFunction adapter + Function.prototype.{call,apply} trampoline,
// reading the captured target via args.Data() and invoking
// v8::Function::Call directly.

const { ObjectFreeze } = primordials

const { uncurryThis, applyBind } = require('internal/socketsecurity/util')

module.exports = ObjectFreeze({
  __proto__: null,
  uncurryThis,
  applyBind,
})
