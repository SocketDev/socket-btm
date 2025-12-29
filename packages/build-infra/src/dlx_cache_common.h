/**
 * Common dlxBinary Cache Implementation
 *
 * Shared caching logic for all platform decompressors (macOS, Linux, Windows).
 * Follows socket-lib's dlxBinary caching strategy exactly.
 *
 * References:
 * - generateCacheKey: https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/dlx.ts#L55
 * - DlxMetadata schema: https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/dlx-binary.ts#L49-L130
 * - Cache directory: https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/paths/socket.ts
 *
 * Cache structure: ~/.socket/_dlx/<cache_key>/<binary_name>
 * - cache_key: First 16 hex chars of SHA-512 hash (generateCacheKey behavior)
 * - binary_name: node (or node.exe on Windows)
 * - Metadata: .dlx-metadata.json (unified DlxMetadata schema)
 *
 * Usage:
 *   #include "dlx_cache_common.h"
 *
 * Platform requirements:
 *   - macOS: CommonCrypto (CC_SHA512)
 *   - Linux: OpenSSL (SHA512)
 *   - Windows: CryptoAPI (Crypt32.lib)
 */

#ifndef DLX_CACHE_COMMON_H
#define DLX_CACHE_COMMON_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <errno.h>
#include <time.h>

// Platform-specific includes.
#if defined(__linux__)
    #include <pwd.h>
    #include <unistd.h>
#elif defined(_WIN32)
    #include <windows.h>
    #include <shlobj.h>
#endif

#define DLX_CACHE_DIR "_dlx"

/**
 * Get user's home directory (cross-platform).
 */
static int dlx_get_home_dir(char *buf, size_t size) {
#if defined(_WIN32)
    if (SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, 0, buf) != S_OK) {
        return -1;
    }
    return 0;
#else
    const char *home = getenv("HOME");
    if (!home) {
#if defined(__linux__)
        struct passwd *pw = getpwuid(getuid());
        if (!pw || !pw->pw_dir) {
            return -1;
        }
        home = pw->pw_dir;
#else
        return -1;
#endif
    }

    size_t home_len = strlen(home);
    if (home_len >= size) {
        return -1;
    }

    /* Use memcpy instead of strcpy for better safety */
    memcpy(buf, home, home_len);
    buf[home_len] = '\0';
    return 0;
#endif
}

/**
 * Get DLX cache directory with environment variable support.
 * Matches Socket Lib's getSocketDlxDir() behavior.
 *
 * Priority order (consistent with Socket Lib):
 *   1. SOCKET_DLX_DIR - Full override of DLX cache directory
 *   2. SOCKET_HOME - Base directory (appends /_dlx)
 *   3. Default: $HOME/.socket/_dlx
 *   4. Fallback: /tmp/.socket/_dlx (Unix) or C:\temp\.socket\_dlx (Windows)
 *
 * Examples:
 *   SOCKET_DLX_DIR="/custom/cache" -> /custom/cache
 *   SOCKET_HOME="/opt/socket" -> /opt/socket/_dlx
 *   (no env vars) -> ~/.socket/_dlx
 */
static int dlx_get_cache_base_dir(char *buf, size_t size) {
    // Priority 1: Check SOCKET_DLX_DIR (full override).
    const char *dlx_dir = getenv("SOCKET_DLX_DIR");
    if (dlx_dir && dlx_dir[0] != '\0') {
        size_t len = strlen(dlx_dir);
        if (len >= size) {
            return -1;
        }
        memcpy(buf, dlx_dir, len);
        buf[len] = '\0';
        return 0;
    }

    // Priority 2: Check SOCKET_HOME (base directory + _dlx).
    const char *socket_home = getenv("SOCKET_HOME");
    if (socket_home && socket_home[0] != '\0') {
#if defined(_WIN32)
        int written = snprintf(buf, size, "%s\\_dlx", socket_home);
#else
        int written = snprintf(buf, size, "%s/_dlx", socket_home);
#endif
        if (written < 0 || (size_t)written >= size) {
            return -1;
        }
        return 0;
    }

    // Priority 3: Default $HOME/.socket/_dlx.
    char home[512];
    if (dlx_get_home_dir(home, sizeof(home)) == 0) {
#if defined(_WIN32)
        int written = snprintf(buf, size, "%s\\.socket\\_dlx", home);
#else
        int written = snprintf(buf, size, "%s/.socket/_dlx", home);
#endif
        if (written < 0 || (size_t)written >= size) {
            return -1;
        }
        return 0;
    }

    // Priority 4: Fallback to /tmp.
#if defined(_WIN32)
    int written = snprintf(buf, size, "C:\\temp\\.socket\\_dlx");
#else
    int written = snprintf(buf, size, "/tmp/.socket/_dlx");
#endif
    if (written < 0 || (size_t)written >= size) {
        return -1;
    }
    return 0;
}

