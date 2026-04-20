# HTTP constants (`lib/internal/socketsecurity/http/constants.js`)

Pre-computed buffers, status codes, regex patterns, and default values for the zero-allocation HTTP hot path.

Documented source: `packages/node-smol-builder/additions/source-patched/lib/internal/socketsecurity/http/constants.js`.

## Pre-computed response buffers

Allocated once at module load so the response path never hits `BufferFrom` during a request.

| Export | Contents |
| --- | --- |
| `HTTP_200_JSON` | `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: keep-alive\r\nContent-Length: ` |
| `HTTP_200_TEXT` | `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: keep-alive\r\nContent-Length: ` |
| `HTTP_200_EMPTY` | Complete zero-byte 200 — one write, no allocation. |
| `HTTP_200_BINARY` | `application/octet-stream` prefix. |
| `HTTP_404` | `HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n` |
| `HTTP_413` | `413 Payload Too Large` with JSON body. |
| `HTTP_500` | `HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n…` |
| `CRLF_BUF` | `\r\n\r\n` — request/response separator. |

## Status-code tables

- `STATUS_TEXT`: object-of-null-proto mapping `200 → 'OK'`, `404 → 'Not Found'`, etc. 14 codes covered.
- `STATUS_LINE_CACHE`: pre-built buffers like `HTTP/1.1 200 OK\r\nContent-Length: ` for common statuses.
- `KEEP_ALIVE_HEADER`: single `Connection: keep-alive\r\n` buffer.

## Content-type headers

Pre-computed `Content-Type: X\r\nConnection: keep-alive\r\n\r\n` buffers for JSON, text/plain, text/html. Exported as `CT_JSON_KEEPALIVE`, `CT_TEXT_KEEPALIVE`, `CT_HTML_KEEPALIVE`, and as an object `CONTENT_TYPE_HEADERS` indexed by lowercase MIME type.

## Header-name normalization

`COMMON_HEADER_NAMES` — object-of-null-proto mapping both title-case and lowercase variants of frequent header names to their lowercase normalized form. Avoids `toLowerCase()` allocation on the hot path.

## Content-Length cache

- `CONTENT_LENGTH_CACHE_SIZE` = 10,000.
- `CONTENT_LENGTH_CACHE` (getter): lazy-initialized Array of 10,000 pre-computed `Content-Length: N\r\n\r\n` buffers. First access builds the array; subsequent accesses are O(1).

## WebSocket constants

- Opcodes: `WS_OPCODE_TEXT` (0x01), `WS_OPCODE_BINARY` (0x02), `WS_OPCODE_CLOSE` (0x08), `WS_OPCODE_PING` (0x09), `WS_OPCODE_PONG` (0x0a).
- `WS_GUID` = `"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"` (RFC 6455 handshake GUID).
- `WS_UPGRADE_PREFIX`/`WS_UPGRADE_SUFFIX`: pre-built `101 Switching Protocols` header pair.

## Hardened regexes

- `SLASH_REGEX` (`/\//`) — created via `hardenRegExp` so prototype mutation can't alter its match behavior.

## DoS-prevention limits

- `DEFAULT_MAX_BODY_SIZE` = 10 MiB.
- `DEFAULT_MAX_HEADER_SIZE` = 16 KiB.

## HTTP/2 server defaults

Centralized so `http2_helpers.js` and downstream callers share one source of truth.

| Export | Value | Rationale |
| --- | --- | --- |
| `DEFAULT_HTTP2_MAX_CONCURRENT_STREAMS` | 1000 | Higher than Node's 100 default; throughput-focused servers. |
| `DEFAULT_HTTP2_INITIAL_WINDOW_SIZE` | 1,048,576 (1 MiB) | Larger than RFC 7540 default for throughput. |
| `DEFAULT_HTTP2_MAX_FRAME_SIZE` | 16,384 | RFC 7540 minimum. |
| `DEFAULT_HTTP2_MAX_HEADER_LIST_SIZE` | 65,536 (64 KiB) | Reasonable DoS cap. |
| `DEFAULT_HTTP2_SESSION_TIMEOUT` | 120,000 ms (2 min) | Idle session idle timeout. |

## HTTP/1.1 server defaults

| Export | Value |
| --- | --- |
| `DEFAULT_SERVER_PORT` | 3000 |
| `DEFAULT_SERVER_HOSTNAME` | `'0.0.0.0'` |

## undici client defaults

| Export | Value | Rationale |
| --- | --- | --- |
| `DEFAULT_KEEP_ALIVE_TIMEOUT` | 10,000 ms | Close idle sockets after 10s. |
| `DEFAULT_KEEP_ALIVE_MAX_TIMEOUT` | 600,000 ms (10 min) | Upper bound a server response may request. |

## Miscellaneous

- `EMPTY_STRING` = `''` — shared empty-string constant to avoid allocating literal empties in hot paths.
