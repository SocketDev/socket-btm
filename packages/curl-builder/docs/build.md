# curl-builder Build System

This document describes the build system for curl-builder, which builds the curl HTTP library.

## Quick Reference

```bash
pnpm run build           # Build curl for current platform
pnpm run clean           # Clean build artifacts
pnpm test                # Run tests
```

## What is curl-builder?

curl-builder compiles curl with mbedTLS for:
- HTTP/HTTPS client functionality
- TLS/SSL support via mbedTLS
- Minimal size (no unnecessary features)
- Static linking for embedding

## Directory Structure

```
packages/curl-builder/
├── upstream/
│   ├── curl/                      # Git submodule (curl/curl)
│   └── mbedtls/                   # Git submodule (Mbed-TLS/mbedtls)
├── build/                         # Build output (gitignored)
│   ├── curl/                      # curl build artifacts
│   ├── mbedtls/                   # mbedTLS build artifacts
│   └── lib/                       # Static libraries
│       ├── libcurl.a
│       └── libmbedtls.a
├── include/                       # Headers for consumers
└── scripts/build.mjs              # Build orchestrator
```

## Build Process

1. **Configure mbedTLS** - Minimal TLS configuration
2. **Build mbedTLS** - Static library
3. **Configure curl** - Link against mbedTLS
4. **Build curl** - Static library
5. **Install headers** - Copy to include/

## Dependencies

### mbedTLS
Lightweight TLS library. Smaller than OpenSSL, suitable for embedding.

### CMake
Build system for both curl and mbedTLS.

## Build Configuration

### mbedTLS Features
- TLS 1.2/1.3
- X.509 certificates
- No unused ciphers

### curl Features
- HTTP/HTTPS only
- No FTP, SFTP, etc.
- No libssh2
- Static linking

## Platform-Specific Builds

| Platform | Output |
|----------|--------|
| macOS | `build/lib/libcurl.a` |
| Linux | `build/lib/libcurl.a` |
| Windows | `build/lib/curl.lib` |

## Key Paths

| Path | Description |
|------|-------------|
| `build/lib/libcurl.a` | curl static library |
| `build/lib/libmbedtls.a` | mbedTLS static library |
| `include/curl/` | curl headers |
| `upstream/curl/` | curl submodule |
| `upstream/mbedtls/` | mbedTLS submodule |

## Consumers

curl-builder is used by:
- **stubs-builder** - HTTP support in stub loaders

## Updating

To update curl and mbedTLS:
```bash
# Use the updating-curl skill
# Or manually:
cd upstream/curl && git fetch && git checkout curl-X_Y_Z
cd upstream/mbedtls && git fetch && git checkout vX.Y.Z
```

## Testing

```bash
pnpm test                # Run HTTP tests
```

## Cleaning

```bash
pnpm run clean           # Clean build artifacts
```

## Troubleshooting

### CMake errors
Ensure CMake 3.16+ installed.

### TLS handshake fails
Check mbedTLS configuration includes required ciphers.

### Linking errors
Ensure static libraries are found. Check `build/lib/` exists.
