# Binary Format Specifications

This document describes the binary formats used by socket-btm tools.

## SMOL Compressed Binary Format

The SMOL format wraps a compressed binary with metadata for decompression.

### Layout Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    SMOL COMPRESSED BINARY                    │
├─────────────────────────────────────────────────────────────┤
│  Self-extracting stub (platform-specific)     │  ~8-10 KB   │
├─────────────────────────────────────────────────────────────┤
│  SMOL Section (SMOL/__PRESSED_DATA)                         │
│  ┌─────────────────────────────────────────────────────────┐│
│  │  Magic marker                              │  32 bytes  ││
│  │  Compressed size (uint64 LE)               │   8 bytes  ││
│  │  Uncompressed size (uint64 LE)             │   8 bytes  ││
│  │  Cache key (hex string)                    │  16 bytes  ││
│  │  Platform byte                             │   1 byte   ││
│  │  Arch byte                                 │   1 byte   ││
│  │  Libc byte                                 │   1 byte   ││
│  │  Has config flag                           │   1 byte   ││
│  │  [Optional] SMOL config                    │ 1192 bytes ││
│  │  LZFSE compressed data                     │  variable  ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Field Details

#### Magic Marker (32 bytes)
```
__SMOL_PRESSED_DATA_MAGIC_MARKER
```
ASCII string identifying SMOL format. Used for marker search.

#### Sizes (16 bytes)
```c
struct {
    uint64_t compressed_size;    // Little-endian
    uint64_t uncompressed_size;  // Little-endian
} sizes;
```

#### Cache Key (16 bytes)
First 16 hex characters of SHA-512 hash of compressed data.
```
Example: "97f5a39a4b819a25"
```

#### Platform Metadata (3 bytes)

**Platform byte:**
| Value | Platform |
|-------|----------|
| 0 | Linux |
| 1 | Darwin (macOS) |
| 2 | Windows |

**Arch byte:**
| Value | Architecture |
|-------|--------------|
| 0 | x64 |
| 1 | arm64 |
| 2 | ia32 |
| 3 | arm |

**Libc byte:**
| Value | Libc |
|-------|------|
| 0 | glibc |
| 1 | musl |
| 255 | n/a (macOS/Windows) |

#### Has Config Flag (1 byte)
| Value | Meaning |
|-------|---------|
| 0 | No SMOL config follows |
| 1 | SMOL config follows (1192 bytes) |

---

## SMFG (SMOL Config) Format

Binary configuration embedded in SMOL binaries. 1192 bytes total.

See [binject config-formats.md](../../binject/docs/config-formats.md) for the complete SMFG specification.

### Quick Reference

```
Offset  Size    Field                    Description
──────  ────    ─────                    ───────────
0       4       Magic                    "SMFG" (0x534D4647 LE)
4       2       Version                  2 (uint16 LE)
6       1       Prompt                   0=no, 1=yes
7       1       Prompt Default           'y' or 'n'
8       8       Interval                 Check interval (ms, int64 LE)
16      8       Notify Interval          Notification interval (ms, int64 LE)
24      128     Binname                  1-byte length prefix + 127 chars
152     256     Command                  2-byte length prefix + 254 chars
408     512     URL                      2-byte length prefix + 510 chars
920     128     Tag                      1-byte length prefix + 127 chars
1048    64      Skip Env                 1-byte length prefix + 63 chars
1112    64      Fake Argv Env            1-byte length prefix + 63 chars
1176    16      Node Version             1-byte length prefix + 15 chars
──────  ────
Total   1192 bytes
```

### Key Constants

```c
#define SMOL_CONFIG_MAGIC   0x534D4647  // "SMFG"
#define SMOL_CONFIG_VERSION 2
#define SMOL_CONFIG_SIZE    1192
```

---

## SVFG (VFS Config) Format

VFS configuration embedded alongside VFS blob. 366 bytes total.

### Layout

