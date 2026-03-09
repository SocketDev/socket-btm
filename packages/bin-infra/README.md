# bin-infra

Shared binary infrastructure for binary manipulation tools (binject, binpress, binflate).

## Overview

Provides:
- C libraries for binary format detection, segment operations, and compression
- Shared Makefile rules for bin-infra consumers
- JavaScript build utilities for self-extracting stubs
- Binary format constants and test helpers

## Contents

### C Source Files (`src/socketsecurity/bin-infra/`)

**Binary Format Handling:**
- `binary_format.h/c` - Detect and handle Mach-O, ELF, and PE formats
- `marker_finder.h` - Find marker bytes in binary files
- `ptnote_finder.h` - Find PT_NOTE sections in ELF binaries

**Segment Operations:**
- `segment_names.h` - Segment name constants (`SMOL`, `NODE_SEA`, etc.)
- `smol_segment.h/c` - Create and manipulate custom segments
- `smol_segment_reader.h/c` - Read data from custom segments
- `smol_detect.h` - Detection utilities for compressed binaries
- `stub_smol_repack_lief.h` - Repack segments using LIEF library

**Compression:**
- `compression_common.h/c` - LZFSE compression/decompression utilities
- `compression_constants.h` - Compression algorithm constants
- `decompressor_limits.h` - Decompressor buffer limits
- `lzfse.h` - LZFSE library wrapper

**Constants:**
- `buffer_constants.h` - Buffer size constants
- `test.h` - Test utility macros

### JavaScript Modules (`lib/`)

- `builder.mjs` - Generic C/C++ builder utilities
- `build-stubs.mjs` - Build self-extracting stub binaries

### Makefile Rules (`make/`)

- `bin-infra-rules.mk` - Common build rules for bin-infra consumers

### Test Utilities (`test/`)

- `test-write-with-notes.sh` - Test binary writing with PT_NOTE sections
- `helpers/binary-format-constants.mjs` - Binary format detection constants
- `helpers/segment-names.mjs` - Segment name constants for tests
- `helpers/test-utils.mjs` - Test helper functions

### Scripts (`scripts/`)

- `download-binsuite-tools.mjs` - Download binary analysis tools
- `get-stubs-checkpoint-chain.mjs` - Display stub checkpoint dependencies
- `clean.mjs` - Clean build artifacts

### External Dependencies

LIEF and LZFSE are provided by the `lief-builder` sibling package:

- **LIEF** - Binary manipulation library (git submodule at `lief-builder/upstream/lief`)
- **LZFSE** - Compression algorithm (git submodule at `lief-builder/upstream/lzfse`)

## Usage

### Building Stubs

```bash
pnpm run build:stubs
```

Outputs to `build/{dev|prod}/out/Final/` (in stubs-builder package directory).

### Running Tests

```bash
pnpm test
```

Runs `test-write-with-notes.sh` to verify binary writing functionality.

## Used By

- **binject** - Binary injection (uses segment operations, LIEF)
- **binpress** - Binary compression (uses compression utilities, stubs)
- **binflate** - Binary decompression (uses compression utilities)

Note: `node-smol-builder` uses stubs built by `bin-infra` but doesn't directly import from this package. Stubs are standalone binaries embedded by binpress.

## JavaScript API

### `builder.mjs`

Generic C/C++ build utilities:

```javascript
import { buildBinSuitePackage } from 'bin-infra/lib/builder'

await buildBinSuitePackage({
  packageName: 'binflate',
  buildMode: 'prod',
  platform: 'darwin',
  arch: 'arm64',
})
```

### `build-stubs.mjs`

Self-extracting stub helper functions:

```javascript
import { ensureStubs, getStubPath } from 'bin-infra/lib/build-stubs'

// Ensure stubs are built
await ensureStubs({ mode: 'prod', platform: 'darwin', arch: 'arm64' })

// Get path to stub binary (uses current platform)
const stubPath = getStubPath()
```

## Test Helpers

Import segment name constants in tests (using relative paths):

```javascript
import {
  MACHO_SEGMENT_SMOL,
  MACHO_SECTION_PRESSED_DATA,
} from '../../bin-infra/test/helpers/segment-names.mjs'

// Use in binary validation tests (platform-specific constants)
expect(binary).toHaveSegment(MACHO_SEGMENT_SMOL)
```

## Dependencies

- **lief-builder** - Provides LIEF (binary manipulation) and LZFSE (compression algorithm) libraries
- **build-infra** - Shared build utilities

## License

MIT
