# DLX Caching Strategy

Self-extracting binaries (node-smol) decompress to a shared cache for fast subsequent runs.

## Cache Location

Priority order:
1. `SOCKET_DLX_DIR` - Full override
2. `SOCKET_HOME/_dlx` - Custom base directory
3. `~/.socket/_dlx` - Default
4. `/tmp/.socket/_dlx` - Fallback (Unix) or `C:\temp\.socket\_dlx` (Windows)

## Cache Structure

```
~/.socket/_dlx/
└── <cache_key>/           # First 16 hex chars of SHA-512 hash
    ├── node               # Extracted binary (node.exe on Windows)
    └── .dlx-metadata.json # Extraction metadata
```

## Cache Key Generation

The cache key is the first 16 hex characters of the SHA-512 hash of the compressed binary content. This matches [socket-lib's generateCacheKey](https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/dlx.ts#L55).

```
compressed binary → SHA-512 → first 16 hex chars → cache_key
```

## Metadata Schema (v1.0.0)

```json
{
  "version": "1.0.0",
  "cache_key": "a1b2c3d4e5f67890",
  "timestamp": 1706140800000,
  "integrity": "sha512-<base64>",
  "size": 23456789,
  "source": {
    "type": "extract",
    "path": "/path/to/compressed/binary"
  },
  "update_check": {
    "last_check": 1706140800000,
    "last_notification": 1706054400000,
    "latest_known": "1.2.3"
  }
}
```

## Cache Validation

Before using a cached binary:
1. Check file exists at `<cache_dir>/<cache_key>/node`
2. Verify file size matches expected decompressed size
3. Verify executable permissions (Unix)
4. Use `O_NOFOLLOW` to prevent symlink attacks

## Platform-Specific Implementation

| Platform | Crypto Library | Hash Function |
|----------|---------------|---------------|
| macOS | CommonCrypto | `CC_SHA512` |
| Linux | OpenSSL | `SHA512` |
| Windows | CryptoAPI | `CALG_SHA_512` |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SOCKET_DLX_DIR` | Override entire cache directory |
| `SOCKET_HOME` | Override base directory (appends `/_dlx`) |

## Implementation

Core implementation: [`src/dlx_cache_common.h`](../src/dlx_cache_common.h)

Key functions:
- `dlx_calculate_cache_key()` - Generate 16-char hex cache key
- `dlx_calculate_integrity()` - Generate SRI hash (`sha512-<base64>`)
- `dlx_get_cache_base_dir()` - Resolve cache directory with env var support
- `dlx_get_cached_binary_path()` - Check for valid cached binary
- `dlx_write_to_cache()` - Write decompressed binary and metadata
