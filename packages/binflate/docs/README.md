# binflate Documentation

Documentation for the binary extraction tool.

## Overview

binflate extracts and decompresses LZFSE-compressed binaries created by binpress. It's the inverse operation of binpress.

## Documentation Index

### Architecture

binflate extracts and decompresses SMOL binaries, reversing the binpress operation.

```
┌────────────────────────────────────────────────────────────────────────┐
│                      EXTRACTION PIPELINE                                │
└────────────────────────────────────────────────────────────────────────┘

Input: SMOL Compressed Binary (~22 MB)
         │
         ▼
┌───────────────────┐
│  Find Magic       │  Scan for __SMOL_PRESSED_DATA_MAGIC_MARKER
│  Marker           │  (32-byte signature)
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Read Metadata    │  Parse 68-byte header:
│  Header           │  - Magic marker (32 bytes)
│                   │  - Compressed size (uint64 LE)
│                   │  - Uncompressed size (uint64 LE)
│                   │  - Cache key (16 bytes)
│                   │  - Platform/arch/libc (3 bytes)
│                   │  - Config flag (1 byte)
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Validate Sizes   │  Safety checks:
│                   │  - Uncompressed ≤ 500 MB
│                   │  - Compressed ≤ file size
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  LZFSE Decompress │  Platform-specific:
│                   │  - macOS: Compression.framework
│                   │  - Linux/Windows: lzfse library
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│  Write Output     │  Write decompressed binary to disk
│  Binary           │  Set executable permissions
└────────┬──────────┘
         │
         ▼
Output: Original Binary (~60-93 MB)
```

**Format Detection:**

```
binflate automatically detects two input formats:

1. SMOL Stub Binary (with stub code prefix)
   ┌────────────────┬──────────────────────┬─────────────────┐
   │ Stub Code      │ __SMOL_PRESSED...    │ Compressed Data │
   │ (8-10 KB)      │ + Metadata           │ (~22 MB)        │
   └────────────────┴──────────────────────┴─────────────────┘

2. Data-Only File (from binpress -d)
   ┌──────────────────────┬─────────────────┐
   │ __SMOL_PRESSED...    │ Compressed Data │
   │ + Metadata           │ (~22 MB)        │
   └──────────────────────┴─────────────────┘
```

**Error Handling:**

| Error | Cause | Resolution |
|-------|-------|------------|
| Magic marker not found | Not a SMOL binary | Use binpress to compress first |
| Uncompressed size exceeds limit | Payload > 500 MB | Split or use different compression |
| Decompression failed | Corrupted data | Re-compress with binpress |
| Write failed | Disk full / permissions | Check disk space and permissions |

**Relationship to Self-Extracting Stubs:**

```
binflate ≈ Manual extraction equivalent of stub auto-extraction

Stub Execution:            Manual Extraction:
./node-smol                binflate node-smol -o node
     │                              │
     ▼                              ▼
[Auto-decompress]          [Decompress to file]
     │                              │
     ▼                              ▼
[Cache + Execute]          [Output binary]
```

### Quick Reference

| Input | Output | Operation |
|-------|--------|-----------|
| ~22 MB SMOL stub | ~60 MB Node.js | LZFSE decompression |

### Extraction Flow

```
Compressed Binary (22 MB)
    ↓
[Find Magic Marker]
    ↓
[Read Metadata]
    ↓
[LZFSE Decompress]
    ↓
Output Binary (60 MB)
```

### Key Commands

```bash
# Extract compressed binary
binflate node-compressed -o node

# Extract data-only file
binflate node.data -o node
```

### Metadata Structure

```
Magic: __SMOL_PRESSED_DATA_MAGIC_MARKER (32 bytes)
├─ Compressed size (8 bytes, uint64 LE)
├─ Uncompressed size (8 bytes, uint64 LE)
├─ Cache key (16 bytes, hex string)
├─ Platform metadata (3 bytes)
├─ Config flag (1 byte)
└─ [Optional] SMOL config (1192 bytes)
```

### Platform Codes

| Byte | Platform |
|------|----------|
| 0 | Linux |
| 1 | macOS (Darwin) |
| 2 | Windows |

### Arch Codes

| Byte | Architecture |
|------|--------------|
| 0 | x64 |
| 1 | arm64 |
| 2 | ia32 |
| 3 | arm |

### Libc Codes

| Byte | Libc |
|------|------|
| 0 | glibc |
| 1 | musl |
| 255 | n/a |

### Decompression Limits

- Maximum uncompressed size: 500 MB
- Compression algorithm: LZFSE (Apple)

## Related Packages

- [binpress](../../binpress/docs/) - Compression (inverse of binflate)
- [bin-infra](../../bin-infra/docs/) - Shared decompression utilities