/**
 * Get platform string.
 */
static const char* dlx_get_platform(void) {
#if defined(__APPLE__)
    return "darwin";
#elif defined(__linux__)
    return "linux";
#elif defined(_WIN32)
    return "win32";
#else
    return "unknown";
#endif
}

/**
 * Get architecture string.
 */
static const char* dlx_get_arch(void) {
#if defined(__x86_64__) || defined(__amd64__) || defined(_M_X64)
    return "x64";
#elif defined(__aarch64__) || defined(__arm64__) || defined(_M_ARM64)
    return "arm64";
#elif defined(__i386__) || defined(__i686__) || defined(_M_IX86)
    return "ia32";
#elif defined(__arm__) || defined(_M_ARM)
    return "arm";
#else
    return "unknown";
#endif
}

/**
 * Get libc variant (Linux only).
 * Returns "musl" for musl-based systems (Alpine), "glibc" for glibc-based systems.
 * Uses runtime detection via ldd for robustness across distros.
 */
static const char* dlx_get_libc(void) {
#if defined(__linux__)
    // Try runtime detection using ldd --version.
    FILE *fp = popen("ldd --version 2>&1", "r");
    if (fp) {
        char buf[256];
        if (fgets(buf, sizeof(buf), fp)) {
            // Convert to lowercase for case-insensitive matching.
            for (char *p = buf; *p; p++) {
                *p = tolower(*p);
            }

            if (strstr(buf, "musl")) {
                pclose(fp);
                return "musl";
            }
            if (strstr(buf, "glibc") || strstr(buf, "gnu")) {
                pclose(fp);
                return "glibc";
            }
        }
        pclose(fp);
    }

    // Fallback: Check for musl dynamic linker (common paths).
    const char *musl_loaders[] = {
        "/lib/ld-musl-x86_64.so.1",
        "/lib/ld-musl-aarch64.so.1",
        "/lib/ld-musl-i386.so.1",
        "/lib/ld-musl-arm.so.1",
        "/usr/lib/ld-musl-x86_64.so.1",
        "/usr/lib/ld-musl-aarch64.so.1",
        NULL
    };

    for (const char **loader = musl_loaders; *loader; loader++) {
        if (access(*loader, F_OK) == 0) {
            return "musl";
        }
    }

    // Default to glibc (most common).
    return "glibc";
#else
    return NULL;
#endif
}

/**
 * Create directory recursively (cross-platform).
 */
static int dlx_create_directory_recursive(const char *path) {
#if defined(_WIN32)
    char tmp[1024];
    char *p = NULL;
    size_t len;

    snprintf(tmp, sizeof(tmp), "%s", path);
    len = strlen(tmp);
    if (tmp[len - 1] == '\\' || tmp[len - 1] == '/') {
        tmp[len - 1] = 0;
    }

    for (p = tmp + 1; *p; p++) {
        if (*p == '\\' || *p == '/') {
            *p = 0;
            CreateDirectoryA(tmp, NULL);
            *p = '\\';
        }
    }

    if (CreateDirectoryA(tmp, NULL) == 0 && GetLastError() != ERROR_ALREADY_EXISTS) {
        return -1;
    }

    return 0;
#else
    char tmp[1024];
    char *p = NULL;
    size_t len;

    snprintf(tmp, sizeof(tmp), "%s", path);
    len = strlen(tmp);
    if (tmp[len - 1] == '/') {
        tmp[len - 1] = 0;
    }

    for (p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = 0;
            if (mkdir(tmp, 0755) == -1 && errno != EEXIST) {
                return -1;
            }
            *p = '/';
        }
    }

    if (mkdir(tmp, 0755) == -1 && errno != EEXIST) {
        return -1;
    }

    return 0;
#endif
}

