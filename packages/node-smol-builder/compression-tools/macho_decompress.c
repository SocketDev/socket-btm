/**
 * macOS Mach-O Binary Decompressor Stub
 *
 * Self-extracting decompressor for compressed Mach-O binaries.
 * This stub is prepended to compressed data to create a self-extracting binary.
 *
 * Binary format:
 *   [Decompressor stub code]
 *   [8-byte header: compressed size (uint64_t)]
 *   [8-byte header: uncompressed size (uint64_t)]
 *   [Compressed data]
 *
 * At runtime:
 *   1. Reads compressed data from its own binary (after this stub)
 *   2. Decompresses to memory
 *   3. Writes to temp file in /tmp
 *   4. Executes decompressed binary with original arguments
 *   5. Cleans up temp file on exit
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/mman.h>
#include <errno.h>
#include <compression.h>
#include <mach-o/dyld.h>

// Marker to find the start of compressed data in the binary
// Split into two parts to avoid this string appearing in the decompressor binary itself
#define MAGIC_MARKER_PART1 "SOCKETBIN_COMPRESSED_DATA_START"
#define MAGIC_MARKER_PART2 "_MAGIC_MARKER"
#define MAGIC_MARKER_LEN 44

/**
 * Get path to current executable
 */
static int get_executable_path(char *buf, size_t size) {
    uint32_t bufsize = (uint32_t)size;
    if (_NSGetExecutablePath(buf, &bufsize) != 0) {
        fprintf(stderr, "Error: Buffer too small for executable path\n");
        return -1;
    }
    return 0;
}

/**
 * Find magic marker in file and return offset to compressed data
 */
static long find_compressed_data_offset(int fd) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[MAGIC_MARKER_LEN + 1];
    snprintf(magic_marker, sizeof(magic_marker), "%s%s", MAGIC_MARKER_PART1, MAGIC_MARKER_PART2);

    char buffer[4096];
    long offset = 0;
    ssize_t bytes_read;

    while ((bytes_read = read(fd, buffer, sizeof(buffer))) > 0) {
        for (ssize_t i = 0; i < bytes_read - MAGIC_MARKER_LEN; i++) {
            if (memcmp(buffer + i, magic_marker, MAGIC_MARKER_LEN) == 0) {
                // Found marker - return offset just after it
                return offset + i + MAGIC_MARKER_LEN;
            }
        }
        offset += bytes_read;

        // Rewind a bit to handle marker split across buffer boundary
        if (lseek(fd, offset - MAGIC_MARKER_LEN, SEEK_SET) == -1) {
            return -1;
        }
        offset -= MAGIC_MARKER_LEN;
    }

    return -1; // Not found
}

/**
 * Create temp file and return file descriptor
 */
static int create_temp_file(char *template_path) {
    int fd = mkstemp(template_path);
    if (fd == -1) {
        fprintf(stderr, "Error: Failed to create temp file: %s\n", strerror(errno));
        return -1;
    }

    // Make executable
    if (fchmod(fd, 0700) == -1) {
        fprintf(stderr, "Error: Failed to make temp file executable: %s\n", strerror(errno));
        close(fd);
        unlink(template_path);
        return -1;
    }

    return fd;
}

