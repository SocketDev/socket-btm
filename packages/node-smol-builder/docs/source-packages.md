# Source Package Architecture

## Overview

The socket-btm monorepo uses a **source of truth architecture** where three canonical source packages contain code that gets embedded into Node.js. This document explains how sources flow from packages to the final binary.

## Package Dependency Chain

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PACKAGE DEPENDENCY CHAIN                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │  build-infra    │
                              │  (common utils) │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
           ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
           │ stubs-builder  │  │   bin-infra    │  │    binject     │
           │ (stub binaries)│  │ (compression)  │  │  (injection)   │
           └───────┬────────┘  └───────┬────────┘  └───────┬────────┘
                   │                   │                   │
                   ▼                   ▼                   ▼
           ┌────────────────┐  ┌────────────────┐          │
           │    binpress    │  │   binflate     │          │
           │ (compression)  │  │ (extraction)   │          │
           └───────┬────────┘  └────────────────┘          │
                   │                                       │
                   └───────────────────┬───────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │   node-smol     │
                              │ (final binary)  │
                              └─────────────────┘
```

## Source Packages

### build-infra

**Location:** `packages/build-infra/src/socketsecurity/build-infra/`

**Purpose:** Common utilities shared across all packages

**Complete File Listing (16 files):**
| File | Purpose |
|------|---------|
| `debug_common.h` | Debug logging macros with namespace filtering (BINJECT_DEBUG, SMOL_DEBUG) |
| `dlx_cache_common.h` | DLX binary cache implementation (~/.socket/_dlx/) |
| `file_io_common.c` | Cross-platform file I/O (read_file_to_buffer, write_buffer_to_file) |
| `file_io_common.h` | File I/O header declarations |
| `file_utils.c` | File utilities (mkdir_p, set_executable_permissions, resolve paths) |
| `file_utils.h` | File utilities header declarations |
| `gzip_compress.c` | Platform-abstracted gzip compression (zlib/Compression.framework) |
| `gzip_compress.h` | Gzip compression header declarations |
| `path_utils.c` | Cross-platform path manipulation (normalize, join, basename) |
| `path_utils.h` | Path utilities header declarations |
| `posix_compat.h` | POSIX compatibility layer for Windows (S_ISREG, realpath, etc.) |
| `process_exec.c` | Safe process execution without shell (posix_spawn/CreateProcess) |
| `process_exec.h` | Process execution header declarations |
| `tar_create.c` | TAR archive creation (POSIX ustar format, directories, symlinks) |
| `tar_create.h` | TAR creation header declarations |
| `tmpdir_common.h` | Node.js-compatible temp directory selection (TMPDIR/TMP/TEMP) |

**Used By:** stubs-builder, binflate, binject, binpress, node-smol

---

### bin-infra

**Location:** `packages/bin-infra/src/socketsecurity/bin-infra/`

**Purpose:** Binary format handling and compression utilities

**Complete File Listing (29 files):**
| File | Purpose |
|------|---------|
| `binary_format.c` | Binary format detection (ELF/Mach-O/PE magic bytes) |
| `binary_format.h` | Binary format enum and detection functions |
| `binject_file_utils.hpp` | Shared file I/O utilities for LIEF operations |
| `binject_lief_traits.hpp` | Template traits for platform-specific LIEF binary/segment types |
| `binject_sea_fuse.hpp` | NODE_SEA_FUSE pattern search and flip utilities |
| `binject_section_ops.hpp` | Generic section add/remove operations for all binary formats |
| `buffer_constants.h` | Buffer sizes and PE format constants |
| `cabinet.def` | Windows Cabinet API exports for LZMS decompression |
| `compression_common.c` | LZFSE compression utilities (compress/decompress) |
| `compression_common.h` | Compression function declarations |
| `compression_constants.h` | Magic marker: `__SMOL_PRESSED_DATA_MAGIC_MARKER` |
| `decompressor_limits.h` | Maximum uncompressed size limit (500MB) |
| `elf_note_utils.hpp` | ELF PT_NOTE segment finder utilities |
| `lzfse.h` | Forwarding header for LZFSE library includes |
| `macho_lief_utils.hpp` | Mach-O LIEF helper functions (binary parsing) |
| `marker_finder.h` | Magic marker pattern finder utilities |
| `ptnote_finder.h` | ELF PT_NOTE marker finder (fallback detection) |
| `segment_names.h` | Segment/section name constants (SMOL, NODE_SEA, etc.) |
| `smol_detect.cpp` | SMOL stub detection via LIEF |
| `smol_detect.h` | SMOL detection function declarations |
| `smol_node_version.c` | Node.js version string embedding utilities |
| `smol_segment.c` | SMOL segment utilities (metadata parsing) |
| `smol_segment.h` | SMOL segment structures and functions |
| `smol_segment_reader.c` | SMOL metadata reading (compressed/uncompressed sizes) |
| `smol_segment_reader.h` | SMOL reader function declarations |
| `string_convert.hpp` | ASCII to UTF-16 string conversion (Windows PE) |
| `stub_smol_repack_lief.cpp` | SMOL segment repacking via LIEF (replace __PRESSED_DATA) |
| `stub_smol_repack_lief.h` | SMOL repack function declarations |
| `test.h` | Minunit-style test framework macros |

**Used By:** stubs-builder, binflate, binject, binpress, node-smol

---

### binject

**Location:** `packages/binject/src/socketsecurity/binject/`

**Purpose:** SEA/VFS injection into binaries

**Complete File Listing (22 files):**
| File | Purpose |
|------|---------|
| `binject.c` | Main injection API (extract, inject, repack orchestration) |
| `binject.h` | Public API header declarations |
| `main.c` | CLI entry point (argument parsing, command dispatch) |
| `json_parser.c` | sea-config.json parsing (Node.js SEA config format) |
| `json_parser.h` | JSON parser header declarations |
| `elf_inject_lief.cpp` | ELF injection via LIEF (add NODE_SEA segment) |
| `elf_inject.c` | ELF injection C wrapper |
| `pe_inject_lief.cpp` | PE injection via LIEF (add .sea/.vfs resources) |
| `pe_inject.c` | PE injection C wrapper |
| `macho_inject_lief.cpp` | Mach-O injection via LIEF (add NODE_SEA segment) |
| `macho_inject_lief_wrapper.c` | C API wrapper for Mach-O LIEF operations |
| `elf_pe_cross_platform.c` | Cross-platform ELF/PE injection wrapper |
| `smol_config.c` | SMFG binary format serialization (1192 bytes) |
| `smol_config.h` | SMOL config structures and format constants |
| `vfs_config.c` | SVFG binary format serialization (366 bytes) |
| `vfs_config.h` | VFS config structures and format constants |
| `vfs_utils.c` | VFS source detection and TAR archive creation |
| `vfs_utils.h` | VFS utility function declarations |
| `stub_repack.c` | Compressed stub repacking workflow (sign, compress, repack) |
| `stub_repack.h` | Stub repack function declarations |
| `remove_signature_lib.c` | Mach-O code signature removal (LC_CODE_SIGNATURE) |
| `smol_extract_lief.cpp` | SMOL stub extraction via LIEF (decompress __PRESSED_DATA) |

**Used By:** binject CLI, node-smol

## Source Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SOURCE FLOW TO NODE-SMOL                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CANONICAL SOURCES                    NODE-SMOL ADDITIONS                   │
│  (packages/*)                         (additions/source-patched/)           │
│                                                                             │
│  ┌────────────────────────┐                                                 │
│  │ build-infra/src/       │                                                 │
│  │ socketsecurity/        │          ┌────────────────────────────┐        │
│  │ build-infra/           │─────────►│ src/socketsecurity/        │        │
│  │  ├── file_utils.c      │  SYNC    │ build-infra/               │        │
│  │  ├── tar.c             │          │  ├── file_utils.c          │        │
│  │  ├── dlx_cache.c       │          │  ├── tar.c                 │        │
│  │  └── ...               │          │  └── ...                   │        │
│  └────────────────────────┘          └────────────────────────────┘        │
│                                                                             │
│  ┌────────────────────────┐                                                 │
│  │ bin-infra/src/         │                                                 │
│  │ socketsecurity/        │          ┌────────────────────────────┐        │
│  │ bin-infra/             │─────────►│ src/socketsecurity/        │        │
│  │  ├── segment_names.h   │  SYNC    │ bin-infra/                 │        │
│  │  ├── stub_smol_*.cpp   │          │  ├── segment_names.h       │        │
│  │  └── ...               │          │  └── ...                   │        │
│  └────────────────────────┘          └────────────────────────────┘        │
│                                                                             │
│  ┌────────────────────────┐                                                 │
│  │ binject/src/           │                                                 │
│  │ socketsecurity/        │          ┌────────────────────────────┐        │
│  │ binject/               │─────────►│ src/socketsecurity/        │        │
│  │  ├── binject.c         │  SYNC    │ binject/                   │        │
│  │  ├── macho_inject.cpp  │          │  ├── binject.c             │        │
│  │  └── ...               │          │  └── ...                   │        │
│  └────────────────────────┘          └────────────────────────────┘        │
│                                                                             │
│  UPSTREAM LIBRARIES                                                         │
│                                                                             │
│  ┌────────────────────────┐          ┌────────────────────────────┐        │
│  │ lief-builder/upstream/ │─────────►│ deps/lzfse/                │        │
│  │ lzfse/src/             │  SYNC    │  └── src/                  │        │
│  └────────────────────────┘          └────────────────────────────┘        │
│                                                                             │
│  ┌────────────────────────┐          ┌────────────────────────────┐        │
│  │ binject/upstream/      │─────────►│ deps/libdeflate/           │        │
│  │ libdeflate/            │  SYNC    │  └── (full library)        │        │
│  └────────────────────────┘          └────────────────────────────┘        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Package Selection Rules

When deciding which package to place code in:

| Code Type | Package | Reason |
|-----------|---------|--------|
| Used by binject, binpress, binflate AND node-smol | `build-infra` | Shared across all binary tools |
| Used by binject, binpress, OR binflate (not node-smol) | `bin-infra` | Binary tool specific |
| SEA/VFS injection specific | `binject` | Injection-specific |
| Compression stub specific | `stubs-builder` | Decompression stubs |

**Example:** Segment names (`SMOL`, `NODE_SEA`) are used by node-smol tests for verification, so they belong in `bin-infra` (not `binject`).

## CI Cache Version Dependencies

When modifying source files, bump cache versions in `.github/cache-versions.json`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      CACHE VERSION CASCADE RULES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CHANGE IN                           BUMP CACHE VERSIONS                    │
│                                                                             │
│  build-infra/src/                    stubs-builder, binflate, binject,      │
│  socketsecurity/build-infra/   ───►  binpress, node-smol                   │
│                                                                             │
│  bin-infra/src/                      stubs-builder, binflate, binject,     │
│  socketsecurity/bin-infra/     ───►  binpress, node-smol                   │
│                                                                             │
│  binject/src/                        binject, node-smol                     │
│  socketsecurity/binject/       ───►                                        │
│                                                                             │
│  stubs-builder/src/                  stubs-builder, binpress, node-smol    │
│                               ───►                                         │
│                                                                             │
│  binpress/src/                       binpress, node-smol                    │
│                               ───►                                         │
│                                                                             │
│  binflate/src/                       binflate                               │
│                               ───►                                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Working with Source Packages

### Making Changes

1. **Always edit the canonical source package:**
   ```bash
   # CORRECT
   vim packages/build-infra/src/socketsecurity/build-infra/file_utils.c

   # WRONG - will be overwritten
   vim packages/node-smol-builder/additions/source-patched/src/socketsecurity/build-infra/file_utils.c
   ```

2. **Clean and rebuild node-smol:**
   ```bash
   pnpm --filter node-smol-builder run clean
   pnpm --filter node-smol-builder run build
   ```

3. **The sync happens automatically** during the binary-released phase via `prepare-external-sources.mjs`

### Sync Validation

The sync process uses SHA256 content hashing to ensure integrity:

```javascript
// prepare-external-sources.mjs validates:
// 1. All files from source package exist in additions
// 2. File contents match (via hash comparison)
// 3. No extra files in additions (except gitignored)
```

### Debugging Sync Issues

If sync fails or appears incorrect:

```bash
# Check gitignore
cat packages/node-smol-builder/additions/source-patched/src/socketsecurity/.gitignore

