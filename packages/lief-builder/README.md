# lief-builder

Builds LIEF library for binary format manipulation and LZFSE compression library.

## Overview

This package builds:
- **LIEF** - Library to Instrument Executable Formats (Mach-O, ELF, PE manipulation)
- **LZFSE** - Apple's compression algorithm (used for compressing node-smol binaries)

It also provides:
- Shared Makefile rules for LIEF and LZFSE compilation (`make/lief.mk`, `make/lzfse.mk`)

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

Libraries are output to `build/{dev|prod}/out/Final/lief/`:

| File | Description |
|------|-------------|
| `libLIEF.a` | Static LIEF library (Unix) |
| `LIEF.lib` | Static LIEF library (Windows/MSVC) |
| `include/LIEF/` | LIEF headers |

LZFSE is built as part of LIEF's dependencies.

## JavaScript API

```javascript
import { ensureLief } from 'lief-builder/lib/ensure-lief'

// Ensure LIEF library is available (downloads if needed)
const liefPath = await ensureLief()
// Returns path to libLIEF.a or LIEF.lib
```

## Version Alignment

The LIEF version is aligned with upstream Node.js (which uses LIEF internally for SEA support). This ensures ABI compatibility when manipulating Node.js binaries.

## Dependencies

- **LIEF** - Binary manipulation library (git submodule at `upstream/lief`)
- **LZFSE** - Compression library (git submodule at `upstream/lzfse`)
- **build-infra** - Shared build utilities

## Patches

Socket-specific patches are applied from `patches/lief/`:
- Remove 1MB note size limit (allows larger SEA/VFS segments)

## Used By

- **bin-infra** - Binary format handling
- **binject** - SEA/VFS injection (uses LIEF for segment manipulation)
- **binpress** - Binary compression (uses LZFSE)
- **binflate** - Binary decompression (uses LZFSE)

## Platform Notes

- **musl Linux**: Fortify source is disabled to avoid glibc-specific symbols
- **Windows**: Built with MinGW for consistent ABI with binject
- **Cross-compilation**: Set `TARGET_ARCH` environment variable

## CI Build

Linux builds use [Depot](https://depot.dev) for faster, cached Docker builds.

**Build features:**
- `CACHE_BUSTER` - Ensures fresh Docker builds on each commit
- `no-cache` - Force rebuild support via workflow `force` input
- `CACHE_VERSION` - Centralized cache versioning (`.github/cache-versions.json`)

**Workflow:** `.github/workflows/lief.yml`

## License

MIT
