/**
 * @file marker_finder.h
 * @brief Shared marker finding functionality for compressed binaries
 *
 * This header provides utilities to find magic markers in binary files.
 * Used by both the stub (to find binflate) and binflate (to find compressed data).
 */

#ifndef MARKER_FINDER_H
#define MARKER_FINDER_H

#include <string.h>
#include <stdio.h>
#include <stdint.h>

#ifdef _WIN32
#include <windows.h>
#include "socketsecurity/build-infra/posix_compat.h"
#else
#include <unistd.h>
#endif

/**
 * Find a magic marker in an open file descriptor
 *
 * @param fd File descriptor to search (must be open for reading)
 * @param part1 First part of the marker
 * @param part2 Second part of the marker
 * @param part3 Third part of the marker
 * @param marker_len Total length of the combined marker
 * @return Offset just after the marker, or -1 if not found
 *
 * The marker is split into three parts to prevent it from appearing
 * in the binary itself. This function reconstructs and searches for it.
 *
 * Example usage:
 *   int64_t offset = find_marker(fd, "__SOCKETSEC_", "BINFLATE_", "MAGIC_MARKER", 33);
 */
static inline int64_t find_marker(int fd, const char *part1, const char *part2, const char *part3, size_t marker_len) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[128];
    int len = snprintf(magic_marker, sizeof(magic_marker), "%s%s%s", part1, part2, part3);
    if (len < 0 || (size_t)len != marker_len) {
        return -1;
    }

    // Overlap buffer pattern: keep (marker_len - 1) bytes from previous read
    // to handle markers split across buffer boundaries without lseek() calls.
    #define MARKER_BUFFER_SIZE 4096
    char buffer[MARKER_BUFFER_SIZE + 128];  // Extra space for overlap prefix
    size_t overlap = marker_len > 1 ? marker_len - 1 : 0;
    size_t prefix_len = 0;  // Bytes carried over from previous iteration
    int64_t file_offset = 0;  // Tracks position in file (not buffer)
    ssize_t bytes_read;

    // Seek to beginning
    if (lseek(fd, 0, SEEK_SET) == -1) {
        return -1;
    }

    while ((bytes_read = read(fd, buffer + prefix_len, MARKER_BUFFER_SIZE)) > 0) {
        size_t total_len = prefix_len + (size_t)bytes_read;

        // Search for marker in current buffer (including overlap prefix)
        if (total_len >= marker_len) {
#if defined(__GLIBC__) && defined(_GNU_SOURCE)
            // Use optimized memmem() on glibc (available since glibc 2.0)
            void *found = memmem(buffer, total_len, magic_marker, marker_len);
            if (found) {
                size_t i = (char *)found - buffer;
                // Found marker - calculate file offset
                // file_offset points to start of new data, so subtract prefix_len
                return (file_offset - (int64_t)prefix_len) + (int64_t)i + (int64_t)marker_len;
            }
#else
            // Fallback: manual byte-by-byte search
            for (size_t i = 0; i <= total_len - marker_len; i++) {
                if (memcmp(buffer + i, magic_marker, marker_len) == 0) {
                    // Found marker - calculate file offset
                    // file_offset points to start of new data, so subtract prefix_len
                    return (file_offset - (int64_t)prefix_len) + (int64_t)i + (int64_t)marker_len;
                }
            }
#endif
        }

        // Update file offset (tracks where we are in the file)
        file_offset += bytes_read;

        // Copy overlap bytes to beginning of buffer for next iteration
        // Only if we read a full buffer (otherwise we're at EOF)
        if (bytes_read == MARKER_BUFFER_SIZE && total_len >= overlap) {
            memmove(buffer, buffer + total_len - overlap, overlap);
            prefix_len = overlap;
        } else {
            prefix_len = 0;
        }
    }
    #undef MARKER_BUFFER_SIZE

    return -1; // Not found
}

#ifdef _WIN32
/**
 * Find a magic marker in an open Windows file handle
 *
 * @param hFile Windows file handle to search (must be open for reading)
 * @param part1 First part of the marker
 * @param part2 Second part of the marker
 * @param part3 Third part of the marker
 * @param marker_len Total length of the combined marker
 * @return Offset just after the marker, or -1 if not found
 *
 * Windows version of find_marker that uses HANDLE instead of file descriptor.
 */
static inline LONGLONG find_marker_handle(HANDLE hFile, const char *part1, const char *part2, const char *part3, size_t marker_len) {
    // Build the magic marker at runtime to avoid it appearing in the binary
    char magic_marker[128];
    int len = snprintf(magic_marker, sizeof(magic_marker), "%s%s%s", part1, part2, part3);
    if (len < 0 || (size_t)len != marker_len) {
        return -1;
    }

    // Overlap buffer pattern: keep (marker_len - 1) bytes from previous read
    // to handle markers split across buffer boundaries without SetFilePointerEx() calls.
    #define MARKER_BUFFER_SIZE_WIN 4096
    char buffer[MARKER_BUFFER_SIZE_WIN + 128];  // Extra space for overlap prefix
    size_t overlap = marker_len > 1 ? marker_len - 1 : 0;
    size_t prefix_len = 0;  // Bytes carried over from previous iteration
    LONGLONG file_offset = 0;  // Tracks position in file (not buffer)
    DWORD bytes_read;

    // Seek to beginning
    LARGE_INTEGER zero;
    zero.QuadPart = 0;
    if (!SetFilePointerEx(hFile, zero, NULL, FILE_BEGIN)) {
        return -1;
    }

    while (ReadFile(hFile, buffer + prefix_len, MARKER_BUFFER_SIZE_WIN, &bytes_read, NULL) && bytes_read > 0) {
        size_t total_len = prefix_len + (size_t)bytes_read;

        // Search for marker in current buffer (including overlap prefix)
        if (total_len >= marker_len) {
            // Windows CRT doesn't provide memmem(), so use manual search
            for (size_t i = 0; i <= total_len - marker_len; i++) {
                if (memcmp(buffer + i, magic_marker, marker_len) == 0) {
                    // Found marker - calculate file offset
                    // file_offset points to start of new data, so subtract prefix_len
                    return (file_offset - (LONGLONG)prefix_len) + (LONGLONG)i + (LONGLONG)marker_len;
                }
            }
        }

        // Update file offset (tracks where we are in the file)
        file_offset += bytes_read;

        // Copy overlap bytes to beginning of buffer for next iteration
        // Only if we read a full buffer (otherwise we're at EOF)
        if (bytes_read == MARKER_BUFFER_SIZE_WIN && total_len >= overlap) {
            memmove(buffer, buffer + total_len - overlap, overlap);
            prefix_len = overlap;
        } else {
            prefix_len = 0;
        }
    }
    #undef MARKER_BUFFER_SIZE_WIN

    return -1; // Not found
}
#endif

#endif /* MARKER_FINDER_H */