# Force clean rebuild
pnpm --filter node-smol-builder run clean
pnpm --filter node-smol-builder run build --clean
```

## additions/ Directory Structure

```
additions/source-patched/
├── lib/internal/socketsecurity/     # JavaScript runtime (committed)
│   ├── vfs/                         # Virtual filesystem implementation
│   │   ├── index.js                 # VFS entry point
│   │   ├── tar.js                   # TAR format handling
│   │   └── mount.js                 # VFS mounting
│   ├── smol/                        # SMOL bootstrap
│   │   └── bootstrap.js             # Early startup hooks
│   └── polyfills/                   # Compatibility polyfills
│       ├── locale-compare.js        # String locale comparison
│       └── fast-webstreams.js       # WebStreams wrapper
│
├── src/socketsecurity/              # C/C++ sources (SYNCED - gitignored)
│   ├── binject/                     # ← from packages/binject/src/
│   ├── bin-infra/                   # ← from packages/bin-infra/src/
│   ├── build-infra/                 # ← from packages/build-infra/src/
│   ├── sea-smol/                    # SEA/SMOL integration (committed)
│   │   ├── smol_config_parser.c     # SMOL config parsing
│   │   └── sea_smol.h               # Header definitions
│   └── vfs/                         # VFS C++ binding (committed)
│       ├── node_vfs.cc              # VFS native binding
│       └── node_vfs.h               # Header definitions
│
└── deps/                            # External libraries (SYNCED - gitignored)
    ├── lzfse/                       # ← from lief-builder/upstream/lzfse/
    ├── libdeflate/                  # ← from binject/upstream/libdeflate/
    └── fast-webstreams/             # ← from node_modules (vendored)
