# Compression API Reference

API documentation for the LZFSE compression utilities in `compression_common.h`.

## Overview

bin-infra uses LZFSE compression on all platforms:
- **macOS**: Apple Compression.framework (native, optimized)
- **Linux/Windows**: Open-source lzfse library (bundled)

LZFSE provides excellent compression ratios (~75-79%) with fast decompression (~400 MB/s).

## Functions

### compress_buffer

```c
int compress_buffer(const uint8_t *input, size_t input_size,
                    uint8_t **output, size_t *output_size);
```

Compress data using LZFSE compression.

**Parameters:**
- `input` - Input data buffer
- `input_size` - Size of input data in bytes
- `output` - Pointer to receive allocated output buffer (**caller must free**)
- `output_size` - Pointer to receive size of compressed data

**Returns:** `COMPRESS_OK` (0) on success, negative error code on failure

**Example:**
```c
uint8_t *compressed;
size_t compressed_size;

int result = compress_buffer(data, data_size, &compressed, &compressed_size);
if (result != COMPRESS_OK) {
    fprintf(stderr, "Compression failed: %s\n", compress_error_string(result));
    return -1;
}

// Use compressed data...
printf("Compressed %zu bytes to %zu bytes (%.1f%%)\n",
       data_size, compressed_size,
       (float)compressed_size / data_size * 100);

free(compressed);  // Caller must free
```

### decompress_buffer

```c
int decompress_buffer(const uint8_t *input, size_t input_size,
                      uint8_t **output, size_t *output_size);
```

Decompress data using LZFSE. Automatically determines output size.

**Parameters:**
- `input` - Compressed data buffer
- `input_size` - Size of compressed data in bytes
- `output` - Pointer to receive allocated output buffer (**caller must free**)
- `output_size` - Pointer to receive size of decompressed data

**Returns:** `COMPRESS_OK` (0) on success, negative error code on failure

**Note:** This function progressively resizes the output buffer. Use `decompress_buffer_sized()` when you know the exact output size for better performance.

**Example:**
```c
uint8_t *decompressed;
size_t decompressed_size;

int result = decompress_buffer(compressed, compressed_size,
                               &decompressed, &decompressed_size);
if (result != COMPRESS_OK) {
    fprintf(stderr, "Decompression failed: %s\n", compress_error_string(result));
    return -1;
}

// Use decompressed data...
free(decompressed);  // Caller must free
```

### decompress_buffer_sized

```c
int decompress_buffer_sized(const uint8_t *input, size_t input_size,
                            uint8_t *output, size_t expected_size);
```

Decompress data into a pre-allocated buffer with known size.

**Parameters:**
- `input` - Compressed data buffer
- `input_size` - Size of compressed data in bytes
- `output` - Pre-allocated output buffer (must be at least `expected_size` bytes)
- `expected_size` - Expected size of decompressed data

**Returns:** `COMPRESS_OK` (0) on success, negative error code on failure

**When to use:** Use this when you know the exact decompressed size from metadata (e.g., from SMOL segment header). More efficient than `decompress_buffer()` since it avoids progressive resizing.

**Example:**
```c
// Read expected size from SMOL metadata
smol_metadata_t metadata;
smol_read_metadata(fd, &metadata);

// Pre-allocate exact size
uint8_t *output = malloc(metadata.uncompressed_size);
if (!output) {
    return COMPRESS_ERROR_ALLOC_FAILED;
}

// Decompress with known size (faster)
int result = decompress_buffer_sized(compressed, metadata.compressed_size,
                                     output, metadata.uncompressed_size);
if (result != COMPRESS_OK) {
    free(output);
    return result;
}

// Use output...
free(output);
```

### compress_buffer_with_algorithm

```c
int compress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                   uint8_t **output, size_t *output_size,
                                   int algorithm);
```

Compress with explicit algorithm selection.

**Parameters:**
- `algorithm` - Must be `COMPRESS_ALGORITHM_LZFSE` (0)

Currently only LZFSE is supported. Returns `COMPRESS_ERROR_UNSUPPORTED_ALGORITHM` for other values.

### decompress_buffer_with_algorithm

```c
int decompress_buffer_with_algorithm(const uint8_t *input, size_t input_size,
                                     uint8_t *output, size_t expected_size,
                                     int algorithm);
```

Decompress with explicit algorithm selection.

**Parameters:**
- `algorithm` - Must be `COMPRESS_ALGORITHM_LZFSE` (0)

### compress_error_string

```c
const char* compress_error_string(int error_code);
```

Get human-readable description for an error code.

**Returns:** Static string describing the error (do not free)

**Example:**
```c
int result = compress_buffer(data, size, &out, &out_size);
if (result != COMPRESS_OK) {
    fprintf(stderr, "Error: %s\n", compress_error_string(result));
    // Output: "Error: DECOMPRESS_FAILED: data may be corrupted or not LZFSE-compressed"
}
```

## Constants

### Error Codes

| Constant | Value | Description |
|----------|-------|-------------|
| `COMPRESS_OK` | 0 | Operation succeeded |
| `COMPRESS_ERROR_INVALID_INPUT` | -1 | Null pointer or zero-size buffer |
| `COMPRESS_ERROR_ALLOC_FAILED` | -2 | Memory allocation failed |
| `COMPRESS_ERROR_COMPRESS_FAILED` | -3 | Compression operation failed |
| `COMPRESS_ERROR_DECOMPRESS_FAILED` | -4 | Data corrupted or not LZFSE |
| `COMPRESS_ERROR_UNSUPPORTED_ALGORITHM` | -5 | Only LZFSE supported |
| `COMPRESS_ERROR_SIZE_LIMIT_EXCEEDED` | -6 | Decompressed size > 512 MB |

### Algorithm Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `COMPRESS_ALGORITHM_LZFSE` | 0 | LZFSE compression (only supported) |

### Size Limits

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_DECOMPRESSED_SIZE` | 512 MB | Maximum allowed decompressed size |

## Function Comparison

| Function | Allocates Output | Knows Size | Best For |
|----------|------------------|------------|----------|
| `decompress_buffer` | Yes (caller frees) | No | Unknown output size |
| `decompress_buffer_sized` | No (pre-allocated) | Yes | Known output size (faster) |

**Performance tip:** When decompressing SMOL binaries, always use `decompress_buffer_sized()` since the uncompressed size is in the metadata header.

## Platform Implementation Details

### macOS (Compression.framework)

Uses Apple's native Compression.framework:
```c
compression_encode_buffer(...)  // For compression
compression_decode_buffer(...)  // For decompression
```

Advantages:
- Hardware-accelerated on Apple Silicon
- Optimized for macOS memory subsystem
- No external dependencies

### Linux/Windows (lzfse library)

Uses bundled open-source lzfse library:
```c
lzfse_encode_buffer(...)  // For compression
lzfse_decode_buffer(...)  // For decompression
```

The library is statically linked to avoid runtime dependencies.

## Memory Management

**Critical:** Functions that allocate output buffers (`compress_buffer`, `decompress_buffer`) require the caller to free the returned buffer:

```c
uint8_t *output;
size_t output_size;

compress_buffer(input, input_size, &output, &output_size);
// ... use output ...
free(output);  // REQUIRED: caller must free
```

Functions with pre-allocated buffers (`decompress_buffer_sized`) do not allocate - the caller provides the buffer.

## Related Documentation

- [Error Handling](error-handling.md) - Error codes and recovery
- [Binary Formats](binary-formats.md) - SMOL format specification
