# Shared Cache: ~/.socket/_cacache/

A cross-language, cross-project content-addressable cache. Used by socket-cli,
socket-sdk-js, socket-btm, and ultrathink for HTTP responses, build artifacts,
and API caching.

## Quick Start

### TypeScript
```typescript
import { cacheGet, cachePut, cacheRemove } from './socket-cache.js'

await cachePut('http:my-url-hash', Buffer.from('response body'))
const data = await cacheGet('http:my-url-hash')  // Buffer | null
await cacheRemove('http:my-url-hash')
```

### Go
```go
import "github.com/ultrathink/acorn-go/pkg/acorn"

acorn.CachePut("http:my-url-hash", []byte("response body"), nil)
data, err := acorn.CacheGet("http:my-url-hash")
acorn.CacheRemove("http:my-url-hash")
```

### Rust
```rust
use rust_acorn::socket_cache::{cacache_get, cacache_put, cacache_remove};

cacache_put("socket-ultrathink:http:my-url-hash", b"response body", None)?;
let data = cacache_get("socket-ultrathink:http:my-url-hash");
cacache_remove("socket-ultrathink:http:my-url-hash")?;
```

### C / C++
```c
#include "socketsecurity/build-infra/socket_cacache.h"

cacache_put("socket-btm:http:my-url-hash", data, data_len, "");
uint8_t *out; size_t len;
cacache_get("socket-btm:http:my-url-hash", &out, &len);
free(out);
cacache_remove("socket-btm:http:my-url-hash");
```

## How It Works

