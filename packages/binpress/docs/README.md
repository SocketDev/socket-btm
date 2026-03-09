# binpress Documentation

Documentation for the binary compression tool.

## Overview

binpress compresses binaries into self-extracting SMOL stubs using LZFSE compression. It supports cross-platform compression (compress on any platform for any target platform).

## Documentation Index

### Architecture

binpress compresses binaries into self-extracting SMOL stubs using a multi-stage pipeline.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      COMPRESSION PIPELINE                               │
└────────────────────────────────────────────────────────────────────────┘

Input: Node.js Binary (~93 MB)
         │
         ▼
┌───────────────────┐
│  Format Detection │  binary_format.c
│  (Mach-O/ELF/PE)  │  Magic byte analysis
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Select Target    │  Cross-platform support:
│  Platform/Stub    │  Compress on macOS → target linux-x64-musl
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  LZFSE Compress   │  compression_common.c
│  (~76% reduction) │  Apple Compression or lzfse library
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Build Metadata   │  68 bytes header:
│                   │  - Compressed/uncompressed sizes
│                   │  - Cache key (SHA-512 truncated)
│                   │  - Platform/arch/libc codes
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Optional: SMOL   │  1192 bytes config:
│  Update Config    │  - GitHub release URL
│                   │  - Glob pattern for versions
│                   │  - Update flags
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Select Stub      │  Embedded stubs from stubs-builder:
│  Binary           │  - darwin-arm64, darwin-x64
│                   │  - linux-arm64, linux-x64 (glibc/musl)
│                   │  - win-arm64, win-x64
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  LIEF Injection   │  Platform-specific segment/section:
│                   │  - Mach-O: SMOL/__PRESSED_DATA
│                   │  - ELF: .note.smol_pressed_data
│                   │  - PE: .pressed_data
└────────┬──────────┘
         │
         ▼
Output: Self-Extracting Binary (~22 MB)
```

**Cross-Platform Compression Matrix:**

```
                     Target Platform
                 ┌─────────┬─────────┬─────────┐
                 │ macOS   │ Linux   │ Windows │
    ┌────────────┼─────────┼─────────┼─────────┤
    │ macOS      │   ✓     │   ✓     │   ✓     │
    │ (arm64/x64)│         │         │         │
H   ├────────────┼─────────┼─────────┼─────────┤
o   │ Linux      │   ✓     │   ✓     │   ✓     │
s   │ (x64)      │         │         │         │
t   ├────────────┼─────────┼─────────┼─────────┤
    │ Windows    │   ✓     │   ✓     │   ✓     │
    │ (x64)      │         │         │         │
    └────────────┴─────────┴─────────┴─────────┘
```

**LIEF Integration:**

binpress uses LIEF (v0.17.0) for binary manipulation:
- **Mach-O**: Segment creation with section injection
- **ELF**: PT_NOTE segment for data storage
- **PE**: Section creation with proper alignment

The LIEF library is built from source via lief-builder to ensure version consistency and apply patches (e.g., removing the 1MB note size limit).

### Quick Reference

| Input | Output | Compression |
|-------|--------|-------------|
| ~93 MB Node.js | ~22 MB SMOL stub | ~76% reduction |

### Compression Pipeline

```
Input Binary (93 MB)
    ↓
[Format Detection]
    ↓
[Select Target Stub]
    ↓
[LZFSE Compression]
    ↓
[Build SMOL Section]
    ↓
[Embed in Stub]
    ↓
Output Binary (22 MB)
```

### Key Commands

```bash
# Compress to self-extracting stub
binpress node -o node-compressed

# Data-only mode (no stub)
binpress node -d node.data

# Cross-platform target
binpress node -o node-linux --target linux-x64-glibc

# Both outputs
binpress node -o node-compressed -d node.data
```

### SMOL Section Layout

```
Offset  Size    Field
------  ----    -----
0       32      Magic marker
32      8       Compressed size (uint64 LE)
40      8       Uncompressed size (uint64 LE)
48      16      Cache key (hex)
64      1       Platform (0=linux, 1=darwin, 2=win32)
65      1       Arch (0=x64, 1=arm64)
66      1       Libc (0=glibc, 1=musl, 255=n/a)
67      1       Has config flag
68      1192    Update config (optional)
1260+   var     LZFSE compressed data
```

### Supported Targets

| Target | Platform | Arch | Libc |
|--------|----------|------|------|
| darwin-arm64 | macOS | arm64 | n/a |
| darwin-x64 | macOS | x64 | n/a |
| linux-arm64 | Linux | arm64 | glibc |
| linux-x64 | Linux | x64 | glibc |
| linux-arm64-musl | Linux | arm64 | musl |
| linux-x64-musl | Linux | x64 | musl |
| win-arm64 | Windows | arm64 | n/a |
| win-x64 | Windows | x64 | n/a |

## Troubleshooting

### "Stub not found for target"

```bash
# Check available targets
ls stubs/
```

**Cause:** Stubs not built or target not supported.

**Solution:**
```bash
pnpm --filter stubs-builder run build
```

### "Compression failed"

**Cause:** Input binary too large or corrupted.

**Solution:**
- Verify input binary is valid: `file input-binary`
- Check uncompressed size < 500 MB

### "LZFSE library not found" (Linux/Windows)

**Cause:** lzfse library not built.

**Solution:**
```bash
pnpm --filter lief-builder run build
```

### Output binary doesn't run

**Cause:** Target platform mismatch.

**Solution:**
```bash
# Verify target matches execution platform
binpress node -o output --target darwin-arm64  # macOS ARM
binpress node -o output --target linux-x64-glibc  # Linux x64
```

## Related Packages

- [stubs-builder](../../stubs-builder/docs/) - Provides stub binaries
- [bin-infra](../../bin-infra/docs/) - Shared compression utilities
- [binflate](../../binflate/docs/) - Extraction (inverse of binpress)
