# C Headers API Reference

Reference for C header files in build-infra used by consumer packages.

## Overview

build-infra provides shared C utilities:

```
build-infra/src/socketsecurity/build-infra/
├── dlx_cache_common.h    # DLX cache management
├── debug_common.h        # Debug logging
├── file_io_common.h      # File I/O utilities
├── file_utils.h          # Path and permission utilities
├── process_exec.h        # Safe process execution
├── gzip_compress.h       # Gzip compression
├── tar_create.h          # TAR archive creation
├── tmpdir_common.h       # Temp directory detection
├── path_utils.h          # Path manipulation
└── posix_compat.h        # Windows POSIX compatibility
```

---

## file_io_common.h

Cross-platform file I/O with consistent error handling.

### Error Codes

```c
#define FILE_IO_OK 0
#define FILE_IO_ERROR -1
#define FILE_IO_ERROR_OPEN_FAILED -2
#define FILE_IO_ERROR_READ_FAILED -3
#define FILE_IO_ERROR_WRITE_FAILED -4
#define FILE_IO_ERROR_ALLOC_FAILED -5
```

### Functions

#### file_io_read

```c
int file_io_read(const char *path, uint8_t **data, size_t *size);
```

Read entire file into memory buffer.

**Parameters:**
- `path` - File path to read
- `data` - Pointer to receive allocated buffer (caller must free)
- `size` - Pointer to receive file size

**Returns:** `FILE_IO_OK` on success, error code on failure

#### file_io_write

```c
int file_io_write(const char *path, const uint8_t *data, size_t size);
```

Write buffer to file.

**Parameters:**
- `path` - File path to write
- `data` - Buffer to write
- `size` - Size of buffer in bytes

**Returns:** `FILE_IO_OK` on success, error code on failure

#### file_io_copy

```c
int file_io_copy(const char *source, const char *dest);
```

Copy file from source to destination. Uses buffered I/O for efficiency.

**Returns:** `FILE_IO_OK` on success, error code on failure

#### file_io_sync

```c
int file_io_sync(FILE *fp);
```

Sync file data to disk (cross-platform fsync).

**Returns:** `FILE_IO_OK` on success, `FILE_IO_ERROR` on failure

#### file_io_sync_fd

```c
int file_io_sync_fd(int fd);
```

Sync file descriptor to disk. Use for raw file descriptors from `open()`, `mkstemp()`, etc.

#### fsync_file_by_path

```c
int fsync_file_by_path(const char *path);
```

Sync file to disk by path. Opens file read-only, syncs, and closes.

#### file_io_set_cloexec

```c
int file_io_set_cloexec(int fd);
```

Set close-on-exec flag (FD_CLOEXEC on POSIX, non-inheritable on Windows).

---

## file_utils.h

Path and permission utilities with safe wrappers.

### Functions

#### create_parent_directories

```c
int create_parent_directories(const char *filepath);
```

Create parent directories for a file path.

**Returns:** 0 on success, -1 on failure

#### mkdir_recursive

```c
int mkdir_recursive(const char *dirpath);
```

Create directory and all parent directories (like `mkdir -p`).

**Returns:** 0 on success, -1 on failure

#### ensure_exe_extension

```c
char *ensure_exe_extension(const char *path);
```

Ensure output path has .exe extension for PE binaries.

**Returns:** Allocated string (caller must free), or NULL on error

#### set_executable_permissions

```c
int set_executable_permissions(const char *path);
```

Set executable permissions on a file.
- Unix: sets 0755 (rwxr-xr-x)
- Windows: sets _S_IREAD | _S_IWRITE | _S_IEXEC

**Returns:** 0 on success, -1 on failure

#### file_exists

```c
int file_exists(const char *path);
```

Check if file exists and is readable.

**Returns:** 1 if exists, 0 if not

#### is_directory

```c
int is_directory(const char *path);
```

Check if path is a directory.

**Returns:** 1 if directory exists, 0 if not

#### safe_dirname

```c
char *safe_dirname(const char *path);
```

