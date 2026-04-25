# internal/socketsecurity/vfs/tar_gzip

Gzip + TAR archive support for the VFS loader. Lazy-required from
`loader.js` only when the archive needs decompression; uncompressed
`.tar` payloads bypass this module entirely and go straight to
`tar_parser`.

## Why this module exists

`sea_path` and `extraction_provider` hand the loader an opaque `Buffer`
that can be either a plain `.tar` or a gzipped `.tar.gz`. Rather than
forcing every call site to know which it is, `parseAuto` sniffs the
gzip magic number and dispatches. This keeps the loader's provider
interface shape-independent of the compression used at pack time.

Uses `GunzipSync` from `internal/socketsecurity/safe-references`
(resolved lazily so bootstrap-time code never pulls in `zlib`).

## API

### `parseAuto(buffer, options) → Map<string, Buffer>`

Magic-byte-sniffing dispatch:

- If `buffer` starts with `1F 8B` (gzip magic) → `parseTarGzip`
- Otherwise → `parseTar` directly

Throws `TypeError` if `buffer` is not a `Buffer`. Debug logging under
`NODE_DEBUG_VFS=1` (a separate boolean env var, not the standard
`NODE_DEBUG=<category>` channel) announces which branch was taken.

### `parseTarGzip(gzipBuffer, options) → Map<string, Buffer>`

Decompress gzip, then parse as TAR. `options` is forwarded to
`parseTar` (filters, size caps, etc.).

## Error taxonomy

All errors surface as `Error` (not `TypeError`) so callers can
distinguish a malformed buffer from an unexpected input shape:

| Condition                           | Thrown message                                   |
| ----------------------------------- | ------------------------------------------------ |
| `gzipBuffer` is not a `Buffer`      | `TypeError: gzipBuffer must be a Buffer`         |
| Gzip magic number missing           | `Invalid gzip format: magic number mismatch`    |
| zlib returns `Z_DATA_ERROR`         | `Gzip decompression failed: corrupted data`      |
| zlib returns `Z_BUF_ERROR`          | `Gzip decompression failed: buffer error`        |
| Any other zlib error                | `Gzip decompression failed: <error.message>`     |

TAR parse errors bubble up from `parseTar` unchanged.

## Primordials

Uses the usual `primordials.{Error, TypeError, ObjectFreeze}` to
resist prototype pollution. The exports object is frozen with
`__proto__: null` so callers can't mutate the module surface.