/**
 * Create dlx cache directory structure: <base_dir>/<cache_key>
 * Matches dlxBinary directory structure exactly.
 * Respects SOCKET_DLX_DIR and SOCKET_HOME environment variables.
 */
static int dlx_create_cache_entry_dir(const char *cache_key, char *entry_dir, size_t size) {
    char base_dir[512];
    if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) == -1) {
        return -1;
    }

#if defined(_WIN32)
    snprintf(entry_dir, size, "%s\\%s", base_dir, cache_key);
#else
    snprintf(entry_dir, size, "%s/%s", base_dir, cache_key);
#endif

    return dlx_create_directory_recursive(entry_dir);
}

/**
 * Escape a string for JSON output.
 * Handles quotes, backslashes, and control characters.
 */
static void json_escape_string(FILE *f, const char *str) {
    for (const char *p = str; *p; p++) {
        switch (*p) {
            case '"':
                fprintf(f, "\\\"");
                break;
            case '\\':
                fprintf(f, "\\\\");
                break;
            case '\b':
                fprintf(f, "\\b");
                break;
            case '\f':
                fprintf(f, "\\f");
                break;
            case '\n':
                fprintf(f, "\\n");
                break;
            case '\r':
                fprintf(f, "\\r");
                break;
            case '\t':
                fprintf(f, "\\t");
                break;
            default:
                if (*p < 32) {
                    fprintf(f, "\\u%04x", (unsigned char)*p);
                } else {
                    fputc(*p, f);
                }
                break;
        }
    }
}

/**
 * Write .dlx-metadata.json file.
 * Matches unified DlxMetadata schema from socket-lib.
 * Reference: https://github.com/SocketDev/socket-lib/blob/v4.4.0/src/dlx-binary.ts#L162
 */
static int dlx_write_metadata(const char *entry_dir, const char *cache_key,
                               const char *exe_path, const char *checksum,
                               const char *compression_algorithm,
                               uint64_t size, uint64_t compressed_size) {
    char metadata_path[1024];
#if defined(_WIN32)
    snprintf(metadata_path, sizeof(metadata_path), "%s\\.dlx-metadata.json", entry_dir);
#else
    snprintf(metadata_path, sizeof(metadata_path), "%s/.dlx-metadata.json", entry_dir);
#endif

    FILE *f = fopen(metadata_path, "w");
    if (!f) {
        return -1;
    }

    time_t now = time(NULL);
    long long timestamp = (long long)now * 1000;

    double compression_ratio = (double)size / (double)compressed_size;

    fprintf(f, "{\n");
    fprintf(f, "  \"version\": \"1.0.0\",\n");
    fprintf(f, "  \"cache_key\": \"%s\",\n", cache_key);
    fprintf(f, "  \"timestamp\": %lld,\n", timestamp);
    fprintf(f, "  \"checksum\": \"sha512-%s\",\n", checksum);
    fprintf(f, "  \"checksum_algorithm\": \"sha512\",\n");
    fprintf(f, "  \"platform\": \"%s\",\n", dlx_get_platform());
    fprintf(f, "  \"arch\": \"%s\",\n", dlx_get_arch());

    // Add libc field for Linux systems.
    const char *libc = dlx_get_libc();
    if (libc) {
        fprintf(f, "  \"libc\": \"%s\",\n", libc);
    }

    fprintf(f, "  \"size\": %lu,\n", (unsigned long)size);
    fprintf(f, "  \"source\": {\n");
    fprintf(f, "    \"type\": \"decompression\",\n");
    fprintf(f, "    \"path\": \"");
    json_escape_string(f, exe_path);
    fprintf(f, "\"\n");
    fprintf(f, "  },\n");
    fprintf(f, "  \"extra\": {\n");
    fprintf(f, "    \"compressed_size\": %lu,\n", (unsigned long)compressed_size);
    fprintf(f, "    \"compression_algorithm\": \"%s\",\n", compression_algorithm);
    fprintf(f, "    \"compression_ratio\": %.3f\n", compression_ratio);
    fprintf(f, "  }\n");
    fprintf(f, "}\n");

    fclose(f);
    return 0;
}

/**
 * Check if cached binary exists and is valid.
 * Returns 0 and fills cached_path if found and valid, -1 otherwise.
 * Respects SOCKET_DLX_DIR and SOCKET_HOME environment variables.
 */
