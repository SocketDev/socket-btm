'use strict'

// node:smol-quic — QUIC + UDP transport, lsquic-backed.
//
// Mirrors bun's QUIC choice: lsquic v4.6.2 with OpenSSL 3.5.6 as the
// TLS backend (instead of BoringSSL — see lsquic-infra/README.md for
// the SSL_set_quic_tls_cbs rationale). Eight functional groups:
//
//   - Global init / cleanup (globalInit / globalCleanup)
//   - Version + global-flag enum mirrors
//   - Engine create / destroy (followup commits)
//   - Engine I/O (process / packetIn / count)
//   - Engine connect (outbound)
//   - Connection lifecycle (close / status / cid / peer addr / alpn)
//   - Stream lifecycle (open / close / read / write / shutdown / pri)
//
// HTTP/3 framer + qpack live in lib/smol-http3.js — keep the
// transport-layer surface (this file) free of HTTP/3 specifics.
//
// Upstream pin:
//   lsquic v4.6.2 (lsquic-infra/.gitmodules # lsquic-4.6.2)
//   https://github.com/litespeedtech/lsquic/tree/v4.6.2
//
// Public header used by the binding:
//   packages/lsquic-infra/upstream/lsquic/include/lsquic.h

const { ObjectFreeze } = primordials

const {
  createEngine,
  destroyEngine,
  engineFlags,
  globalCleanup,
  globalFlags,
  globalInit,
  version,
} = internalBinding('smol_quic')

module.exports = ObjectFreeze({
  __proto__: null,
  createEngine,
  destroyEngine,
  engineFlags: ObjectFreeze({ __proto__: null, ...engineFlags }),
  globalCleanup,
  globalFlags: ObjectFreeze({ __proto__: null, ...globalFlags }),
  globalInit,
  version: ObjectFreeze({ __proto__: null, ...version }),
})
