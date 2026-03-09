# bin-infra Documentation

Documentation for binary infrastructure utilities.

## Glossary

| Term | Definition |
|------|------------|
| **SMOL** | "Small" (internet slang) - the compressed, self-extracting binary format |
| **SEA** | Single Executable Application - Node.js feature for bundling apps into binaries |
| **VFS** | Virtual Filesystem - embedded filesystem for bundling assets |
| **LIEF** | Library to Instrument Executable Formats - binary manipulation library |
| **Stub** | Self-extracting wrapper that decompresses and runs the payload |
| **DLX** | Decompression cache directory (`~/.socket/_dlx/`) |
| **SMFG** | SMOL conFiG - binary configuration format (1192 bytes) |
| **SVFG** | VFS conFiG - VFS configuration format (366 bytes) |
| **LZFSE** | Apple's compression algorithm used for SMOL binaries |

## Overview

bin-infra provides shared C/C++ libraries and JavaScript utilities for binary format handling, compression, and SMOL segment operations. Used by binject, binpress, binflate, stubs-builder, and node-smol.

## Package Relationships

| Package | Purpose | Inputs | Outputs |
|---------|---------|--------|---------|
| **node-smol-builder** | Build compressed Node.js | Node.js source + patches | ~22MB SMOL binary |
| **binject** | Inject SEA/VFS into binaries | Binary + SEA/VFS blobs | Injected binary |
| **binpress** | Compress binaries with stubs | Binary | Self-extracting SMOL |
| **binflate** | Extract compressed binaries | SMOL binary | Original binary |
| **stubs-builder** | Self-extracting wrappers | - | Stub executables |
| **bin-infra** | Shared binary utilities | - | C/C++ libraries |
| **build-infra** | Shared build utilities | - | JS build tools |

## End-to-End Data Flow

```
                          BUILD FLOW
┌─────────────────────────────────────────────────────────────┐
│  Node.js Source                                              │
│       │                                                      │
│       ▼                                                      │
│  [node-smol-builder] ──► ~93MB binary ──► Strip ──► ~61MB   │
│       │                                                      │
│       ▼                                                      │
│  [binpress] ──► Compress with stub ──► ~22MB SMOL binary    │
└─────────────────────────────────────────────────────────────┘

                          USER FLOW
┌─────────────────────────────────────────────────────────────┐
│  Your App (app.js)                                           │
│       │                                                      │
│       ▼                                                      │
│  node --experimental-sea-config ──► app.blob (SEA)          │
│       │                                                      │
│       ▼                                                      │
│  [binject] ──► Inject SEA into node-smol ──► myapp (~22MB)  │
│       │                                                      │
│       ▼                                                      │
│  User runs ./myapp ──► Stub extracts ──► Cached + executed  │
└─────────────────────────────────────────────────────────────┘
```

**Why separate packages?**
- **bin-infra vs build-infra**: bin-infra = binary-specific (LIEF, compression), build-infra = generic (checkpoints, tools)
- **binpress vs binflate**: Inverse operations (compress/extract) with different dependencies
- **binject**: SEA/VFS injection is independent of compression

## Documentation Index

### Architecture

bin-infra is the foundational layer for binary manipulation across socket-btm. It provides:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CONSUMERS                                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌──────────────┐  ┌──────────┐ │
│  │ binject │  │binpress │  │binflate │  │stubs-builder │  │node-smol │ │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬─────────┘  └────┬─────┘ │
└───────┼────────────┼────────────┼────────────┼─────────────────┼───────┘
        │            │            │            │                 │
        └────────────┴────────────┴────────────┴─────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │        bin-infra          │
                    │  ┌─────────────────────┐  │
                    │  │  C/C++ Libraries    │  │
                    │  │  - binary_format    │  │
                    │  │  - compression      │  │
                    │  │  - smol_segment     │  │
                    │  └─────────────────────┘  │
                    │  ┌─────────────────────┐  │
                    │  │  LIEF Utilities     │  │
                    │  │  - section_ops      │  │
                    │  │  - lief_traits      │  │
                    │  │  - sea_fuse         │  │
                    │  └─────────────────────┘  │
                    │  ┌─────────────────────┐  │
                    │  │  JS Build Tools     │  │
                    │  │  - build-stubs.mjs  │  │
                    │  │  - builder.mjs      │  │
                    │  └─────────────────────┘  │
                    └───────────┬───────────────┘
                                │
                    ┌───────────▼───────────┐
                    │      build-infra      │
                    │  (shared build utils) │
                    └───────────────────────┘