```
Offset  Size    Field                    Description
──────  ────    ─────                    ───────────
0       4       Magic                    "SVFG" (0x47465653 LE)
4       2       Version                  1 (uint16 LE)
6       1       Mode                     VFS mode
7       1       Compression              Compression type
8       256     Prefix                   Mount prefix path
264     4       Flags                    Bit flags (uint32 LE)
268     98      Reserved                 Future use
──────  ────
Total   366 bytes
```

### Mode Field

| Value | Name | Description |
|-------|------|-------------|
| 0 | `IN_MEMORY` | Extract to memory |
| 1 | `ON_DISK` | Extract to temp directory |
| 2 | `COMPAT` | API only, no files |

### Compression Field

| Value | Name | Description |
|-------|------|-------------|
| 0 | `NONE` | Uncompressed TAR |
| 1 | `GZIP` | TAR.GZ compressed |

### Flags Field

| Bit | Name | Description |
|-----|------|-------------|
| 0 | `PRESERVE_SYMLINKS` | Preserve symbolic links |
| 1 | `STRICT_MODE` | Fail on invalid paths |
| 2-31 | Reserved | Future use |

---

## Segment/Section Names

### Mach-O

| Segment | Section | Purpose |
|---------|---------|---------|
| `SMOL` | `__PRESSED_DATA` | Compressed binary |
| `NODE_SEA` | `__NODE_SEA_BLOB` | SEA application |
| `NODE_SEA` | `__SMOL_VFS_BLOB` | VFS archive |
| `NODE_SEA` | `__SMOL_VFS_CONFIG` | VFS configuration |

Note: Mach-O segments don't have `__` prefix. Sections do.

### ELF

| Section | Purpose |
|---------|---------|
| `.note.smol_pressed_data` | Compressed binary |
| `.note.node_sea_blob` | SEA application |
| `.note.smol_vfs_blob` | VFS archive |
| `.note.smol_vfs_config` | VFS configuration |

ELF uses PT_NOTE segments containing these sections.

### PE (Windows)

| Section | Purpose |
|---------|---------|
| `.pressed_data` | Compressed binary |
| `.node_sea` | SEA application |
| `.smol_vfs` | VFS archive |
| `.vfs_config` | VFS configuration |

---

## Compression Algorithm

LZFSE (Lempel-Ziv + Finite State Entropy) is used for all compression.

### Characteristics

| Property | Value |
|----------|-------|
| Algorithm | LZFSE |
| Compression ratio | 75-79% |
| Speed | ~200 MB/s compress, ~400 MB/s decompress |
| Memory | ~1MB working set |

### Platform Implementation

| Platform | Library |
|----------|---------|
| macOS | Apple Compression.framework (native) |
| Linux | Bundled lzfse library |
| Windows | Bundled lzfse library |

### Size Limits

| Limit | Value | Enforced By | Reason |
|-------|-------|-------------|--------|
| Max uncompressed | 500 MB | Application tools | Practical safety limit (binflate, binject) |
| Compression library max | 512 MB | compression_common.h | Technical maximum |
| Min compressed | 68 bytes | All | Metadata overhead |

Note: Application tools (binflate, binject) enforce 500 MB before the compression library's 512 MB limit is reached.

---

## Cache Key Calculation

Cache keys uniquely identify compressed binaries.

### Algorithm

```python
# Pseudocode
compressed_data = read_compressed_section()
hash = sha512(compressed_data)
cache_key = hash.hexdigest()[:16]  # First 16 hex chars
```

### Properties

- 64-bit collision resistance (16 hex chars = 64 bits)
- Deterministic: same content = same key
- Content-based: filename independent

### Cache Directory Structure

```
~/.socket/_dlx/
├── 97f5a39a4b819a25/     # Cache key directory
│   ├── node              # Decompressed binary
│   └── .dlx-metadata.json
├── a1b2c3d4e5f67890/
│   └── ...
```
