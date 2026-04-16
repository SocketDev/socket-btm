/**
 * socket_cacache.h — cacache-compatible content-addressable cache reader/writer.
 *
 * Implements the npm cacache on-disk format (index-v5, content-v2).
 *
 * 15 security and correctness checks:
 * Integrity on read    — SHA-512 recomputed + memcmp on every cacache_get
 * Symlink protection   — lstat from .socket onward via scache_verify_no_symlinks()
 * Windows skip         — symlink check skipped on _WIN32
 * Key escaping (put)   — scache_json_escape() on key + integrity
 * Key escaping (del)   — scache_json_escape() on delete path too
 * Staging dir          — atomic writes via ~/.socket/_tmp/ (same mount)
 * Rename fallback      — direct write if rename fails (EXDEV)
 * Dir creation         — create_parent_directories on first write
 * Soft delete          — append null integrity, not file deletion
 * Metadata validation  — always {} in delete entries
 * Error codes          — returns -1 on all failures
 * Env var priority     — SOCKET_CACACHE_DIR > SOCKET_HOME > HOME > USERPROFILE > tmpdir
 * Corrupt index lines  — walk lines in reverse, SHA-1 verify, skip bad lines
 * Empty data (0 byte)  — malloc(max(sz,1)) for zero-length content
 * Binary with NUL      — length-delimited fwrite/fread, no strlen
 *
 * Key convention: socket-btm:{type}:{identifier}
 * Default cache dir: $SOCKET_CACACHE_DIR or $SOCKET_HOME/_cacache or ~/.socket/_cacache
 *
 * Platform crypto:
 *   - macOS: CommonCrypto (CC_SHA1, CC_SHA256, CC_SHA512)
 *   - Linux: OpenSSL (SHA1, SHA256, SHA512)
 *   - Windows: CryptoAPI (CALG_SHA1, CALG_SHA_256, CALG_SHA_512)
 *
 * Usage:
 *   #include "socketsecurity/build-infra/socket_cacache.h"
 *
 *   char cache_dir[512];
 *   socket_cacache_dir(cache_dir, sizeof(cache_dir));
 *
 *   uint8_t *data; size_t len;
 *   if (cacache_get("socket-btm:http:abc123", &data, &len) == 0) {
 *       // use data
 *       free(data);
 *   }
 *
 *   cacache_put("socket-btm:http:abc123", my_data, my_len, "");
 *   cacache_remove("socket-btm:http:abc123");
 */

#ifndef SOCKET_CACACHE_H
#define SOCKET_CACACHE_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <sys/stat.h>
#include <errno.h>

#if !defined(_WIN32)
    #include <unistd.h>
#endif

/* Self-contained file I/O helpers (no external deps). */

static int file_io_read(const char *path, uint8_t **out_data, size_t *out_len) {
    FILE *f = fopen(path, "rb");
    if (!f) return -1;
    fseek(f, 0, SEEK_END);
    long sz = ftell(f);
    if (sz < 0) { fclose(f); return -1; }
    fseek(f, 0, SEEK_SET);
    /* malloc(0) is implementation-defined — ensure at least 1 byte */
    *out_data = (uint8_t *)malloc(sz > 0 ? (size_t)sz : 1);
    if (!*out_data) { fclose(f); return -1; }
    *out_len = fread(*out_data, 1, (size_t)sz, f);
    fclose(f);
    return (*out_len == (size_t)sz) ? 0 : -1;
}

static int create_parent_directories(const char *filepath) {
    char tmp[1024];
    snprintf(tmp, sizeof(tmp), "%s", filepath);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = '\0';
            mkdir(tmp, 0755);
            *p = '/';
        }
    }
    return 0;
}

/* Forward declaration — defined below after crypto helpers */
static int socket_cacache_dir(char *buf, size_t size);

/**
 * Get staging dir for atomic writes: ~/.socket/_tmp/
 * Same mount as _cacache — prevents EXDEV on cross-device rename.
 */
