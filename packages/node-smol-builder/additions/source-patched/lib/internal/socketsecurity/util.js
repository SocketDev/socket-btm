'use strict'

// Documentation: docs/additions/lib/internal/socketsecurity/util.js.md

const { ObjectFreeze } = primordials

const { uncurryThis, applyBind } = internalBinding('smol_util')

// Re-export frozen + null-prototype to match the shape of every other
// internal/socketsecurity/* barrel.
module.exports = ObjectFreeze({
  __proto__: null,
  uncurryThis,
  applyBind,
})
