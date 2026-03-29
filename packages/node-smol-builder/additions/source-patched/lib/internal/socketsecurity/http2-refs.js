'use strict';

// Lazy http2 reference module.
//
// Exists to break the bootstrap circular dependency:
//   safe-references.js → require('http2') → debuglog → testEnabled (not ready)
//
// safe-references.js imports this instead of http2 directly.
// The http2 module is only loaded on first access.

let _mod;
module.exports = {
  __proto__: null,
  get createSecureServer() {
    if (!_mod) _mod = require('http2');
    return _mod.createSecureServer;
  },
};