Thread-safe dirname wrapper. Returns newly allocated string.

**Note:** Caller must `free()` returned string.

#### safe_basename

```c
char *safe_basename(const char *path);
```

Thread-safe basename wrapper. Returns newly allocated string.

**Note:** Caller must `free()` returned string.

#### is_tar_gz_file

```c
int is_tar_gz_file(const char *path);
```

Check if file has .tar.gz or .tgz extension.

**Returns:** 1 if tar.gz, 0 otherwise

#### is_tar_file

```c
int is_tar_file(const char *path);
```

Check if file has .tar extension (uncompressed tar).

**Returns:** 1 if .tar, 0 otherwise

#### is_gzip_data

```c
int is_gzip_data(const uint8_t *data, size_t size);
```

Check if data has gzip magic bytes (0x1F 0x8B).

**Returns:** 1 if gzip data, 0 otherwise

#### write_file_atomically

```c
int write_file_atomically(const char *path, const unsigned char *data, size_t size, int mode);
```

Write data to file atomically (cross-platform).

**Parameters:**
- `path` - Path to file
- `data` - Data buffer to write
- `size` - Size of data in bytes
- `mode` - Unix permissions (e.g., 0755) - ignored on Windows

**Returns:** 0 on success, -1 on failure (with error logged to stderr)

---

## gzip_compress.h

Platform-abstracted gzip compression. Uses Apple Compression.framework on macOS, libdeflate on Linux/Windows.

### Error Codes

```c
#define GZIP_OK 0
#define GZIP_ERROR -1
#define GZIP_ERROR_ALLOC -2
#define GZIP_ERROR_INVALID_INPUT -3
```

### Functions

#### gzip_compress

```c
int gzip_compress(const uint8_t *input, size_t input_size,
                  uint8_t **output, size_t *output_size, int level);
```

Compress data using gzip format.

**Parameters:**
- `input` - Input data buffer
- `input_size` - Size of input in bytes
- `output` - Pointer to receive allocated output buffer (caller must free)
- `output_size` - Pointer to receive compressed size
- `level` - Compression level (1=fastest, 6=default, 9=best, 12=max for libdeflate)

**Returns:** `GZIP_OK` on success, error code on failure

#### gzip_compress_bound

```c
size_t gzip_compress_bound(size_t input_size);
```

Get maximum compressed size for a given input size. Useful for pre-allocating buffers.

**Returns:** Maximum possible compressed size

---

## tar_create.h

Create POSIX ustar format TAR archives in memory.

### Error Codes

```c
#define TAR_OK 0
#define TAR_ERROR -1
#define TAR_ERROR_ALLOC -2
#define TAR_ERROR_PATH_TOO_LONG -3
#define TAR_ERROR_READ_FAILED -4
#define TAR_ERROR_NOT_DIRECTORY -5
```

### Functions

#### tar_create_from_directory

```c
int tar_create_from_directory(const char *dir_path,
                              uint8_t **output, size_t *output_size);
```

Create TAR archive from directory.

**Parameters:**
- `dir_path` - Path to directory to archive
- `output` - Pointer to receive allocated output buffer (caller must free)
- `output_size` - Pointer to receive TAR archive size

**Returns:** `TAR_OK` on success, error code on failure

Archive contains files with paths relative to dir_path.

#### tar_gz_create_from_directory

```c
int tar_gz_create_from_directory(const char *dir_path,
                                 uint8_t **output, size_t *output_size,
                                 int level);
```

Create gzipped TAR archive (.tar.gz) from directory.

**Parameters:**
- `dir_path` - Path to directory to archive
- `output` - Pointer to receive allocated output buffer (caller must free)
- `output_size` - Pointer to receive compressed archive size
- `level` - Compression level (1=fastest, 6=default, 9=best)

**Returns:** `TAR_OK` on success, error code on failure

---

## dlx_cache_common.h

DLX binary cache for extracted/decompressed binaries.

### Functions

#### dlx_get_cache_base_dir

```c
int dlx_get_cache_base_dir(char *buf, size_t size);
```