static int dlx_get_cached_binary_path(const char *cache_key, uint64_t expected_size,
                                       char *cached_path, size_t path_size) {
    char base_dir[512];
    if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) == -1) {
        return -1;
    }

#if defined(_WIN32)
    snprintf(cached_path, path_size, "%s\\%s\\node.exe",
             base_dir, cache_key);
#else
    snprintf(cached_path, path_size, "%s/%s/node",
             base_dir, cache_key);
#endif

    // Check if file exists and has correct size.
#if defined(_WIN32)
    WIN32_FILE_ATTRIBUTE_DATA fileInfo;
    if (!GetFileAttributesExA(cached_path, GetFileExInfoStandard, &fileInfo)) {
        return -1;
    }

    ULARGE_INTEGER fileSize;
    fileSize.LowPart = fileInfo.nFileSizeLow;
    fileSize.HighPart = fileInfo.nFileSizeHigh;

    if (fileSize.QuadPart != expected_size) {
        return -1;
    }
#else
    struct stat st;
    if (stat(cached_path, &st) == -1) {
        return -1;
    }

    if ((uint64_t)st.st_size != expected_size) {
        return -1;
    }

    // Check if executable.
    if (access(cached_path, X_OK) == -1) {
        return -1;
    }
#endif

    return 0;
}

/**
 * Get the extracted binary path without validation.
 * Constructs path: <base_dir>/<cache_key>/node (or node.exe on Windows).
 * This is the canonical location where compressed stubs extract to.
 * Does NOT check if file exists or validate size.
 * Returns 0 on success, -1 on error.
 * Respects SOCKET_DLX_DIR and SOCKET_HOME environment variables.
 */
static int dlx_get_extracted_binary_path(const char *cache_key,
                                          char *extracted_path, size_t path_size) {
    char base_dir[512];
    if (dlx_get_cache_base_dir(base_dir, sizeof(base_dir)) == -1) {
        return -1;
    }

#if defined(_WIN32)
    int written = snprintf(extracted_path, path_size, "%s\\%s\\node.exe",
                          base_dir, cache_key);
#else
    int written = snprintf(extracted_path, path_size, "%s/%s/node",
                          base_dir, cache_key);
#endif

    if (written < 0 || (size_t)written >= path_size) {
        return -1;
    }

    return 0;
}

/**
 * Write decompressed binary to cache.
 * Returns 0 on success, -1 on error.
 */
static int dlx_write_to_cache(const char *cache_key, const unsigned char *data,
                               size_t size, uint64_t compressed_size,
                               const char *exe_path, const char *checksum,
                               const char *compression_algorithm) {
    char entry_dir[1024];

    // Create cache directory structure.
    if (dlx_create_cache_entry_dir(cache_key, entry_dir, sizeof(entry_dir)) == -1) {
        return -1;
    }

    // Build binary path.
    char cached_path[1024];
#if defined(_WIN32)
    snprintf(cached_path, sizeof(cached_path), "%s\\node.exe", entry_dir);

    HANDLE hFile = CreateFileA(cached_path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
                               FILE_ATTRIBUTE_NORMAL, NULL);
    if (hFile == INVALID_HANDLE_VALUE) {
        return -1;
    }

    DWORD total_written = 0;
    while (total_written < size) {
        DWORD written;
        if (!WriteFile(hFile, data + total_written, size - total_written, &written, NULL) || written == 0) {
            CloseHandle(hFile);
            DeleteFileA(cached_path);
            return -1;
        }
        total_written += written;
    }

    CloseHandle(hFile);
#else
    snprintf(cached_path, sizeof(cached_path), "%s/node", entry_dir);

    int fd = open(cached_path, O_WRONLY | O_CREAT | O_TRUNC, 0755);
    if (fd == -1) {
        return -1;
    }

    ssize_t total_written = 0;
    while (total_written < (ssize_t)size) {
        ssize_t n = write(fd, data + total_written, size - total_written);
        if (n <= 0) {
            close(fd);
            unlink(cached_path);
            return -1;
        }
        total_written += n;
    }

    close(fd);
#endif

    // Write metadata.
    if (dlx_write_metadata(entry_dir, cache_key, exe_path, checksum,
                           compression_algorithm, size, compressed_size) == -1) {
#if defined(_WIN32)
        DeleteFileA(cached_path);
#else
        unlink(cached_path);
#endif
        return -1;
    }

    return 0;
}

#endif // DLX_CACHE_COMMON_H
