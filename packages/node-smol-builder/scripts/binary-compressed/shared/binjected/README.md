# Binary Compression Tools

Platform-specific compression tools for Node.js binaries using native OS APIs.

## Requirements

### macOS
- Xcode Command Line Tools or Xcode
- System clang compiler (`/usr/bin/clang`)
- Apple Compression library (libcompression, included in macOS SDK)

**Note**: The Makefile uses system clang (`/usr/bin/clang`) rather than Homebrew's clang to ensure proper access to macOS SDKs and system libraries. The compression library is linked via `-lcompression` (not `-framework Compression` as it's provided as a library in modern macOS).

### Linux
- GCC or Clang
- LZFSE compiled from upstream/lzfse submodule (no external dependencies)

### Windows
- MinGW or MSVC
- Windows SDK

## Building

- **macOS**: `make -f Makefile.macos`
- **Linux**: `make -f Makefile.linux`
- **Windows**: `mingw32-make -f Makefile.windows`

## Shared Cache Implementation

All stubs use a shared header (`dlx_cache_common.h` in build-infra/src) that provides cross-platform caching logic, eliminating code duplication across macOS, Linux, and Windows implementations.

## Caching Strategy

The decompressors follow the exact caching strategy used by socket-lib's dlxBinary.

### Cache Structure

```
~/.socket/_dlx/<cache_key>/<binary_name>
~/.socket/_dlx/<cache_key>/.dlx-metadata.json
```

- **cache_key**: First 16 hex chars of SHA-512 hash of compressed data
- **binary_name**: `node-smol-{platform}-{arch}` (e.g., `node-smol-darwin-arm64`)
- **metadata**: `.dlx-metadata.json` with unified DlxMetadata schema

### Behavior

1. On first execution, the compressed binary:
   - Calculates SHA-512 hash of embedded compressed data
   - Derives cache_key from first 16 hex chars
   - Creates `~/.socket/_dlx/<cache_key>/` recursively if needed
   - Checks if binary exists at `~/.socket/_dlx/<cache_key>/node-smol-{platform}-{arch}`
2. **Cache hit**: Executes directly from cache (instant startup)
3. **Cache miss**: Decompresses to cache with metadata, then executes
4. **Cache unavailable** (permissions, read-only fs): Falls back to temp directory with warning
5. **Both fail**: Exits with clear error message
6. Subsequent executions reuse cached binary

### Metadata Format

Follows the unified DlxMetadata schema shared with socket-lib:

```json
{
  "version": "1.0.0",
  "cache_key": "0123456789abcdef",
  "timestamp": 1730332800000,
  "checksum": "sha512-...",
  "checksum_algorithm": "sha512",
  "platform": "darwin",
  "arch": "arm64",
  "size": 13000000,
  "source": {
    "type": "decompression",
    "path": "/path/to/compressed/binary"
  },
  "extra": {
    "compressed_size": 1700000,
    "compression_algorithm": "lzfse",
    "compression_ratio": 7.647
  }
}
```

## Why Not UPX?

- 50-60% compression vs our 75-79%
- Breaks macOS code signing
- High AV false positive rate
- Self-modifying code (W^X violations)

## Our Approach

- Native OS compression APIs (Apple Compression, LZFSE, Windows Compression API)
- Intelligent caching with content-based addressing
- Preserves code signatures.
- Zero AV false positives.
- Built-in decompression (self-extracting stub).
- Fast subsequent executions via cache reuse.
