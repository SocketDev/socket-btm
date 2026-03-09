# Consumer Integration Guide

How to integrate bin-infra APIs into consumer packages (binject, binpress, binflate, node-smol-builder).

## Overview

bin-infra provides shared infrastructure for binary tooling:

```
bin-infra (this package)
    ↓ used by
├── binject   (SEA/VFS injection)
├── binpress  (binary compression)
├── binflate  (binary extraction)
└── node-smol-builder (embedded in additions/)
```

## Module Selection Guide

| Task | Module | Key Functions |
|------|--------|---------------|
| Detect binary format | `binary_format.h` | `detect_binary_format()` |
| Detect SMOL sections | `smol_detect.h` | `smol_has_pressed_data_*()` |
| Read SMOL metadata | `smol_segment_reader.h` | `smol_read_metadata*()` |
| Compress/decompress | `compression_common.h` | `compress_buffer()`, `decompress_buffer_sized()` |
| Find magic marker | `marker_finder.h` | `find_marker()` |
| LIEF operations | `stub_smol_repack_lief.h` | LIEF-based segment manipulation |
| Segment names | `segment_names.h` | Mach-O/ELF/PE section constants |

## Integration Patterns

### 1. Format Detection Flow

Use for initial binary analysis:

```c
#include "socketsecurity/bin-infra/binary_format.h"
#include "socketsecurity/bin-infra/smol_detect.h"

int analyze_binary(const char *path) {
    // Step 1: Read file magic (first 4 bytes)
    uint8_t magic[4];
    // ... read magic bytes from file ...

    // Step 2: Detect format
    binary_format_t format = detect_binary_format(magic);
    switch (format) {
        case BINARY_FORMAT_MACHO:
            printf("Mach-O binary\n");
            break;
        case BINARY_FORMAT_ELF:
            printf("ELF binary\n");
            break;
        case BINARY_FORMAT_PE:
            printf("PE binary\n");
            break;
        default:
            return -1;  // Unknown format
    }

    // Step 3: Check for SMOL sections (platform-specific functions)
    int has_pressed = 0;
    #if defined(__APPLE__)
    has_pressed = smol_has_pressed_data_macho_impl(path);
    #elif defined(__linux__)
    has_pressed = smol_has_pressed_data_elf_lief(path);
    #elif defined(_WIN32)
    has_pressed = smol_has_pressed_data_pe_lief(path);
    #endif
    if (has_pressed == 1) {
        printf("Has PRESSED_DATA section (compressed stub)\n");
    }

    return 0;
}
```

### 2. Decompression Flow

Used by binflate and stub decompressors:

```c
#include "socketsecurity/bin-infra/smol_segment_reader.h"
#include "socketsecurity/bin-infra/compression_common.h"

int decompress_smol_binary(const char *input_path, const char *output_path) {
    int fd = open(input_path, O_RDONLY);
    if (fd == -1) return -1;

    // Step 1: Read metadata (platform-optimized)
    smol_metadata_t metadata;
    #if defined(__APPLE__)
    int result = smol_read_metadata_macho(fd, &metadata);
    #elif defined(__linux__)
    int result = smol_read_metadata_elf(fd, &metadata);
    #else
    int result = smol_read_metadata(fd, &metadata);
    #endif

    if (result == -1) {
        close(fd);
        return -1;
    }

    // Step 2: Validate metadata
    if (smol_validate_metadata(&metadata, MAX_DECOMPRESSED_SIZE) == -1) {
        close(fd);
        return -1;
    }

    // Step 3: Read compressed data (fd positioned after metadata)
    uint8_t *compressed = malloc(metadata.compressed_size);
    read(fd, compressed, metadata.compressed_size);
    close(fd);

    // Step 4: Decompress with known size (efficient)
    uint8_t *decompressed = malloc(metadata.uncompressed_size);
    result = decompress_buffer_sized(compressed, metadata.compressed_size,
                                     decompressed, metadata.uncompressed_size);
    free(compressed);

    if (result != COMPRESS_OK) {
        free(decompressed);
        return -1;
    }

    // Step 5: Write output
    // ... write decompressed to output_path ...

    free(decompressed);
    return 0;
}
```

### 3. Compression Flow

Used by binpress:

```c
#include "socketsecurity/bin-infra/compression_common.h"
#include "socketsecurity/bin-infra/compression_constants.h"

int compress_for_smol(const uint8_t *input, size_t input_size,
                      uint8_t **output, size_t *output_size,
                      char *cache_key) {
    // Step 1: Compress with LZFSE
    int result = compress_buffer(input, input_size, output, output_size);
    if (result != COMPRESS_OK) {
        return result;
    }

    // Step 2: Calculate cache key (SHA-512 first 16 hex chars)
    // Use dlx_calculate_cache_key() from build-infra

    // Step 3: Build metadata header
    // - Magic marker (32 bytes)
    // - Compressed size (8 bytes, LE)
    // - Uncompressed size (8 bytes, LE)
    // - Cache key (16 bytes)
    // - Platform metadata (3 bytes)
    // - Config flag (1 byte)

    return COMPRESS_OK;
}
```

