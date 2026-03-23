'use strict';

// node:smol-https - HTTPS server using smol-http with TLS
//
// Like Node.js's https module, this is a thin wrapper around smol-http
// that requires TLS configuration and defaults to port 443.
//
// Usage:
//   import { serve } from 'node:smol-https';
//   import { readFileSync } from 'node:fs';
//
//   serve({
//     port: 443,
//     key: readFileSync('server.key'),
//     cert: readFileSync('server.cert'),
//     fetch(req) {
//       return 'Hello, HTTPS!';
//     },
//   });
//
// TLS options can be passed directly (key, cert, ca, passphrase)
// or via a tls object with any Node.js tls.createServer options.
//
// Note: For HTTP utilities (caching, fast responses, etc.), import from
// node:smol-http directly. This module only exports the serve() function,
// following the same pattern as Node.js's http/https module separation.

const {
  ObjectFreeze,
} = primordials;

const { serve: httpServe } = require('smol-http');

/**
 * Create an HTTPS server.
 * Requires TLS options (key/cert or tls object).
 *
 * @param {object} options Server options
 * @param {number} [options.port=443] Port to listen on (default 443 for HTTPS)
 * @param {string} [options.hostname='0.0.0.0'] Hostname to bind to
 * @param {Buffer|string} [options.key] TLS private key
 * @param {Buffer|string} [options.cert] TLS certificate
 * @param {Buffer|string} [options.ca] TLS CA certificate(s)
 * @param {string} [options.passphrase] Passphrase for private key
 * @param {object} [options.tls] TLS options object (alternative to individual options)
 * @param {function} options.fetch Request handler function
 * @returns {object} Server instance
 * @throws {TypeError} If no TLS options are provided
 */
function serve(options) {
  const opts = { __proto__: null, ...options };

  // Validate TLS options are provided
  const hasTls = opts.tls || opts.key || opts.cert;
  if (!hasTls) {
    throw new TypeError(
      'node:smol-https requires TLS options. ' +
      'Provide key/cert options or a tls options object. ' +
      'For HTTP without TLS, use node:smol-http instead.'
    );
  }

  // Default to port 443 for HTTPS
  if (opts.port === undefined) {
    opts.port = 443;
  }

  return httpServe(opts);
}

module.exports = ObjectFreeze({
  __proto__: null,
  serve,
  default: { __proto__: null, serve },
});
