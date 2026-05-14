'use strict'

// node:smol-quic — QUIC + UDP transport, lsquic-backed.
//
// Mirrors bun's QUIC choice: lsquic v4.6.2 with OpenSSL 3.5.6 as the
// TLS backend (instead of BoringSSL — see lsquic-infra/README.md for
// the SSL_set_quic_tls_cbs rationale).
//
// Current surface (steps 1-5 of 8 landed):
//
//   Group 1 — Global init / cleanup
//     globalInit(flags?) -> int
//     globalCleanup()
//   Group 2 — Version + flag enum mirrors
//     version.{Q043, Q046, Q050, ID27, ID29, I001, I002}
//     globalFlags.{CLIENT, SERVER}
//     engineFlags.{SERVER, HTTP}
//     connStatus.{HSK_IN_PROGRESS, CONNECTED, HSK_FAILURE, ...}
//   Group 3 — Engine create / destroy
//     createEngine(flags?) -> engineHandle | 0
//     destroyEngine(engineHandle)
//   Group 4 — Engine I/O
//     engineProcessConns(engineHandle)
//     enginePacketIn(engineHandle, buf, localSa, peerSa, ecn) -> int
//     engineHasUnsent(engineHandle) -> bool
//     engineCountAttq(engineHandle, fromNowMs) -> uint
//     engineQuicVersions(engineHandle) -> uint
//   Group 5 — Engine connect
//     engineConnect(engineHandle, version, localSa, peerSa,
//                   sni, plpmtu, sessResume?, token?) -> connId | 0
//   Group 6 — Connection accessors
//     connClose(connId)
//     connGetStatus(connId) -> { status, error? }
//     connGetCID(connId) -> Uint8Array | null
//     connGetVersion(connId) -> int | -1
//     connGetSNI(connId) -> string | null
//
// Pending (planning round needed for callback dispatcher design):
//   Group 7 — Stream lifecycle (needs on_new_stream callback infra)
//   Group 8 — HTTP/3 framer (smol-http3.js + ls-qpack wiring)
//   Group 9 — Full lsquic_engine_settings struct passthrough (50+ fields)
//   Group 10 — packets_out callback (UDP transport hook) +
//              stream_if callback table + cert_lookup callback
//
// Until the callback infrastructure lands, an engine constructed via
// createEngine() can open a conn via engineConnect() but has no way
// to actually transmit packets (no packets_out callback registered)
// and no way to materialize streams from the conn (no on_new_stream
// callback registered). The handle plumbing is complete; the
// network bridge is the next planning round.
//
// Upstream pin:
//   lsquic v4.6.2 (lsquic-infra/.gitmodules # lsquic-4.6.2)
//   https://github.com/litespeedtech/lsquic/tree/v4.6.2
//
// Public header used by the binding:
//   packages/lsquic-infra/upstream/lsquic/include/lsquic.h

const { ObjectFreeze } = primordials

const {
  connClose,
  connGetCID,
  connGetSNI,
  connGetStatus,
  connGetVersion,
  connStatus,
  createEngine,
  destroyEngine,
  engineConnect,
  engineCountAttq,
  engineFlags,
  engineHasUnsent,
  enginePacketIn,
  engineProcessConns,
  engineQuicVersions,
  globalCleanup,
  globalFlags,
  globalInit,
  version,
} = internalBinding('smol_quic')

module.exports = ObjectFreeze({
  __proto__: null,
  connClose,
  connGetCID,
  connGetSNI,
  connGetStatus,
  connGetVersion,
  connStatus: ObjectFreeze({ __proto__: null, ...connStatus }),
  createEngine,
  destroyEngine,
  engineConnect,
  engineCountAttq,
  engineFlags: ObjectFreeze({ __proto__: null, ...engineFlags }),
  engineHasUnsent,
  enginePacketIn,
  engineProcessConns,
  engineQuicVersions,
  globalCleanup,
  globalFlags: ObjectFreeze({ __proto__: null, ...globalFlags }),
  globalInit,
  version: ObjectFreeze({ __proto__: null, ...version }),
})