```

**Key Design Decisions:**

1. **Header-only C++ templates** - LIEF utilities use templates to avoid ABI issues across platforms
2. **Platform abstraction via traits** - `binject_lief_traits.hpp` provides platform-specific type mappings
3. **Exception-free C++** - All code compiles with `-fno-exceptions` to match Node.js build config
4. **Shared constants** - `segment_names.h` centralizes segment/section naming for consistency

**Data Flow:**

```
Binary Input → Format Detection → Platform-Specific Handler → LIEF Operations → Binary Output
                    ↓                       ↓
              binary_format.c        macho_lief_utils.hpp
                                     elf_note_utils.hpp
                                     pe_lief_utils.hpp
```

### Quick Reference

| Component | Files | Purpose |
|-----------|-------|---------|
| Binary Format | `binary_format.c/.h` | ELF/Mach-O/PE detection |
| Compression | `compression_common.c/.h` | LZFSE compress/decompress |
| SMOL Segment | `smol_segment.c/.h` | SMOL metadata handling |
| LIEF Utilities | `binject_*.hpp` | Cross-platform LIEF operations |
| Segment Names | `segment_names.h` | Section/segment name constants |
| Stub Repack | `stub_smol_repack_lief.cpp` | SMOL stub repacking |

### Magic Marker

```
__SMOL_PRESSED_DATA_MAGIC_MARKER (32 bytes)
```

### Segment/Section Names

| Logical Name | Mach-O Segment | Mach-O Section | ELF Section |
|--------------|----------------|----------------|-------------|
| SMOL | `SMOL` | `__PRESSED_DATA` | `.note.smol` |
| NODE_SEA | `NODE_SEA` | `__NODE_SEA_BLOB` | `.note.node_sea` |
| VFS | `NODE_SEA` | `__SMOL_VFS_BLOB` | `.note.smol_vfs` |

### Key Constants

```c
#define SMOL_MARKER "__SMOL_PRESSED_DATA_MAGIC_MARKER"
#define MAX_DECOMPRESSED_SIZE (500 * 1024 * 1024)  // 500MB limit
```

## File Categories

### C Libraries (compiled into binaries)

- `binary_format.c/.h` - Format detection via magic bytes
- `compression_common.c/.h` - LZFSE wrappers
- `smol_segment.c/.h` - SMOL segment reading
- `smol_node_version.c` - Node.js version embedding

### C++ LIEF Utilities (header-only templates)

- `binject_file_utils.hpp` - File I/O for LIEF
- `binject_lief_traits.hpp` - Platform-specific type traits
- `binject_sea_fuse.hpp` - NODE_SEA_FUSE manipulation
- `binject_section_ops.hpp` - Generic section operations
- `macho_lief_utils.hpp` - Mach-O specific helpers
- `elf_note_utils.hpp` - ELF PT_NOTE utilities

## Performance Characteristics

| Operation | Speed | Notes |
|-----------|-------|-------|
| LZFSE compression | ~200 MB/s | Single-threaded |
| LZFSE decompression | ~400 MB/s | Single-threaded |
| Compression ratio | 75-79% | Typical for Node.js binaries |
| Stub size | 8-10 KB | Platform-dependent |
| Cache hit time | <100ms | DLX cache lookup + exec |
| Cache miss time | 1-3 sec | Decompress + write + exec |

**Compression Example:**
```
Input:  93 MB (stripped Node.js binary)
Output: 22 MB (SMOL compressed)
Ratio:  76% reduction
Time:   ~500ms
```

## Platform Support Matrix

| Feature | macOS | Linux (glibc) | Linux (musl) | Windows |
|---------|:-----:|:-------------:|:------------:|:-------:|
| Build host | arm64, x64 | x64 | x64 | x64 |
| Target platform | arm64, x64 | arm64, x64 | arm64, x64 | arm64, x64 |
| Cross-compile | any | any | any | any |
| Native LZFSE | Compression.framework | lzfse lib | lzfse lib | lzfse lib |
| SEA injection | LIEF | LIEF | LIEF | LIEF |
| VFS support | full | full | full | full |
| Code signing | codesign | n/a | n/a | signtool |
| Update checking | curl | curl | curl | WinHTTP |

## Developer Checklist

When making changes to socket-btm packages:

```
1. EDIT SOURCE PACKAGES
   Edit in: packages/{binject,bin-infra,build-infra}/
   NOT in:  packages/node-smol-builder/additions/

2. SYNC TO ADDITIONS (if applicable)
   Source packages are synced to node-smol during build

3. CLEAN BEFORE REBUILD
   pnpm --filter node-smol-builder clean
   pnpm --filter node-smol-builder build

4. BUMP CACHE VERSIONS (for CI)
   Edit: .github/cache-versions.json
   See: CLAUDE.md "Cache Version Cascade Dependencies"

5. RUN TESTS
   pnpm --filter <package> test
```

## Related Packages

- [binject](../../binject/docs/) - Uses bin-infra for injection
- [binpress](../../binpress/docs/) - Uses bin-infra for compression
- [binflate](../../binflate/docs/) - Uses bin-infra for extraction
- [stubs-builder](../../stubs-builder/docs/) - Uses bin-infra for stub building