```

## Build Integration

The node.gyp patch (004-node-gyp-vfs-binject.patch) adds all these sources to the Node.js build:

```python
# From patch 004 - adds ~55 source files (29 compiled + headers):
'sources': [
  # VFS runtime
  'src/socketsecurity/vfs/node_vfs.cc',

  # binject framework (from packages/binject)
  'src/socketsecurity/binject/binject.c',
  'src/socketsecurity/binject/macho_inject_lief.cpp',
  # ...

  # bin-infra utilities (from packages/bin-infra)
  'src/socketsecurity/bin-infra/stub_smol_repack_lief.cpp',
  # ...

  # build-infra utilities (from packages/build-infra)
  'src/socketsecurity/build-infra/file_utils.c',
  'src/socketsecurity/build-infra/tar.c',
  # ...
],

# Library dependencies
'conditions': [
  ['OS=="mac"', {
    'link_settings': {
      'libraries': ['-lcompression'],  # macOS native
    },
  }],
  ['OS!="mac"', {
    # Link lzfse and libdeflate for Linux/Windows
  }],
],
```

## Summary

1. **Source packages are canonical** - edit there, not in additions/
2. **Sync is automatic** - happens during build via prepare-external-sources.mjs
3. **additions/ C/C++ are gitignored** - only JavaScript runtime is committed
4. **Cache versions must cascade** - update .github/cache-versions.json
5. **Clean before rebuild** - use `pnpm run clean` after source changes