### 4. LIEF-Based Injection

Used by binject for SEA/VFS injection:

```c
#include "socketsecurity/bin-infra/segment_names.h"
// Use LIEF C++ API

void inject_sea_blob(lief::MachO::Binary *binary, const uint8_t *blob, size_t size) {
    // Create NODE_SEA segment with __NODE_SEA_BLOB section
    auto segment = lief::MachO::SegmentCommand(SEGMENT_NAME_NODE_SEA);

    auto section = lief::MachO::Section(SECTION_NAME_NODE_SEA_BLOB);
    section.content(std::vector<uint8_t>(blob, blob + size));

    segment.add_section(section);
    binary->add(segment);
}
```

## Segment/Section Names

Use constants from `segment_names.h`:

### Mach-O

| Segment | Section | Purpose |
|---------|---------|---------|
| `NODE_SEA` | `__NODE_SEA_BLOB` | SEA application blob |
| `NODE_SEA` | `__SMOL_VFS_BLOB` | VFS archive |
| `NODE_SEA` | `__SMOL_VFS_CONFIG` | VFS configuration |
| `SMOL` | `__PRESSED_DATA` | Compressed binary |

### ELF

| Section | Purpose |
|---------|---------|
| `.note.node_sea_blob` | SEA application blob |
| `.note.smol_vfs_blob` | VFS archive |
| `.note.smol_vfs_config` | VFS configuration |
| `.note.smol_pressed_data` | Compressed binary |

### PE

| Section | Purpose |
|---------|---------|
| `.node_sea` | SEA application blob |
| `.smol_vfs` | VFS archive |
| `.vfs_config` | VFS configuration |
| `.pressed_data` | Compressed binary |

## Error Handling at Integration Points

### At Module Boundaries

Each module has specific error patterns:

```c
// Compression module: returns error codes
int result = decompress_buffer(...);
if (result != COMPRESS_OK) {
    fprintf(stderr, "Decompression: %s\n", compress_error_string(result));
}

// Segment reader: returns -1, prints to stderr
if (smol_read_metadata(fd, &metadata) == -1) {
    // Error already printed
    return -1;
}

// Detection functions: return 0/1/-1 (not found/found/error)
#if defined(__APPLE__)
if (smol_has_pressed_data_macho_impl(path) != 1) {
#elif defined(__linux__)
if (smol_has_pressed_data_elf_lief(path) != 1) {
#elif defined(_WIN32)
if (smol_has_pressed_data_pe_lief(path) != 1) {
#endif
    fprintf(stderr, "Not a SMOL compressed binary\n");
}
```

### Propagating Errors

```c
typedef enum {
    TOOL_OK = 0,
    TOOL_ERROR_FORMAT = 1,
    TOOL_ERROR_COMPRESS = 2,
    TOOL_ERROR_IO = 3,
    TOOL_ERROR_MEMORY = 4
} tool_error_t;

tool_error_t my_tool_function() {
    int compress_result = decompress_buffer(...);
    if (compress_result != COMPRESS_OK) {
        switch (compress_result) {
            case COMPRESS_ERROR_ALLOC_FAILED:
                return TOOL_ERROR_MEMORY;
            case COMPRESS_ERROR_DECOMPRESS_FAILED:
                return TOOL_ERROR_COMPRESS;
            default:
                return TOOL_ERROR_COMPRESS;
        }
    }
    return TOOL_OK;
}
```

## Platform-Specific Integration

### macOS

```c
#if defined(__APPLE__)
// Use optimized Mach-O header parsing
smol_read_metadata_macho(fd, &metadata);

// Use native Compression.framework
// (handled internally by compression_common.h)
#endif
```

### Linux

```c
#if defined(__linux__)
// Use optimized ELF PT_NOTE search
smol_read_metadata_elf(fd, &metadata);

// Detect glibc vs musl for binary compatibility
const char *libc = dlx_get_libc();  // from build-infra
#endif
```

### Windows

```c
#if defined(_WIN32)
// Use PE header parsing
smol_read_metadata_pe(fd, &metadata);

// Handle Windows path separators
// Handle .exe extension
#endif
```

## Build Configuration

### Including bin-infra Headers

```makefile
CFLAGS += -I$(BIN_INFRA_DIR)/src
```

```c
// Use full path includes
#include "socketsecurity/bin-infra/compression_common.h"
#include "socketsecurity/bin-infra/smol_segment_reader.h"
```

### Linking

| Platform | Requirements |
|----------|--------------|
| macOS | Compression.framework (native) |
| Linux | OpenSSL (for SHA-512), lzfse (bundled) |
| Windows | Crypt32.lib, lzfse (bundled) |

### LIEF Integration

For LIEF-dependent functions:

```makefile
# Check for LIEF
ifdef LIEF_LIB
CFLAGS += -DHAVE_LIEF
LDFLAGS += -L$(LIEF_LIB) -llief
endif
```

## Related Documentation

- [Error Handling](error-handling.md) - Error codes and recovery
- [Compression API](compression-api.md) - Compression function reference
- [Binary Formats](binary-formats.md) - SMOL format specification
