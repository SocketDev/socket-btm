'use strict'

// node:smol-quic — QUIC + UDP transport, lsquic-backed.
//
// Mirrors bun's QUIC choice: lsquic v4.6.2 with OpenSSL 3.5.6 as the
// TLS backend (instead of BoringSSL — see lsquic-infra/README.md for
// the SSL_set_quic_tls_cbs rationale).
//
// Current surface (steps 1-8 of 8 landed + HTTP/3 framer):
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
//     createEngine(flags, callbacks, settings?) -> engineHandle | 0
//       callbacks: { packetsOut, onNewConn?, onConnClosed?,
//                    onNewStream?, onRead?, onWrite?, onClose?,
//                    onHskDone?, onGoawayReceived?,
//                    onDatagramWrite?, onDatagram? }
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
//   Group 7 — Stream methods (step 6/8)
//     streamRead(streamId, dest: Uint8Array) -> int (bytes; -1 err)
//     streamWrite(streamId, src: Uint8Array) -> int (bytes; -1 err)
//     streamShutdown(streamId, how) -> int  // 0=read, 1=write, 2=both
//     streamClose(streamId) -> int
//     streamWantRead(streamId, want: bool) -> int  // prev flag
//     streamWantWrite(streamId, want: bool) -> int
//   Group 8 — Datagrams (step 7/8)
//     connWantDatagramWrite(connId, want: bool) -> int
//     connGetMinDatagramSize(connId) -> int
//     connSetMinDatagramSize(connId, sz) -> int
//     callbacks.onDatagramWrite(connId, maxBytes) -> Uint8Array | null
//     callbacks.onDatagram(connId, data: Uint8Array) -> void
//   Group 9 — Settings + server cert (step 8/8)
//     createEngine(flags, callbacks, settings?) — settings is a JS
//       object whose camelCase keys map to lsquic_engine_settings
//       fields. ~30 commonly-tuned fields covered: idleTimeout,
//       pingPeriod, maxStreamsIn, initMax*, qpack*, ecn, datagrams,
//       dplpmtud, base/maxPlpmtu, maxUdpPayloadSizeRx, ccAlgo,
//       pacePackets, etc. Unknown keys are silently ignored. See
//       quic_settings_binding.cc for the full table.
//     setServerCertContext(engineHandle, certPem: Uint8Array,
//                          keyPem: Uint8Array) -> true
//       Builds an SSL_CTX from PEM cert+key bytes and stashes it on
//       the engine slot. Server engines need this before accepting
//       connections. Single-SNI for now; multi-SNI dispatch is a
//       future refinement.
//
//   Group 10 — HTTP/3 framer (post-step-8)
//     streamGetHeaders(streamId) -> {name: value, ...} | null
//       Claims the decoded HEADERS frame from a server-pushed or
//       client-received stream. Returns null if no headers are
//       available (stream isn't HTTP/3, HEADERS hasn't arrived yet,
//       or already claimed). lsquic owns the QPACK decode via
//       ls-qpack; this just marshals to JS.
//     streamSendHeaders(streamId, headersObj, eos: bool) -> int
//       Flattens a JS object {":status": "200", ...} into an
//       lsxpack_header[] + contiguous backing buffer, calls
//       lsquic_stream_send_headers. JS is responsible for HTTP/3
//       pseudo-header ordering (:method/:scheme/:authority/:path
//       first for requests, :status first for responses).
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
  connGetMinDatagramSize,
  connGetSNI,
  connGetStatus,
  connGetVersion,
  connSetMinDatagramSize,
  connStatus,
  connWantDatagramWrite,
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
  setServerCertContext,
  streamClose,
  streamGetHeaders,
  streamRead,
  streamSendHeaders,
  streamShutdown,
  streamWantRead,
  streamWantWrite,
  streamWrite,
  version,
} = internalBinding('smol_quic')

module.exports = ObjectFreeze({
  __proto__: null,
  connClose,
  connGetCID,
  connGetMinDatagramSize,
  connGetSNI,
  connGetStatus,
  connGetVersion,
  connSetMinDatagramSize,
  connStatus: ObjectFreeze({ __proto__: null, ...connStatus }),
  connWantDatagramWrite,
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
  setServerCertContext,
  streamClose,
  streamGetHeaders,
  streamRead,
  streamSendHeaders,
  streamShutdown,
  streamWantRead,
  streamWantWrite,
  streamWrite,
  version: ObjectFreeze({ __proto__: null, ...version }),
})
