# stubs-builder Documentation

Documentation for the self-extracting stub binaries.

## Overview

stubs-builder contains the self-extracting stub binaries that wrap compressed Node.js binaries. When executed, stubs decompress and cache the payload, then execute it.

## Documentation Index

### Architecture

Self-extracting stubs are minimal native binaries that decompress and execute a cached payload.

```
┌──────────────────────────────────────────────────────────────────────┐
│                        STUB BINARY STRUCTURE                          │
├──────────────────────────────────────────────────────────────────────┤
│  [Stub Code]        8-10 KB      Platform-native decompressor        │
│  [Magic Marker]     32 bytes     __SMOL_PRESSED_DATA_MAGIC_MARKER    │
│  [Metadata]         68 bytes     Sizes, cache key, platform info     │
│  [SMOL Config]      1192 bytes   (optional) Update checking config   │
│  [Compressed Data]  ~22 MB       LZFSE-compressed Node.js binary     │
└──────────────────────────────────────────────────────────────────────┘
```

**Execution Architecture:**

```
┌───────────────────┐
│   User Executes   │
│   ./node-smol     │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐     ┌───────────────────┐
│  Find Magic       │     │  Cache Directory  │
│  Marker in Self   │────▶│  ~/.socket/_dlx/  │
└───────────────────┘     │  <cache_key>/     │
         │                │    ├── node       │
         │                │    └── .dlx-metadata.json │
         ▼                └─────────┬─────────┘
┌───────────────────┐               │
│  Cache Key Match? │───── YES ────▶│
└────────┬──────────┘               │
         │ NO                       │
         ▼                          │
┌───────────────────┐               │
│  LZFSE Decompress │               │
│  → Write to Cache │───────────────┘
└────────┬──────────┘               │
         │                          │
         ▼                          ▼
┌───────────────────────────────────────────┐
│  execv() cached binary with original args │
└───────────────────────────────────────────┘
```

**Platform-Specific Implementations:**

| Platform | Entry Point | Decompressor | Notes |
|----------|-------------|--------------|-------|
| macOS | `macho_stub.c` | Apple Compression.framework | Native LZFSE support |
| Linux | `elf_stub.c` | lzfse library (built from source) | Static linked |
| Windows | `pe_stub.c` | lzfse library (built from source) | Static linked |

**Update Checking Flow:**

```
Stub Start → Check SMOL Config → Has Update URL?
                                       │
                    ┌──────────────────┴──────────────────┐
                    │ YES                                  │ NO
                    ▼                                      ▼
             Spawn Background                        Continue
             Update Checker                          Execution
                    │
                    ▼
             GitHub API Query
             (glob pattern match)
                    │
                    ▼
             Display Notification
             (non-blocking)
```

### Quick Reference

| Platform | Format | Stub Size |
|----------|--------|-----------|
| macOS arm64 | Mach-O | ~8-10 KB |
| macOS x64 | Mach-O | ~8-10 KB |
| Linux arm64 | ELF | ~8-10 KB |
| Linux x64 | ELF | ~8-10 KB |
| Windows arm64 | PE | ~8-10 KB |
| Windows x64 | PE | ~8-10 KB |

### Stub Execution Flow

```
[Stub Loaded]
    ↓
[Find __SMOL_PRESSED_DATA_MAGIC_MARKER]
    ↓
[Read Metadata]
    ↓
[Check Cache: ~/.socket/_dlx/<cache_key>/]
    ├─ Cache HIT → Execute cached binary
    └─ Cache MISS → Decompress → Cache → Execute
```

### Cache Directory

```
~/.socket/_dlx/<cache_key>/
├── node           # Decompressed binary
└── .dlx-metadata.json  # Metadata
```

### Key Components

| File | Purpose |
|------|---------|
| `stub_*.c` | Platform-specific stub entry point |
| `update_checker.h` | GitHub release update checking |
| `dlx_cache_common.h` | DLX cache management |
| `decompressor_*.h` | LZFSE decompression |

### Build Targets

```bash
# Build all stubs
pnpm run build

# Build specific platform
make -f Makefile.macos
make -f Makefile.linux
make -f Makefile.windows
```

### Update Checking

Stubs can optionally check for updates via GitHub releases:
- Configurable via SMOL config (1192 bytes)
- Glob pattern matching for release tags
- Non-blocking notification

## Related Packages

- [binpress](../../binpress/docs/) - Embeds stubs with compressed data
- [bin-infra](../../bin-infra/docs/) - Shared utilities
- [build-infra](../../build-infra/docs/) - Build utilities