static int scache_staging_dir(char *buf, size_t size) {
    char cache_dir[512];
    if (socket_cacache_dir(cache_dir, sizeof(cache_dir)) != 0)
        return -1;
    /* Go up from _cacache to .socket, then use _tmp */
    char *last_sep = strrchr(cache_dir, '/');
#if defined(_WIN32)
    char *last_sep_win = strrchr(cache_dir, '\\');
    if (last_sep_win > last_sep) last_sep = last_sep_win;
#endif
    if (!last_sep) return -1;
    *last_sep = '\0';
    int n = snprintf(buf, size, "%s/_tmp", cache_dir);
    if (n < 0 || (size_t)n >= size) return -1;
    return 0;
}

static int write_file_atomically(const char *path, const uint8_t *data, size_t len, int mode) {
    /* Stage in ~/.socket/_tmp/ (same mount) then rename into place */
    char staging[512];
    char tmp_path[1024];
    if (scache_staging_dir(staging, sizeof(staging)) == 0) {
        create_parent_directories(staging);
        mkdir(staging, 0755);
        snprintf(tmp_path, sizeof(tmp_path), "%s/tmp-%d-%lld", staging, (int)getpid(), (long long)time(NULL));
    } else {
        /* Fallback: same-dir staging */
        snprintf(tmp_path, sizeof(tmp_path), "%s.tmp.%d", path, (int)getpid());
    }
    FILE *f = fopen(tmp_path, "wb");
    if (!f) return -1;
    size_t written = fwrite(data, 1, len, f);
    fclose(f);
    if (written != len) { unlink(tmp_path); return -1; }
    chmod(tmp_path, (mode_t)mode);
    if (rename(tmp_path, path) != 0) {
        /* Rename failed (EXDEV?) — fall back to direct write */
        unlink(tmp_path);
        f = fopen(path, "wb");
        if (!f) return -1;
        written = fwrite(data, 1, len, f);
        fclose(f);
        if (written != len) return -1;
        chmod(path, (mode_t)mode);
    }
    return 0;
}

/**
 * Escape a string for safe JSON embedding.
 * Escapes: \ → \\, " → \", control chars → \uXXXX.
 * Returns bytes written (excluding null terminator), or -1 if buffer too small.
 */
static int scache_json_escape(const char *src, char *dst, size_t dst_size) {
    size_t di = 0;
    for (size_t si = 0; src[si] != '\0'; si++) {
        char c = src[si];
        if (c == '"' || c == '\\') {
            if (di + 2 >= dst_size) return -1;
            dst[di++] = '\\';
            dst[di++] = c;
        } else if ((unsigned char)c < 0x20) {
            if (di + 6 >= dst_size) return -1;
            di += snprintf(dst + di, dst_size - di, "\\u%04x", (unsigned char)c);
        } else {
            if (di + 1 >= dst_size) return -1;
            dst[di++] = c;
        }
    }
    if (di >= dst_size) return -1;
    dst[di] = '\0';
    return (int)di;
}

/**
 * Verify the .socket directory and below has no symlinks.
 * System paths (like /tmp → /private/tmp on macOS) are trusted.
 * Returns 0 if safe, -1 if symlink detected or error.
 */
static int scache_verify_no_symlinks(const char *path) {
#if defined(_WIN32)
    (void)path;
    return 0;
#else
    /* Find .socket in path — only check from there down */
    const char *socket_pos = strstr(path, ".socket");
    if (!socket_pos) return 0; /* Custom override — skip check */

    /* Copy prefix (trusted system path) */
    char check[1024];
    size_t prefix_len = (size_t)(socket_pos - path);
    if (prefix_len >= sizeof(check)) return -1;
    memcpy(check, path, prefix_len);
    check[prefix_len] = '\0';

    /* Check each component from .socket onward */
    const char *p = socket_pos;
    while (*p) {
        const char *slash = strchr(p, '/');
        size_t seg_len = slash ? (size_t)(slash - p) : strlen(p);
        if (seg_len == 0) { p++; continue; }

        size_t cur_len = strlen(check);
        if (cur_len + 1 + seg_len >= sizeof(check)) return -1;
        if (cur_len > 0 && check[cur_len - 1] != '/') {
            check[cur_len++] = '/';
            check[cur_len] = '\0';
        }
        memcpy(check + cur_len, p, seg_len);
        check[cur_len + seg_len] = '\0';

        struct stat st;
        if (lstat(check, &st) == 0) {
            if (S_ISLNK(st.st_mode)) return -1;
        }
        p += seg_len;
        if (slash) p++;
    }
    return 0;
#endif
}

