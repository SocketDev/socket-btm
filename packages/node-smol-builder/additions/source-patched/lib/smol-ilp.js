'use strict'

// Documentation: docs/additions/lib/smol-ilp.js.md

const { ObjectFreeze } = primordials

const {
  Sender,
  BulkRowBuilder,
  TimeUnit,
  ILPError,
  ErrorCodes,
} = require('internal/socketsecurity/ilp')

module.exports = ObjectFreeze({
  __proto__: null,
  Sender,
  BulkRowBuilder,
  TimeUnit,
  ILPError,
  ErrorCodes,
  default: Sender,
})
