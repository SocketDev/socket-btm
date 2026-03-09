# curl-builder

Builds libcurl with mbedTLS for HTTPS support in self-extracting stub binaries.

## Overview

This package builds a minimal static libcurl with HTTPS-only support, using mbedTLS as the TLS backend. The resulting libraries are embedded into self-extracting stubs, enabling update functionality - stubs can securely download artifacts over HTTPS.

Prebuilt libraries are available from GitHub releases for CI builds.

## Build

```bash
# Dev build (default)
pnpm run build

# Prod build
BUILD_MODE=prod pnpm run build

# Force rebuild
pnpm run build --force

# Clean build artifacts
pnpm run clean
```

See [build-infra README](../build-infra/README.md#build-modes) for build mode details.

## Output

Libraries are output to `build/{dev|prod}/out/Final/curl/dist/`:

| File | Description |
|------|-------------|
| `libcurl.a` | Static curl library |
| `libmbedtls.a` | mbedTLS library |
| `libmbedx509.a` | mbedTLS X.509 library |
| `libmbedcrypto.a` | mbedTLS crypto library |
| `include/curl/` | curl headers |

## JavaScript API

```javascript
import { ensureCurl } from 'curl-builder/lib/ensure-curl'

// Ensure curl libraries are available (downloads if needed)
const curlDir = await ensureCurl()
// Returns path to directory containing libcurl.a and mbedTLS libs
```

## Dependencies

- **curl** - HTTP client library (git submodule at `upstream/curl`)
- **mbedTLS** - TLS library (git submodule at `upstream/mbedtls`)
- **build-infra** - Shared build utilities

## Used By

- **stubs-builder** - Self-extracting stub binaries use curl for HTTPS downloads

## Features Disabled

The curl build disables unnecessary features to minimize binary size:

- All protocols except HTTP/HTTPS
- Compression (zlib, brotli, zstd)
- HTTP/2 (nghttp2)
- Cookies, proxy support
- LDAP, SSH, MQTT, etc.

## CI Build

Linux builds use [Depot](https://depot.dev) for faster, cached Docker builds.

**Build features:**
- `CACHE_BUSTER` - Ensures fresh Docker builds on each commit
- `no-cache` - Force rebuild support via workflow `force` input
- `CACHE_VERSION` - Centralized cache versioning (`.github/cache-versions.json`)

**Workflow:** `.github/workflows/curl.yml`

## License

MIT