The cache uses [npm's cacache](https://github.com/npm/cacache) on-disk format.
Every language implementation writes the same bytes, so entries are readable
across languages. A Go program can read what Rust wrote. Node.js can read
what C wrote. It all just works.

### On-Disk Layout

```
~/.socket/_cacache/
├── index-v5/                    # Key → content mapping
│   └── {sha256(key)[0:2]}/
│       └── {sha256(key)[2:4]}/
│           └── {sha256(key)[4:]}   # Append-only text file
│
├── content-v2/                  # Content-addressed blobs
│   └── sha512/
│       └── {sha512(data)[0:2]}/
│           └── {sha512(data)[2:4]}/
│               └── {sha512(data)[4:]}   # Raw bytes
│
└── tmp/                         # Atomic write staging
```

### Index File Format

Each line in an index file:
```
{sha1(json)}\t{json}\n
```

Where the JSON is:
```json
{
  "key": "socket-ultrathink:http:abc123",
  "integrity": "sha512-BaSe64EnCoDeDhAsH==",
  "time": 1712144100000,
  "size": 1024,
  "metadata": {"expiresAt": 1712144400000}
}
```

- **key**: The full cache key (with prefix)
- **integrity**: `sha512-{base64(sha512(data))}` — links to content file
- **time**: Unix milliseconds when the entry was written
- **size**: Data size in bytes
- **metadata**: Always present. Can be `{}` or contain TTL/expiry info

### Content File Path

The integrity string tells you where the content lives:

```
integrity: sha512-BaSe64...
    ↓ decode base64 → raw bytes → hex string
    ↓ split: hex[0:2] / hex[2:4] / hex[4:]
    ↓
content-v2/sha512/ba/5a/55deadbeefc0ffee...
```

### Deletion

Deletion is a **soft delete**. We append a new index entry with `"integrity": null`:

```json
{"key":"socket-ultrathink:http:abc123","integrity":null,"time":1712145000000,"size":0,"metadata":{}}
```

This shadows all previous entries for the same key. The content file stays on
disk (it's content-addressed and might be shared by other keys). This is the
same behavior as npm's cacache — no data loss, no race conditions.

## Key Namespace Convention

Every key must be prefixed with the project name to avoid collisions:

| Prefix | Project | Example |
|--------|---------|---------|
| `socket-ultrathink:` | ultrathink/acorn | `socket-ultrathink:http:test262-sha256` |
| `socket-btm:` | socket-btm | `socket-btm:build:node-v22-darwin-arm64` |
| `socket-sdk:` | socket-sdk-js | `socket-sdk:quota` |
| `github-refs:` | @socketsecurity/lib | `github-refs:main-sha` |

Go and TypeScript implementations auto-prefix with `socket-ultrathink:`.
Rust and C require the caller to include the prefix.

## Cache Directory Resolution

All implementations follow the same priority order
(lock-step with `@socketsecurity/lib` `getSocketCacacheDir()`):

| Priority | Source | Path |
|----------|--------|------|
| 1 | `SOCKET_CACACHE_DIR` env var | `$SOCKET_CACACHE_DIR` |
| 2 | `SOCKET_HOME` env var | `$SOCKET_HOME/_cacache` |
| 3 | `HOME` env var (Unix) | `$HOME/.socket/_cacache` |
| 3 | `USERPROFILE` env var (Windows) | `%USERPROFILE%\.socket\_cacache` |
| 4 | `os.homedir()` / `os.UserHomeDir()` | `{homedir}/.socket/_cacache` |
| 5 | tmpdir fallback | `{tmpdir}/.socket/_cacache` |

## When to Use This Cache (and When Not To)

**Use `~/.socket/_cacache/` for:**
- HTTP response caching (test262 downloads, API responses)
- Downloaded build artifacts (binaries, tarballs)
- Anything that benefits from content-addressing and integrity checking
- Data shared between different tools or languages

**Don't use it for:**
- Performance-critical parser data (tokens, AST). The SHA-512 integrity
  check adds ~40ms per read — that's fine for a 10KB HTTP response, but
  unacceptable for a 9MB token array on a hot path.
- Ephemeral runtime state (use the daemon socket instead)

For parser-specific fast caching, use the flat file cache at the platform-
standard location (`~/Library/Caches/acorn-asb/` on macOS). See
[platform-dirs.mjs](../lib/platform-dirs.mjs).

## Implementation Files

| Language | File | Dependencies |
|----------|------|-------------|
| TypeScript | `packages/acorn/lang/typescript/src/socket-cache.ts` | `cacache` npm package |
| Go | `packages/acorn/lang/go/pkg/acorn/socket_cache.go` | stdlib only |
| Rust | `packages/acorn/lang/rust/src/socket_cache.rs` | no deps (pure Rust SHA) |
| C/C++ | `socket-btm/packages/build-infra/.../socket_cacache.h` | CommonCrypto/OpenSSL |

## Hashing Algorithms

Three hash algorithms are used, each for a different purpose:

| Algorithm | Purpose | Encoding | Example |
|-----------|---------|----------|---------|
| SHA-256 | Index file path from key | Hex | `index-v5/66/8d/2001c8b6...` |
| SHA-512 | Content integrity + path | Base64 (integrity), Hex (path) | `sha512-BaSe64...` |
| SHA-1 | Index line verification | Hex | `65428e23a20eb1c6...` |

## Cross-Language Compatibility

All four implementations produce byte-identical output for the same input.
This has been verified:

- **C → Node.js**: C writes entry, Node.js `cacache.get()` reads it ✓
- **Go ↔ TypeScript**: Bidirectional read/write verified ✓
- **Rust ↔ Node.js**: Bidirectional read/write verified ✓

The format is stable (cacache v20, index-v5, content-v2). Entries written
today will be readable by future versions.

## Troubleshooting

**Cache directory doesn't exist**: All implementations create it on first write.

**Permission errors**: Check `~/.socket/` directory permissions. Should be
owned by the current user with `0755` permissions.

**Stale entries**: Use the remove function for soft-delete. To fully clear:
```bash
rm -rf ~/.socket/_cacache/
```

**Integrity mismatch on read**: The content file was corrupted or modified.
Delete it and let the next write recreate it:
```bash
rm -rf ~/.socket/_cacache/content-v2/
```

**Override for testing**: Set `SOCKET_CACACHE_DIR=/tmp/test-cache` to use a
temporary directory that won't affect your real cache.

## Atomic Writes

All write operations go through a staging directory (`~/.socket/_tmp/`)
before atomic rename into the cache. This prevents:

- **Cross-device rename failures** (EXDEV) when system tmpdir is a different mount
- **Partial content** from interrupted writes — readers never see incomplete files
- **Data loss** on power failure — content is either fully written or not at all

```
Write flow:
1. Create   ~/.socket/_tmp/tmp-{pid}-{timestamp}
2. Write    data to temp file
3. rename   temp → ~/.socket/_cacache/content-v2/sha512/{path}
4. Append   index entry (SHA-1 protected line)

If rename fails (EXDEV, permissions):
   → Clean up temp file
   → Fall back to direct write
```

Override staging dir: `SOCKET_TMP_DIR=/path/to/staging`

## Error Handling

All implementations use consistent error message patterns:

| Error | Message Pattern |
|-------|----------------|
| Dir creation | `socket-cache: directory creation failed: {path}: {os_error}` |
| Write | `socket-cache: write failed: {path}: {os_error}` |
| Read | `socket-cache: read failed: {path}: {os_error}` |
| Integrity | `socket-cache: integrity mismatch: expected {expected}, got {actual}` |
| Corrupt index | `socket-cache: corrupt index entry: {reason}` |
| Permission | `socket-cache: permission denied: {path}` |

### Error behavior by operation

| Operation | Dir missing | Permission denied | Disk full | Corrupt data |
|-----------|-----------|-------------------|-----------|-------------|
| **get** | Return None/nil | Return None/nil | N/A | Return None/nil (integrity check fails) |
| **put** | Create dirs | Return error | Return error | N/A |
| **remove** | Create dirs | Return error | Return error | N/A |

All errors are **non-fatal** — callers should handle gracefully:
- **get** failures: proceed without cache (cold path)
- **put** failures: log warning, continue without caching
- **remove** failures: log warning, entry will be shadowed on next put

### Data integrity on read

| Check | Rust | Go | C | TypeScript |
|-------|------|-----|---|-----------|
| SHA-1 index line hash | Yes | Yes | Yes | Via cacache |
| SHA-512 content integrity | Yes | Yes | Yes | Via cacache |
| Content size vs entry.size | No | No | No | Via cacache |
| Null integrity (deleted) | Yes | Yes | Yes | Via cacache |

### Concurrency

Multiple processes can safely read/write the same cache:
- **Index appends** are atomic-ish (append mode, SHA-1 protects partial reads)
- **Content writes** are atomic via staging dir + rename
- **Reads during write** see either old data or new data, never partial
- **Concurrent writes of same key** both succeed (last-writer-wins via index)

### Known limitations

| Limitation | Impact | Mitigation |
|-----------|--------|-----------|
| No file locking | Concurrent appends may interleave on some OS/FS combos | SHA-1 line hash detects corruption |
| No fsync | Data loss possible on power failure | Acceptable for cache (can be regenerated) |
| No symlink protection | Symlink in cache path could redirect reads/writes | Use trusted HOME/SOCKET_HOME only |
| No GC | Content files accumulate over time | Manual `rm -rf ~/.socket/_cacache/` |
| Network FS | Weak atomicity guarantees on NFS/SMB | Not recommended; use local disk |