/* End self-contained helpers */

#if defined(__APPLE__)
    #include <CommonCrypto/CommonDigest.h>
    #include <fcntl.h>
    #include <pwd.h>
    #include <unistd.h>
#elif defined(__linux__)
    #include <openssl/sha.h>
    #include <fcntl.h>
    #include <pwd.h>
    #include <unistd.h>
#elif defined(_WIN32)
    #include <windows.h>
    #include <shlobj.h>
    #include <wincrypt.h>
#endif

#ifdef __cplusplus
extern "C" {
#endif

#if defined(__GNUC__) || __has_attribute(unused)
#  define SCACHE_UNUSED __attribute__((unused))
#else
#  define SCACHE_UNUSED
#endif

#define SCACHE_SHA1_LEN   20
#define SCACHE_SHA256_LEN 32
#define SCACHE_SHA512_LEN 64

/* ========================================================================
 * Platform crypto primitives
 * ======================================================================== */

static int scache_sha1(const unsigned char *data, size_t len, unsigned char *out) {
#if defined(__APPLE__)
    CC_SHA1(data, (CC_LONG)len, out);
    return 0;
#elif defined(__linux__)
    SHA1(data, len, out);
    return 0;
#elif defined(_WIN32)
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    if (!CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
        return -1;
    if (!CryptCreateHash(hProv, CALG_SHA1, 0, 0, &hHash)) {
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    if (!CryptHashData(hHash, data, (DWORD)len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    DWORD hash_len = SCACHE_SHA1_LEN;
    if (!CryptGetHashParam(hHash, HP_HASHVAL, out, &hash_len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    CryptDestroyHash(hHash);
    CryptReleaseContext(hProv, 0);
    return 0;
#else
    (void)data; (void)len; (void)out;
    return -1;
#endif
}

static int scache_sha256(const unsigned char *data, size_t len, unsigned char *out) {
#if defined(__APPLE__)
    CC_SHA256(data, (CC_LONG)len, out);
    return 0;
#elif defined(__linux__)
    SHA256(data, len, out);
    return 0;
#elif defined(_WIN32)
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    if (!CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
        return -1;
    if (!CryptCreateHash(hProv, CALG_SHA_256, 0, 0, &hHash)) {
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    if (!CryptHashData(hHash, data, (DWORD)len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    DWORD hash_len = SCACHE_SHA256_LEN;
    if (!CryptGetHashParam(hHash, HP_HASHVAL, out, &hash_len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    CryptDestroyHash(hHash);
    CryptReleaseContext(hProv, 0);
    return 0;
#else
    (void)data; (void)len; (void)out;
    return -1;
#endif
}

static int scache_sha512(const unsigned char *data, size_t len, unsigned char *out) {
#if defined(__APPLE__)
    CC_SHA512(data, (CC_LONG)len, out);
    return 0;
#elif defined(__linux__)
    SHA512(data, len, out);
    return 0;
#elif defined(_WIN32)
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;
    if (!CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT))
        return -1;
    if (!CryptCreateHash(hProv, CALG_SHA_512, 0, 0, &hHash)) {
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    if (!CryptHashData(hHash, data, (DWORD)len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    DWORD hash_len = SCACHE_SHA512_LEN;
    if (!CryptGetHashParam(hHash, HP_HASHVAL, out, &hash_len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }
    CryptDestroyHash(hHash);
    CryptReleaseContext(hProv, 0);
    return 0;
#else
    (void)data; (void)len; (void)out;
    return -1;
#endif
}

/* ========================================================================
 * Hex / Base64 encoding
 * ======================================================================== */

static void scache_hex(const unsigned char *data, size_t len, char *out) {
    for (size_t i = 0; i < len; i++) {
        snprintf(out + (i * 2), 3, "%02x", data[i]);
    }
    out[len * 2] = '\0';
}

static const char scache_b64_table[] =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/**
 * Base64-encode data into output buffer.
 * Output must be at least ((len + 2) / 3 * 4 + 1) bytes.
 */
static void scache_base64(const unsigned char *data, size_t len, char *out) {
    size_t i, j;
    for (i = 0, j = 0; i + 2 < len; i += 3) {
        out[j++] = scache_b64_table[(data[i] >> 2) & 0x3F];
        out[j++] = scache_b64_table[((data[i] & 0x03) << 4) | ((data[i+1] >> 4) & 0x0F)];
        out[j++] = scache_b64_table[((data[i+1] & 0x0F) << 2) | ((data[i+2] >> 6) & 0x03)];
        out[j++] = scache_b64_table[data[i+2] & 0x3F];
    }
    if (i < len) {
        out[j++] = scache_b64_table[(data[i] >> 2) & 0x3F];
        if (i + 1 < len) {
            out[j++] = scache_b64_table[((data[i] & 0x03) << 4) | ((data[i+1] >> 4) & 0x0F)];
            out[j++] = scache_b64_table[(data[i+1] & 0x0F) << 2];
        } else {
            out[j++] = scache_b64_table[(data[i] & 0x03) << 4];
            out[j++] = '=';
        }
        out[j++] = '=';
    }
    out[j] = '\0';
}

/**
 * Compute SRI integrity string: "sha512-{base64(sha512(data))}".
 * Output must be at least 96 bytes (7 prefix + 88 base64 + 1 null).
 */
SCACHE_UNUSED
static int scache_integrity(const unsigned char *data, size_t len, char *out) {
    unsigned char hash[SCACHE_SHA512_LEN];
    if (scache_sha512(data, len, hash) != 0)
        return -1;
    memcpy(out, "sha512-", 7);
    scache_base64(hash, SCACHE_SHA512_LEN, out + 7);
    return 0;
}

/* ========================================================================
 * Cache directory resolution
 * ======================================================================== */

/**
 * Get the cacache directory path.
 *
 * Priority:
 *   1. SOCKET_CACACHE_DIR (full override)
 *   2. SOCKET_HOME/_cacache
 *   3. ~/.socket/_cacache
 *
 * Returns 0 on success, -1 on error.
 */
SCACHE_UNUSED
static int socket_cacache_dir(char *buf, size_t size) {
    const char *env;

    env = getenv("SOCKET_CACACHE_DIR");
    if (env && env[0] != '\0') {
        size_t len = strlen(env);
        if (len >= size) return -1;
        memcpy(buf, env, len);
        buf[len] = '\0';
        return 0;
    }

    env = getenv("SOCKET_HOME");
    if (env && env[0] != '\0') {
#if defined(_WIN32)
        int n = snprintf(buf, size, "%s\\_cacache", env);
#else
        int n = snprintf(buf, size, "%s/_cacache", env);
#endif
        if (n < 0 || (size_t)n >= size) return -1;
        return 0;
    }

    /* HOME (Unix) / USERPROFILE (Windows) — matches @socketsecurity/lib */
    const char *home = getenv("HOME");
    if (!home) home = getenv("USERPROFILE");
#if !defined(_WIN32)
    if (!home) {
        struct passwd *pw = getpwuid(getuid());
        if (pw && pw->pw_dir) home = pw->pw_dir;
    }
#endif
    if (home) {
#if defined(_WIN32)
        int n = snprintf(buf, size, "%s\\.socket\\_cacache", home);
#else
        int n = snprintf(buf, size, "%s/.socket/_cacache", home);
#endif
        if (n >= 0 && (size_t)n < size) return 0;
    }
    /* tmpdir fallback */
#if defined(_WIN32)
    const char *tmp = getenv("TEMP");
    if (!tmp) tmp = getenv("TMP");
    if (!tmp) tmp = "C:\\Temp";
    int n = snprintf(buf, size, "%s\\.socket\\_cacache", tmp);
#else
    int n = snprintf(buf, size, "/tmp/.socket/_cacache");
#endif
    if (n < 0 || (size_t)n >= size) return -1;
    return 0;
}

/* ========================================================================
 * Index path computation
 *
 * cacache index path: {cache}/index-v5/{sha256(key)[0:2]}/{[2:4]}/{[4:]}
 * ======================================================================== */

SCACHE_UNUSED
static int scache_index_path(const char *cache_dir, const char *key,
                              char *out, size_t out_size) {
    unsigned char hash[SCACHE_SHA256_LEN];
    char hex[SCACHE_SHA256_LEN * 2 + 1];

    if (scache_sha256((const unsigned char *)key, strlen(key), hash) != 0)
        return -1;

    scache_hex(hash, SCACHE_SHA256_LEN, hex);

#if defined(_WIN32)
    int n = snprintf(out, out_size, "%s\\index-v5\\%.2s\\%.2s\\%s",
                     cache_dir, hex, hex + 2, hex + 4);
#else
    int n = snprintf(out, out_size, "%s/index-v5/%.2s/%.2s/%s",
                     cache_dir, hex, hex + 2, hex + 4);
#endif
    if (n < 0 || (size_t)n >= out_size) return -1;
    return 0;
}

/* ========================================================================
 * Content path computation
 *
 * cacache content path: {cache}/content-v2/sha512/{sha512hex[0:2]}/{[2:4]}/{[4:]}
 * The sha512hex is the hex encoding of the raw sha512 hash of the data.
 * ======================================================================== */

SCACHE_UNUSED
static int scache_content_path_from_hash(const char *cache_dir,
                                          const unsigned char *sha512_hash,
                                          char *out, size_t out_size) {
    char hex[SCACHE_SHA512_LEN * 2 + 1];
    scache_hex(sha512_hash, SCACHE_SHA512_LEN, hex);

#if defined(_WIN32)
    int n = snprintf(out, out_size, "%s\\content-v2\\sha512\\%.2s\\%.2s\\%s",
                     cache_dir, hex, hex + 2, hex + 4);
#else
    int n = snprintf(out, out_size, "%s/content-v2/sha512/%.2s/%.2s/%s",
                     cache_dir, hex, hex + 2, hex + 4);
#endif
    if (n < 0 || (size_t)n >= out_size) return -1;
    return 0;
}

SCACHE_UNUSED
static int scache_content_path(const char *cache_dir,
                                const unsigned char *data, size_t data_len,
                                char *out, size_t out_size) {
    unsigned char hash[SCACHE_SHA512_LEN];
    if (scache_sha512(data, data_len, hash) != 0)
        return -1;
    return scache_content_path_from_hash(cache_dir, hash, out, out_size);
}

/* ========================================================================
 * Index entry parsing / writing
 *
 * Index file format (one entry per line):
 *   {sha1(json_line)}\t{json_line}\n
 *
 * json_line fields: key, integrity, time, size, metadata
 * ======================================================================== */

/**
 * Build a cacache index entry line.
 * Format: {sha1hex}\t{json}\n
 *
 * Returns total length written (excluding null terminator), or -1 on error.
 */
SCACHE_UNUSED
static int scache_build_index_entry(const char *key, const char *integrity,
                                     size_t data_size, const char *metadata,
                                     char *out, size_t out_size) {
    long long now_ms = (long long)time(NULL) * 1000;

    /* Escape key and integrity for safe JSON embedding */
    char esc_key[2048];
    if (scache_json_escape(key, esc_key, sizeof(esc_key)) < 0) return -1;
    char esc_integrity[256];
    if (scache_json_escape(integrity, esc_integrity, sizeof(esc_integrity)) < 0) return -1;

    char json[4096];
    int jlen;
    if (metadata && metadata[0] != '\0') {
        jlen = snprintf(json, sizeof(json),
            "{\"key\":\"%s\",\"integrity\":\"%s\",\"time\":%lld,\"size\":%lu,\"metadata\":%s}",
            esc_key, esc_integrity, now_ms, (unsigned long)data_size, metadata);
    } else {
        jlen = snprintf(json, sizeof(json),
            "{\"key\":\"%s\",\"integrity\":\"%s\",\"time\":%lld,\"size\":%lu,\"metadata\":{}}",
            esc_key, esc_integrity, now_ms, (unsigned long)data_size);
    }
    if (jlen < 0 || (size_t)jlen >= sizeof(json))
        return -1;

    unsigned char sha1_hash[SCACHE_SHA1_LEN];
    if (scache_sha1((const unsigned char *)json, (size_t)jlen, sha1_hash) != 0)
        return -1;

    char sha1_hex[SCACHE_SHA1_LEN * 2 + 1];
    scache_hex(sha1_hash, SCACHE_SHA1_LEN, sha1_hex);

    int total = snprintf(out, out_size, "%s\t%s\n", sha1_hex, json);
    if (total < 0 || (size_t)total >= out_size)
        return -1;

    return total;
}

/**
 * Parse the last valid index entry from an index file to extract the integrity string.
 * cacache uses the last entry as the authoritative one.
 * Returns 0 on success and fills integrity_out (must be >= 128 bytes).
 */
/**
 * Parse the last valid integrity from an index file.
 * Walks lines in REVERSE, verifies SHA-1 line hash, skips corrupt lines.
 * This matches Rust's read_index_entry behavior — corrupt trailing lines
 * don't block valid earlier entries.
 */
SCACHE_UNUSED
static int scache_parse_last_integrity(const char *index_data, size_t index_len,
                                        char *integrity_out, size_t integrity_size) {
    /* Walk from end to find line boundaries */
    const char *end = index_data + index_len;
    const char *line_end = end;

    while (line_end > index_data) {
        /* Find start of current line */
        const char *line_start = line_end - 1;
        while (line_start > index_data && *(line_start - 1) != '\n') {
            line_start--;
        }

        size_t line_len = (size_t)(line_end - line_start);
        /* Skip empty lines and trailing newlines */
        while (line_len > 0 && (line_start[line_len - 1] == '\n' || line_start[line_len - 1] == '\r')) {
            line_len--;
        }
        if (line_len == 0) {
            line_end = line_start;
            continue;
        }

        /* Find tab separator: {sha1hex}\t{json} */
        const char *tab = (const char *)memchr(line_start, '\t', line_len);
        if (!tab || (size_t)(tab - line_start) != 40) {
            /* No tab or wrong hash length — corrupt line, skip */
            line_end = line_start;
            continue;
        }

        /* Verify SHA-1 of JSON portion */
        const char *json_start = tab + 1;
        size_t json_len = line_len - (size_t)(json_start - line_start);

        unsigned char sha1_hash[SCACHE_SHA1_LEN];
        scache_sha1((const unsigned char *)json_start, json_len, sha1_hash);
        char sha1_hex[41];
        scache_hex(sha1_hash, SCACHE_SHA1_LEN, sha1_hex);

        /* Compare computed hash with line prefix */
        if (memcmp(sha1_hex, line_start, 40) != 0) {
            /* SHA-1 mismatch — corrupt line, skip */
            line_end = line_start;
            continue;
        }

        /* Valid line! Extract integrity value */
        /* Check for null integrity (soft delete) */
        if (strstr(json_start, "\"integrity\":null") != NULL) {
            return -1; /* Key was deleted */
        }

        const char *needle = "\"integrity\":\"";
        const char *found = strstr(json_start, needle);
        if (!found) {
            line_end = line_start;
            continue;
        }

        const char *val = found + strlen(needle);
        const char *val_end = strchr(val, '"');
        if (!val_end) {
            line_end = line_start;
            continue;
        }

        size_t vlen = (size_t)(val_end - val);
        if (vlen >= integrity_size) {
            line_end = line_start;
            continue;
        }

        memcpy(integrity_out, val, vlen);
        integrity_out[vlen] = '\0';
        return 0;
    }

    return -1; /* No valid entry found */
}

/**
 * Parse an SRI integrity string to extract the raw sha512 hash.
 * Input: "sha512-{base64}" -> 64-byte raw hash.
 * Returns 0 on success.
 */
SCACHE_UNUSED
static int scache_parse_integrity_hash(const char *integrity, unsigned char *hash_out) {
    if (strncmp(integrity, "sha512-", 7) != 0)
        return -1;

    const char *b64 = integrity + 7;
    size_t b64_len = strlen(b64);

    /* Decode base64 inline. */
    static const unsigned char b64_decode[256] = {
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255, 62,255,255,255, 63,
         52, 53, 54, 55, 56, 57, 58, 59, 60, 61,255,255,255,  0,255,255,
        255,  0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14,
         15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,255,255,255,255,255,
        255, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40,
         41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
        255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,255,
    };

    size_t out_idx = 0;
    size_t i = 0;
    while (i + 3 < b64_len) {
        unsigned char a = b64_decode[(unsigned char)b64[i]];
        unsigned char b = b64_decode[(unsigned char)b64[i+1]];
        unsigned char c = b64_decode[(unsigned char)b64[i+2]];
        unsigned char d = b64_decode[(unsigned char)b64[i+3]];
        if (a == 255 || b == 255) break;

        if (out_idx < SCACHE_SHA512_LEN)
            hash_out[out_idx++] = (a << 2) | (b >> 4);
        if (c != 255 && b64[i+2] != '=' && out_idx < SCACHE_SHA512_LEN)
            hash_out[out_idx++] = (b << 4) | (c >> 2);
        if (d != 255 && b64[i+3] != '=' && out_idx < SCACHE_SHA512_LEN)
            hash_out[out_idx++] = (c << 6) | d;

        i += 4;
    }

    if (out_idx < SCACHE_SHA512_LEN)
        return -1;

    return 0;
}

/* ========================================================================
 * Public API
 * ======================================================================== */

/**
 * Get cached data by key.
 *
 * Reads the index entry for the key, extracts the integrity hash, locates
 * the content file, reads it, and verifies integrity.
 *
 * @param key Cache key string
 * @param data_out Pointer to receive allocated buffer (caller must free)
 * @param size_out Pointer to receive data size
 * @return 0 on success (cache hit), -1 on miss or error
 */
SCACHE_UNUSED
static int cacache_get(const char *key, uint8_t **data_out, size_t *size_out) {
    char cache_dir[512];
    if (socket_cacache_dir(cache_dir, sizeof(cache_dir)) != 0)
        return -1;
    if (scache_verify_no_symlinks(cache_dir) != 0)
        return -1;

    char index_path[1024];
    if (scache_index_path(cache_dir, key, index_path, sizeof(index_path)) != 0)
        return -1;

    uint8_t *index_data = NULL;
    size_t index_len = 0;
    if (file_io_read(index_path, &index_data, &index_len) != 0)
        return -1;

    char integrity[128];
    if (scache_parse_last_integrity((const char *)index_data, index_len,
                                     integrity, sizeof(integrity)) != 0) {
        free(index_data);
        return -1;
    }
    free(index_data);

    unsigned char content_hash[SCACHE_SHA512_LEN];
    if (scache_parse_integrity_hash(integrity, content_hash) != 0)
        return -1;

    char content_path[1024];
    if (scache_content_path_from_hash(cache_dir, content_hash,
                                       content_path, sizeof(content_path)) != 0)
        return -1;

    uint8_t *content_data = NULL;
    size_t content_len = 0;
    if (file_io_read(content_path, &content_data, &content_len) != 0)
        return -1;

    /* Verify integrity. */
    unsigned char verify_hash[SCACHE_SHA512_LEN];
    if (scache_sha512(content_data, content_len, verify_hash) != 0) {
        free(content_data);
        return -1;
    }
    if (memcmp(content_hash, verify_hash, SCACHE_SHA512_LEN) != 0) {
        free(content_data);
        return -1;
    }

    *data_out = content_data;
    *size_out = content_len;
    return 0;
}

/**
 * Store data in the cache.
 *
 * Writes the content file and appends an index entry.
 *
 * @param key Cache key string
 * @param data Data to cache
 * @param data_len Size of data in bytes
 * @param metadata JSON metadata string (pass "" or NULL for empty)
 * @return 0 on success, -1 on error
 */
SCACHE_UNUSED
static int cacache_put(const char *key, const uint8_t *data, size_t data_len,
                        const char *metadata) {
    char cache_dir[512];
    if (socket_cacache_dir(cache_dir, sizeof(cache_dir)) != 0)
        return -1;
    if (scache_verify_no_symlinks(cache_dir) != 0)
        return -1;

    /* Compute integrity. */
    char integrity[128];
    if (scache_integrity(data, data_len, integrity) != 0)
        return -1;

    /* Write content file. */
    char content_path[1024];
    if (scache_content_path(cache_dir, data, data_len,
                             content_path, sizeof(content_path)) != 0)
        return -1;

    if (create_parent_directories(content_path) != 0)
        return -1;

    if (write_file_atomically(content_path, data, data_len, 0644) != 0)
        return -1;

    /* Build index entry. */
    char entry[4096];
    int entry_len = scache_build_index_entry(key, integrity, data_len,
                                              metadata, entry, sizeof(entry));
    if (entry_len < 0) {
#if defined(_WIN32)
        DeleteFileA(content_path);
#else
        unlink(content_path);
#endif
        return -1;
    }

    /* Write index file (append). */
    char index_path[1024];
    if (scache_index_path(cache_dir, key, index_path, sizeof(index_path)) != 0)
        return -1;

    if (create_parent_directories(index_path) != 0)
        return -1;

    FILE *fp = fopen(index_path, "ab");
    if (!fp) {
        /* Index dir may not exist yet; try creating and retry. */
        if (create_parent_directories(index_path) == 0) {
            fp = fopen(index_path, "ab");
        }
        if (!fp) return -1;
    }

    size_t written = fwrite(entry, 1, (size_t)entry_len, fp);
    fclose(fp);

    if (written != (size_t)entry_len)
        return -1;

    return 0;
}

/**
 * Remove a cache entry by key (soft delete).
 *
 * Appends an entry with integrity=null to the index file, which shadows
 * all previous entries for this key. This matches cacache's soft-delete
 * behavior — content files are left for garbage collection.
 *
 * @param key Cache key string
 * @return 0 on success, -1 on error
 */
SCACHE_UNUSED
static int cacache_remove(const char *key) {
    char cache_dir[512];
    if (socket_cacache_dir(cache_dir, sizeof(cache_dir)) != 0)
        return -1;
    if (scache_verify_no_symlinks(cache_dir) != 0)
        return -1;

    char index_path[1024];
    if (scache_index_path(cache_dir, key, index_path, sizeof(index_path)) != 0)
        return -1;

    /* Build JSON entry with integrity:null (soft delete) */
    long long now_ms = (long long)time(NULL) * 1000;
    char escaped_key[2048];
    if (scache_json_escape(key, escaped_key, sizeof(escaped_key)) < 0)
        return -1;
    char json_entry[4096];
    snprintf(json_entry, sizeof(json_entry),
        "{\"key\":\"%s\",\"integrity\":null,\"time\":%lld,\"size\":0,\"metadata\":{}}", escaped_key, now_ms);

    /* SHA-1 of the JSON entry for the line hash */
    uint8_t sha1_hash[20];
    scache_sha1((const uint8_t *)json_entry, strlen(json_entry), sha1_hash);
    char sha1_hex[41];
    scache_hex(sha1_hash, 20, sha1_hex);

    /* Append to index file: {sha1}\t{json}\n */
    if (create_parent_directories(index_path) != 0)
        return -1;

    FILE *f = fopen(index_path, "ab");
    if (!f) return -1;
    fprintf(f, "%s\t%s\n", sha1_hex, json_entry);
    fclose(f);

    return 0;
}

#ifdef __cplusplus
}
#endif

#endif /* SOCKET_CACACHE_H */
