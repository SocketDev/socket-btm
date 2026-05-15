# smol-quic.js -- Public API for QUIC + UDP transport (node:smol-quic)

## What This File Does

This is the entry point for `require('node:smol-quic')`. It exposes
the lsquic-backed QUIC engine, connection, and stream surface plus
the HTTP/3 header framer. All callbacks are wired through V8
`Global<Function>` slots in the native binding so they survive across
ticks of the libuv loop.

## How It Fits Together

```
require('node:smol-quic') -> this file (smol-quic.js)
  -> internalBinding('smol_quic') (C++ native binding)
    -> additions/source-patched/src/socketsecurity/quic/
       -> quic_binding.cc          -- engine + conn lifecycle
       -> quic_stream_binding.cc   -- stream interface + datagrams
       -> quic_settings_binding.cc -- engine settings + server cert
       -> quic_http3_binding.cc    -- HTTP/3 header set/unset
    -> upstream/lsquic (v4.6.2)    -- TLS via OpenSSL 3.5.6
    -> upstream/ls-qpack (v2.6.2)  -- HTTP/3 header compression
```

TLS backend choice mirrors **bun**: OpenSSL 3.5.6 (not BoringSSL),
using `SSL_set_quic_tls_cbs` for the QUIC handshake. See
`packages/lsquic-infra/README.md` for the rationale (BoringSSL would
require maintaining a parallel OpenSSL build for the rest of the
binary).

## Public API

Groups by lifecycle phase:

### 1. Global init / cleanup

```ts
import { globalInit, globalCleanup, globalFlags } from 'node:smol-quic'
globalInit(globalFlags.CLIENT) // or .SERVER
// ... use engines ...
globalCleanup()
```

### 2. Version + flag enum mirrors

```ts
import { version, engineFlags, connStatus } from 'node:smol-quic'
// version.{Q043, Q046, Q050, ID27, ID29, I001, I002}
// engineFlags.{SERVER, HTTP}
// connStatus.{HSK_IN_PROGRESS, CONNECTED, HSK_FAILURE, ...}
```

### 3. Engine create / destroy

```ts
const engine = createEngine(
  engineFlags.HTTP,
  {
    packetsOut: packets => {
      /* send each via UDP socket */
    },
    onNewConn: connId => {},
    onConnClosed: connId => {},
    onNewStream: (streamId, connId) => {},
    onRead: (streamId, data) => {},
    onWrite: streamId => {},
    onClose: streamId => {},
    onHskDone: (connId, ok) => {},
    onGoawayReceived: connId => {},
    onDatagramWrite: (connId, buf) => {},
    onDatagram: (connId, data) => {},
  } /* optional settings */,
)
destroyEngine(engine)
```

### 4. Engine I/O

```ts
engineProcessConns(engine)
enginePacketIn(engine, buf, localSa, peerSa, ecn)
engineHasUnsent(engine) // -> bool
engineCountAttq(engine, fromNowMs) // -> uint
```

### 5. Engine connect (client side)

```ts
const connId = engineConnect(
  engine,
  version.I001,
  localSa,
  peerSa,
  /* sni */ 'example.com',
  /* plpmtu */ 1350,
  /* sessResume? */ null,
  /* token? */ null,
)
```

### 6. Connection accessors

```ts
connClose(connId)
connGetStatus(connId) // -> { status, error? }
connGetCID(connId) // -> Uint8Array | null
connGetVersion(connId) // -> int
connGetSNI(connId) // -> string | null
```

### 7. Streams

```ts
streamWrite(streamId, buf)
streamRead(streamId, buf, off, n)
streamWantRead(streamId, want)
streamWantWrite(streamId, want)
streamShutdown(streamId, mode)
streamClose(streamId)
```

### 8. HTTP/3 headers (QPACK)

```ts
streamSendHeaders(streamId, headers, fin)
streamGetHeaders(streamId) // -> { ...headers }
```

### 9. Datagrams (unreliable)

```ts
connSetMinDatagramSize(connId, n)
connGetMinDatagramSize(connId)
connWantDatagramWrite(connId, want)
```

### 10. Server cert

```ts
setServerCertContext(certPem, keyPem)
```

## Design Choices

- **Callback persistence via `Global<Function>`**: each engine slot
  holds JS callbacks across libuv ticks; the binding never invokes
  a freed function reference.
- **Settings via table-driven marshaler**: `quic_settings_binding.cc`
  uses `offsetof` + a `FieldType` enum so adding a new setting is one
  table row.
- **Datagrams under the connection, not the stream**: matches RFC 9221
  semantics; they're independent of any stream's flow.

## Where the Real Work Happens

- `quic_binding.cc` (956 LOC) -- engine + conn lifecycle, wires
  `ea_packets_out` / `ea_stream_if` / `ea_lookup_cert` / `ea_hsi_if`.
- `quic_stream_binding.cc` (693 LOC) -- 8 stream trampolines + 3
  datagram conn methods.
- `quic_settings_binding.cc` (387 LOC) -- ApplyJsSettings,
  SetServerCertContext, LookupCertTrampoline.
- `quic_http3_binding.cc` (306 LOC) -- HeaderSet POD,
  streamGetHeaders / streamSendHeaders.
- `quic_internal.h` -- shared types (JsCallbackTable, EngineSlot,
  ConnSlot, StreamSlot, registries).
