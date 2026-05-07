'use strict'

// Documentation: docs/additions/lib/smol-http.js.md

const { ObjectFreeze } = primordials

// The barrel handles lazy loading of heavy modules (caches, http2).
// We re-export it frozen for the public API.
const httpModule = require('internal/socketsecurity/http')

module.exports = ObjectFreeze({
  __proto__: null,
  ...httpModule,
  default: httpModule,
})
