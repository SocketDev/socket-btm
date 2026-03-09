# Error Handling Guide

This guide documents error codes, handling patterns, and recovery strategies across bin-infra modules.

## Compression Module Errors

Error codes from `compression_common.h`:

| Code | Constant | Description | Recovery |
|------|----------|-------------|----------|
| 0 | `COMPRESS_OK` | Operation succeeded | N/A |
| -1 | `COMPRESS_ERROR_INVALID_INPUT` | Null pointer or zero-size buffer | Validate inputs before calling |
| -2 | `COMPRESS_ERROR_ALLOC_FAILED` | Memory allocation failed | Free unused memory, retry |
| -3 | `COMPRESS_ERROR_COMPRESS_FAILED` | Compression operation failed | Check input data validity |
| -4 | `COMPRESS_ERROR_DECOMPRESS_FAILED` | Data corrupted or not LZFSE | Verify source is LZFSE-compressed |
| -5 | `COMPRESS_ERROR_UNSUPPORTED_ALGORITHM` | Only LZFSE (0) supported | Use `COMPRESS_ALGORITHM_LZFSE` |
| -6 | `COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED` | Decompressed size > 512 MB | Split data or use streaming |

### Usage Pattern

```c
#include "socketsecurity/bin-infra/compression_common.h"

int result = decompress_buffer(input, input_size, &output, &output_size);
if (result != COMPRESS_OK) {
    fprintf(stderr, "Decompression failed: %s\n", compress_error_string(result));
    // Handle specific errors
    switch (result) {
        case COMPRESS_ERROR_ALLOC_FAILED:
            // Try to free memory and retry
            break;
        case COMPRESS_ERROR_DECOMPRESS_FAILED:
            // Data may be corrupted
            break;
        default:
            // Log and abort
            break;
    }
    return -1;
}
// Use output buffer (caller must free)
```

## SMOL Segment Reader Errors

Error codes from `smol_segment_reader.h`:

| Return | Meaning | Recovery |
|--------|---------|----------|
| 0 | Success | Proceed with metadata |
| -1 | Error (stderr message printed) | Check file format, permissions |

### Common Error Scenarios

**Magic marker not found:**
```
Error: SMOL marker not found in file
```
- File is not a SMOL-compressed binary
- Use `binpress` to compress first

**Invalid metadata:**
```
Error: Invalid SMOL metadata: sizes are zero
Error: Invalid cache key: not 16 hex characters
```
- Binary may be corrupted
- Re-compress with `binpress`

**Platform-specific fast path failed:**
```
Warning: Mach-O header parsing failed, falling back to marker scan
```
- Not a valid Mach-O/ELF/PE binary, or format unrecognized
- Falls back to full file scan (slower but works)

### Usage Pattern

```c
#include "socketsecurity/bin-infra/smol_segment_reader.h"

smol_metadata_t metadata;
int fd = open(binary_path, O_RDONLY);

// Platform-optimized reading
#if defined(__APPLE__)
int result = smol_read_metadata_macho(fd, &metadata);
#elif defined(__linux__)
int result = smol_read_metadata_elf(fd, &metadata);
#else
int result = smol_read_metadata(fd, &metadata);
#endif

if (result == -1) {
    close(fd);
    return -1;  // Error already printed to stderr
}

// Validate before using
if (smol_validate_metadata(&metadata, MAX_DECOMPRESSED_SIZE) == -1) {
    close(fd);
    return -1;
}

// fd is now positioned at compressed data start
// Read metadata.compressed_size bytes for decompression
```

## Binary Format Detection Errors

Error codes from `binary_format.h`:

| Return | Meaning |
|--------|---------|
| `BINARY_FORMAT_UNKNOWN` | Not a recognized binary format |
| `BINARY_FORMAT_MACHO` | Mach-O binary (macOS) |
| `BINARY_FORMAT_ELF` | ELF binary (Linux) |
| `BINARY_FORMAT_PE` | PE binary (Windows) |

### Usage Pattern

```c
#include "socketsecurity/bin-infra/binary_format.h"

// Read first 4 bytes of file
uint8_t magic[4];
// ... read magic bytes from file ...

binary_format_t format = detect_binary_format(magic);
if (format == BINARY_FORMAT_UNKNOWN) {
    fprintf(stderr, "Error: Unrecognized binary format\n");
    return -1;
}
```

## SMOL Detection Errors

Error codes from `smol_detect.h`:

| Return | Function | Meaning |
|--------|----------|---------|
| 0 | `smol_has_pressed_data_*` | No PRESSED_DATA section found |
| 1 | `smol_has_pressed_data_*` | PRESSED_DATA section exists |
| -1 | Various | Error occurred |

### Version Extraction Strategies

The version extraction functions try multiple strategies:

1. **SMFG config parsing** - Read version from embedded SMOL config
2. **PE VS_VERSION_INFO** - Extract from Windows version resource
3. **Binary string scan** - Search for version string pattern
4. **Fast native parsing** - Platform-specific header parsing

```c
// Fast path (platform-specific, no LIEF)
char *version = smol_extract_node_version_fast(binary_path);
if (version) {
    printf("Node.js version: %s\n", version);
    free(version);
}

// Full path (requires LIEF, works on all binaries)
char *version = smol_extract_node_version(binary_path);
```

## Error Handling Best Practices

### 1. Check Return Values

Always check return values and handle errors appropriately:

```c
// BAD: Ignoring return value
decompress_buffer(input, size, &output, &output_size);

// GOOD: Check and handle
int result = decompress_buffer(input, size, &output, &output_size);
if (result != COMPRESS_OK) {
    // Handle error
}
```

### 2. Use Error String Functions

Use provided error string functions for consistent messages:

```c
fprintf(stderr, "Compression error: %s\n", compress_error_string(result));
```

### 3. Clean Up Resources

Always clean up on error paths:

```c
int process_binary(const char *path) {
    int fd = -1;
    uint8_t *buffer = NULL;
    int result = -1;

    fd = open(path, O_RDONLY);
    if (fd == -1) goto cleanup;

    buffer = malloc(size);
    if (!buffer) goto cleanup;

    // ... processing ...

    result = 0;  // Success

cleanup:
    if (buffer) free(buffer);
    if (fd != -1) close(fd);
    return result;
}
```

### 4. Validate Early

Validate inputs before expensive operations:

```c
// Validate metadata before decompression (512 MB limit)
if (smol_validate_metadata(&metadata, MAX_DECOMPRESSED_SIZE) == -1) {
    return -1;
}

// Now safe to allocate and decompress
uint8_t *output = malloc(metadata.uncompressed_size);
```

## Cross-Module Error Flow

When errors propagate across modules:

```
binflate CLI
    ↓ calls
smol_read_metadata() → returns -1 on error (prints to stderr)
    ↓ calls
decompress_buffer_sized() → returns error code
    ↓
compress_error_string() → human-readable message
```

Consumer tools should:
1. Check each return value
2. Print context-specific messages
3. Clean up allocated resources
4. Return appropriate exit codes

## Related Documentation

- [Compression API](compression-api.md) - Compression function reference
- [Binary Formats](binary-formats.md) - SMOL binary format specification
