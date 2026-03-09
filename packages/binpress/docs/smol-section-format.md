# SMOL Section Format Specification

Complete byte-level specification for the SMOL compressed binary format.

## Overview

SMOL (SMall Optimized Loader) is the compression format used by binpress to create self-extracting Node.js binaries. The format embeds metadata, optional configuration, and LZFSE-compressed data.

## Binary Layout

```
┌─────────────────────────────────────────────────────────────────┐
│                    SMOL COMPRESSED BINARY                        │
├─────────────────────────────────────────────────────────────────┤
│  Self-extracting stub (platform-specific)          │  ~8-10 KB  │
├─────────────────────────────────────────────────────────────────┤
│  SMOL Section (segment: SMOL, section: __PRESSED_DATA)          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Magic marker                               │  32 bytes     ││
│  │  Compressed size (uint64 LE)                │   8 bytes     ││
│  │  Uncompressed size (uint64 LE)              │   8 bytes     ││
│  │  Cache key (hex string)                     │  16 bytes     ││
│  │  Platform byte                              │   1 byte      ││
│  │  Arch byte                                  │   1 byte      ││
│  │  Libc byte                                  │   1 byte      ││
│  │  Has config flag                            │   1 byte      ││
│  │  [Optional] SMOL config                     │ 1192 bytes    ││
│  │  LZFSE compressed data                      │  variable     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Field Specifications

### Magic Marker (32 bytes)

```
Offset: 0
Size: 32 bytes
Format: ASCII string (not null-terminated in section)
Value: __SMOL_PRESSED_DATA_MAGIC_MARKER
```

Used for format detection via marker scanning.

### Compressed Size (8 bytes)

```
Offset: 32
Size: 8 bytes
Format: uint64, little-endian
```

Size of LZFSE compressed data in bytes.

### Uncompressed Size (8 bytes)

```
Offset: 40
Size: 8 bytes
Format: uint64, little-endian
```

Size of original binary in bytes. Used for pre-allocation during decompression.

**Safety limit:** Maximum 500 MB to prevent DoS attacks.

### Cache Key (16 bytes)

```
Offset: 48
Size: 16 bytes
Format: ASCII hex characters [0-9a-f]
```

First 16 characters of SHA-512 hash of compressed data. Used for cache directory naming:
```
~/.socket/_dlx/<cache_key>/node
```

### Platform Metadata (3 bytes)

```
Offset: 64
Size: 3 bytes
```

**Platform byte (offset 64):**

| Value | Platform |
|-------|----------|
| 0 | Linux |
| 1 | Darwin (macOS) |
| 2 | Windows |

**Architecture byte (offset 65):**

| Value | Architecture |
|-------|--------------|
| 0 | x64 |
| 1 | arm64 |
| 2 | ia32 |
| 3 | arm |

**Libc byte (offset 66):**

| Value | Libc |
|-------|------|
| 0 | glibc |
| 1 | musl |
| 255 | n/a (macOS/Windows) |

### Has Config Flag (1 byte)

```
Offset: 67
Size: 1 byte
```

| Value | Meaning |
|-------|---------|
| 0 | No SMOL config follows |
| 1 | SMOL config follows (1192 bytes) |

### SMOL Config (1192 bytes, optional)

Present only if has_config flag is 1.

```
Offset: 68 (if present)
Size: 1192 bytes
Format: SMFG binary structure
```

See [SMFG Format](#smfg-smol-config-format) below.

### Compressed Data (variable)

```
Offset: 68 (no config) or 1260 (with config)
Size: compressed_size bytes
Format: LZFSE compressed data
```

## SMFG (SMOL Config) Format

Binary configuration for update checking and notifications. Version 2 format.

### Layout

```
Offset  Size    Field                    Description
──────  ────    ─────                    ───────────
0       4       Magic                    "SMFG" (0x47464D53 LE)
4       2       Version                  2 (uint16 LE)
6       2       Reserved                 Padding
8       512     Update URL               Null-terminated UTF-8
520     256     Glob Pattern             Null-terminated UTF-8
776     256     Notification Title       Null-terminated UTF-8
1032    128     Reserved                 Future use
1160    4       Flags                    Bit flags (uint32 LE)
1164    4       Check Interval           Seconds (uint32 LE)
1168    4       Timeout                  Seconds (uint32 LE)
1172    20      Reserved                 Future use
──────  ────
Total   1192 bytes
```

### Magic Value

```c
#define SMFG_MAGIC 0x47464D53  // "SMFG" in little-endian
```

### Flags Field

| Bit | Name | Description |
|-----|------|-------------|
| 0 | `UPDATE_ENABLED` | Update checking enabled |
| 1 | `NOTIFY_ONLY` | Notify but don't block |
| 2 | `AUTO_UPDATE` | Automatic update (future) |
| 3-31 | Reserved | Future use |

### Example

```c
struct smfg_config {
    uint32_t magic;           // 0x47464D53 ("SMFG")
    uint16_t version;         // 2
    uint16_t reserved;
    char update_url[512];     // "https://api.github.com/repos/.../releases"
    char glob_pattern[256];   // "v*"
    char notification[256];   // "New version available"
    char reserved2[128];
    uint32_t flags;           // 0x01 (update enabled)
    uint32_t interval;        // 86400 (daily)
    uint32_t timeout;         // 5 (seconds)
    char reserved3[20];
};
```

## Platform Section Names

### Mach-O

```
Segment: SMOL
Section: __PRESSED_DATA
```

Created before `__LINKEDIT` to preserve code signature.

### ELF

```
Section: .note.smol_pressed_data
Type: PT_NOTE
```

Uses PT_NOTE segment for metadata preservation.

### PE

```
Section: .pressed_data
```

## Compression Details

### Algorithm

LZFSE (Lempel-Ziv + Finite State Entropy)

### Characteristics

| Property | Value |
|----------|-------|
| Compression ratio | ~75-79% (22 MB stub for 60 MB binary) |
| Decompression speed | ~400 MB/s |
| Memory usage | ~1 MB working set |

### Platform Implementation

| Platform | Library |
|----------|---------|
| macOS | Apple Compression.framework |
| Linux | Bundled lzfse library |
| Windows | Bundled lzfse library |

## Validation Rules

### Metadata Validation

1. Magic marker must match exactly
2. Sizes must be non-zero
3. Uncompressed size ≤ 500 MB
4. Compressed size ≤ file size
5. Cache key must be 16 hex characters [0-9a-fA-F]

### SMFG Validation

1. Magic must be `0x47464D53`
2. Version must be 1 or 2
3. Strings must be null-terminated
4. Check interval must be > 0

## Reading Example

```c
typedef struct {
    uint64_t compressed_size;
    uint64_t uncompressed_size;
    char cache_key[17];
    uint8_t platform;
    uint8_t arch;
    uint8_t libc;
    uint8_t has_config;
} smol_header_t;

int read_smol_header(int fd, smol_header_t *header) {
    char magic[32];
    read(fd, magic, 32);
    if (memcmp(magic, "__SMOL_PRESSED_DATA_MAGIC_MARKER", 32) != 0) {
        return -1;  // Not a SMOL binary
    }

    // Read sizes (little-endian)
    read(fd, &header->compressed_size, 8);
    read(fd, &header->uncompressed_size, 8);

    // Read cache key
    read(fd, header->cache_key, 16);
    header->cache_key[16] = '\0';

    // Read platform metadata
    read(fd, &header->platform, 1);
    read(fd, &header->arch, 1);
    read(fd, &header->libc, 1);
    read(fd, &header->has_config, 1);

    return 0;
}
```

## Related Documentation

- [Stub System](stub-system.md) - Self-extracting stub architecture
- [Binary Formats](../../bin-infra/docs/binary-formats.md) - Full binary format specs