int main(int argc, char *argv[], char *envp[]) {
    (void)argc; // Unused parameter
    int exit_code = 1;
    char exe_path[1024];
    char temp_path[512];
    int source_fd = -1;
    int dest_fd = -1;
    unsigned char *compressed_data = NULL;
    unsigned char *decompressed_data = NULL;

    // Use system temp directory (respects TMPDIR env var)
    const char *tmpdir = getenv("TMPDIR");
    if (!tmpdir || strlen(tmpdir) == 0) {
        tmpdir = "/tmp";
    }
    snprintf(temp_path, sizeof(temp_path), "%s/socketsecurity-node-XXXXXX", tmpdir);

    // Get path to current executable
    if (get_executable_path(exe_path, sizeof(exe_path)) != 0) {
        goto cleanup;
    }

    // Open self for reading
    source_fd = open(exe_path, O_RDONLY);
    if (source_fd == -1) {
        fprintf(stderr, "Error: Failed to open self: %s\n", strerror(errno));
        goto cleanup;
    }

    // Find compressed data offset
    long data_offset = find_compressed_data_offset(source_fd);
    if (data_offset == -1) {
        fprintf(stderr, "Error: Could not find compressed data marker in binary\n");
        goto cleanup;
    }

    // Seek to compressed data
    if (lseek(source_fd, data_offset, SEEK_SET) == -1) {
        fprintf(stderr, "Error: Failed to seek to compressed data: %s\n", strerror(errno));
        goto cleanup;
    }

    // Read sizes
    uint64_t compressed_size, uncompressed_size;
    if (read(source_fd, &compressed_size, sizeof(compressed_size)) != sizeof(compressed_size)) {
        fprintf(stderr, "Error: Failed to read compressed size\n");
        goto cleanup;
    }
    if (read(source_fd, &uncompressed_size, sizeof(uncompressed_size)) != sizeof(uncompressed_size)) {
        fprintf(stderr, "Error: Failed to read uncompressed size\n");
        goto cleanup;
    }

    // Validate sizes
    if (compressed_size == 0 || uncompressed_size == 0 ||
        compressed_size > 500 * 1024 * 1024 || uncompressed_size > 500 * 1024 * 1024) {
        fprintf(stderr, "Error: Invalid compressed/uncompressed sizes\n");
        goto cleanup;
    }

    // Allocate buffers
    compressed_data = malloc(compressed_size);
    decompressed_data = malloc(uncompressed_size);
    if (!compressed_data || !decompressed_data) {
        fprintf(stderr, "Error: Failed to allocate memory\n");
        goto cleanup;
    }

    // Read compressed data
    ssize_t total_read = 0;
    while (total_read < (ssize_t)compressed_size) {
        ssize_t n = read(source_fd, compressed_data + total_read, compressed_size - total_read);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to read compressed data\n");
            goto cleanup;
        }
        total_read += n;
    }

    // Decompress using Apple Compression API (LZFSE)
    size_t decompressed_bytes = compression_decode_buffer(
        decompressed_data, uncompressed_size,
        compressed_data, compressed_size,
        NULL, // scratch buffer (optional)
        COMPRESSION_LZFSE
    );

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr, "Error: Decompression failed (got %zu bytes, expected %llu)\n",
                decompressed_bytes, uncompressed_size);
        goto cleanup;
    }

    // Create temp file
    dest_fd = create_temp_file(temp_path);
    if (dest_fd == -1) {
        goto cleanup;
    }

    // Write decompressed data
    ssize_t total_written = 0;
    while (total_written < (ssize_t)uncompressed_size) {
        ssize_t n = write(dest_fd, decompressed_data + total_written,
                         uncompressed_size - total_written);
        if (n <= 0) {
            fprintf(stderr, "Error: Failed to write decompressed data: %s\n", strerror(errno));
            goto cleanup;
        }
        total_written += n;
    }

    // Close file descriptors before exec
    close(source_fd);
    source_fd = -1;
    close(dest_fd);
    dest_fd = -1;

    // Free memory before exec
    free(compressed_data);
    compressed_data = NULL;
    free(decompressed_data);
    decompressed_data = NULL;

    // Execute decompressed binary
    execve(temp_path, argv, envp);

    // If we get here, exec failed
    fprintf(stderr, "Error: Failed to execute decompressed binary: %s\n", strerror(errno));
    unlink(temp_path);
    return 1;

cleanup:
    if (source_fd != -1) close(source_fd);
    if (dest_fd != -1) close(dest_fd);
    if (compressed_data) free(compressed_data);
    if (decompressed_data) free(decompressed_data);
    // Clean up temp file if it was created (mkstemp replaces XXXXXX with actual name)
    if (temp_path[0] != '\0' && strstr(temp_path, "XXXXXX") == NULL) {
        unlink(temp_path);
    }
    return exit_code;
}
