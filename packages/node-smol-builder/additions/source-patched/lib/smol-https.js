'use strict'

// Documentation: docs/additions/lib/smol-https.js.md

const { ObjectFreeze, TypeError: TypeErrorCtor } = primordials

const { serve: httpServe } = require('smol-http')

// Performance-oriented TLS defaults (user options override via spread)
const FAST_TLS_DEFAULTS = ObjectFreeze({
  __proto__: null,
  sessionTimeout: 86_400,
  honorCipherOrder: true,
  ecdhCurve: 'X25519:P-256',
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256',
  ].join(':'),
})

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
  const opts = { __proto__: null, ...options }

  // Validate TLS options are provided
  const hasTls = opts.tls || opts.key || opts.cert
  if (!hasTls) {
    throw new TypeErrorCtor(
      'node:smol-https requires TLS options. ' +
        'Provide key/cert options or a tls options object. ' +
        'For HTTP without TLS, use node:smol-http instead.',
    )
  }

  // Default to port 443 for HTTPS
  if (opts.port === undefined) {
    opts.port = 443
  }

  // Inject optimized TLS defaults (user options override)
  const userTls = opts.tls || {}
  opts.tls = { ...FAST_TLS_DEFAULTS, ...userTls }

  // Copy top-level key/cert/ca/passphrase into tls if provided directly
  if (opts.key) opts.tls.key = opts.key
  if (opts.cert) opts.tls.cert = opts.cert
  if (opts.ca) opts.tls.ca = opts.ca
  if (opts.passphrase) opts.tls.passphrase = opts.passphrase

  const server = httpServe(opts)

  // Disable Nagle on pre-handshake TCP socket for faster TLS handshakes
  const origNetServer = server._netServer
  if (origNetServer && typeof origNetServer.on === 'function') {
    origNetServer.on('connection', tcpSocket => {
      tcpSocket.setNoDelay(true)
    })
  }

  return server
}

module.exports = ObjectFreeze({
  __proto__: null,
  serve,
  default: { __proto__: null, serve },
})