Get cache directory path with environment variable support.

**Priority:**
1. `SOCKET_DLX_DIR` (full override)
2. `SOCKET_HOME` + `/_dlx`
3. `$HOME/.socket/_dlx`
4. `/tmp/.socket/_dlx` (fallback)

**Returns:** 0 on success, -1 on error

#### dlx_calculate_cache_key

```c
int dlx_calculate_cache_key(const unsigned char *data, size_t len, char *cache_key);
```

Calculate 16-char hex cache key from SHA-512 hash.

**Parameters:**
- `data` - Data to hash
- `len` - Data length
- `cache_key` - Output buffer (17 bytes for null terminator)

**Returns:** 0 on success, -1 on error

#### dlx_get_cached_binary_path

```c
int dlx_get_cached_binary_path(
    const char *cache_key,
    uint64_t expected_size,
    char *cached_path,
    size_t path_size
);
```

Check if valid cached binary exists.

**Returns:** 0 if found and valid, -1 otherwise

#### dlx_write_to_cache

```c
static int dlx_write_to_cache(
    const char *cache_key,
    const unsigned char *data,
    size_t size,
    const char *exe_path,
    const char *integrity,
    const dlx_update_check_t *update_check
);
```

Write binary to cache with metadata.

---

## debug_common.h

Namespace-filtered debug logging.

### Macros

#### DEBUG_INIT

```c
DEBUG_INIT("namespace:subnamespace");
```

Initialize debug logging for a namespace.

#### DEBUG_LOG

```c
DEBUG_LOG("Format string: %s %d", string_arg, int_arg);
```

Log if DEBUG environment matches namespace.

### Usage

```c
#include "socketsecurity/build-infra/debug_common.h"

DEBUG_INIT("smol:extract");

void extract_binary(void) {
    DEBUG_LOG("Starting extraction");
    // ...
    DEBUG_LOG("Extracted %zu bytes", size);
}
```

Enable with:
```bash
DEBUG="smol:*" ./myapp
```

---

## tmpdir_common.h

Temp directory detection.

### Functions

#### get_tmpdir

```c
const char* get_tmpdir(const char *fallback);
```

Get system temp directory.

**Checks:**
1. `TMPDIR` environment variable
2. `TEMP` (Windows)
3. `TMP` (Windows)
4. `/tmp` (Unix default)
5. `fallback` parameter

**Returns:** Static string (do not free)

---

## posix_compat.h

Windows POSIX compatibility layer.

### Macros

When included on Windows:

```c
#define POSIX_OPEN     _open
#define POSIX_CLOSE    _close
#define POSIX_READ     _read
#define POSIX_WRITE    _write
#define POSIX_LSEEK    _lseeki64
#define POSIX_STAT     _stat64
#define POSIX_FSTAT    _fstat64
#define POSIX_UNLINK   _unlink
#define POSIX_MKDIR(p) _mkdir(p)
```

On Unix, these map directly to POSIX functions.

### Usage

```c
#include "socketsecurity/build-infra/posix_compat.h"

// Works on both Windows and Unix
int fd = POSIX_OPEN(path, O_RDONLY);
POSIX_CLOSE(fd);
```

**Note:** In C++ files, include with extern "C" wrapper.

---

## Platform Support

| Header | macOS | Linux | Windows |
|--------|-------|-------|---------|
| dlx_cache_common.h | Yes | Yes | Yes |
| debug_common.h | Yes | Yes | Yes |
| file_io_common.h | Yes | Yes | Yes |
| file_utils.h | Yes | Yes | Yes |
| process_exec.h | Yes | Yes | Yes |
| gzip_compress.h | Yes | Yes | Yes |
| tar_create.h | Yes | Yes | Yes |
| tmpdir_common.h | Yes | Yes | Yes |
| posix_compat.h | Yes | Yes | Yes |

---

## Related Documentation

- [Environment Variables](environment-variables.md) - Env var reference
- [Caching Strategy](caching-strategy.md) - DLX cache architecture
