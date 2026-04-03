/**
 * socket_cache.h - Minimal cacache-compatible cache reader/writer
 *
 * Implements the npm cacache on-disk format for content-addressed caching.
 * Compatible with cacache v19+ (index-v5, content-v2).
 *
 * On-disk layout:
 *   {cache_dir}/index-v5/{sha256(key)[0:2]}/{sha256(key)[2:4]}/{sha256(key)[4:]}
 *     - Each line: {sha1(json)}\t{json}\n
 *   {cache_dir}/content-v2/sha512/{sha512(hex)[0:2]}/{sha512(hex)[2:4]}/{sha512(hex)[4:]}
 *     - Raw bytes
 *
 * Key convention: socket-btm:{type}:{identifier}
 *
 * Default cache dir: $SOCKET_CACACHE_DIR or $SOCKET_HOME/_cacache or ~/.socket/_cacache
 *
 * Platform crypto:
 *   - macOS: CommonCrypto (CC_SHA1, CC_SHA256, CC_SHA512)
 *   - Linux: OpenSSL (SHA1, SHA256, SHA512)
 *   - Windows: CryptoAPI (CALG_SHA1, CALG_SHA_256, CALG_SHA_512)
 *
 * Usage:
 *   #include "socketsecurity/build-infra/socket_cache.h"
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

#ifndef SOCKET_CACHE_H
#define SOCKET_CACHE_H

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
    *out_data = (uint8_t *)malloc((size_t)sz);
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

static int write_file_atomically(const char *path, const uint8_t *data, size_t len, int mode) {
    char tmp_path[1024];
    snprintf(tmp_path, sizeof(tmp_path), "%s.tmp.%d", path, (int)getpid());
    FILE *f = fopen(tmp_path, "wb");
    if (!f) return -1;
    size_t written = fwrite(data, 1, len, f);
    fclose(f);
    if (written != len) { unlink(tmp_path); return -1; }
    chmod(tmp_path, (mode_t)mode);
    if (rename(tmp_path, path) != 0) { unlink(tmp_path); return -1; }
    return 0;
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

#if defined(_WIN32)
    char home[512];
    if (SHGetFolderPathA(NULL, CSIDL_PROFILE, NULL, 0, home) != S_OK)
        return -1;
    int n = snprintf(buf, size, "%s\\.socket\\_cacache", home);
#else
    const char *home = getenv("HOME");
    if (!home) {
#if defined(__linux__) || defined(__APPLE__)
        struct passwd *pw = getpwuid(getuid());
        if (!pw || !pw->pw_dir) return -1;
        home = pw->pw_dir;
#else
        return -1;
#endif
    }
    int n = snprintf(buf, size, "%s/.socket/_cacache", home);
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

    char json[2048];
    int jlen;
    if (metadata && metadata[0] != '\0') {
        jlen = snprintf(json, sizeof(json),
            "{\"key\":\"%s\",\"integrity\":\"%s\",\"time\":%lld,\"size\":%lu,\"metadata\":%s}",
            key, integrity, now_ms, (unsigned long)data_size, metadata);
    } else {
        jlen = snprintf(json, sizeof(json),
            "{\"key\":\"%s\",\"integrity\":\"%s\",\"time\":%lld,\"size\":%lu,\"metadata\":{}}",
            key, integrity, now_ms, (unsigned long)data_size);
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
SCACHE_UNUSED
static int scache_parse_last_integrity(const char *index_data, size_t index_len,
                                        char *integrity_out, size_t integrity_size) {
    const char *last_tab = NULL;
    const char *p = index_data + index_len;

    while (p > index_data) {
        p--;
        if (*p == '\t') {
            last_tab = p;
            break;
        }
    }
    if (!last_tab) return -1;

    const char *json_start = last_tab + 1;
    const char *needle = "\"integrity\":\"";
    const char *found = strstr(json_start, needle);
    if (!found) return -1;

    const char *val = found + strlen(needle);
    const char *end = strchr(val, '"');
    if (!end) return -1;

    size_t vlen = (size_t)(end - val);
    if (vlen >= integrity_size) return -1;

    memcpy(integrity_out, val, vlen);
    integrity_out[vlen] = '\0';
    return 0;
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
 * Remove a cache entry by key.
 *
 * Removes the index file. Content files are left for garbage collection
 * (matching cacache behavior -- content is content-addressed and may be
 * shared by multiple keys).
 *
 * @param key Cache key string
 * @return 0 on success, -1 on error
 */
SCACHE_UNUSED
static int cacache_remove(const char *key) {
    char cache_dir[512];
    if (socket_cacache_dir(cache_dir, sizeof(cache_dir)) != 0)
        return -1;

    char index_path[1024];
    if (scache_index_path(cache_dir, key, index_path, sizeof(index_path)) != 0)
        return -1;

#if defined(_WIN32)
    if (!DeleteFileA(index_path) && GetLastError() != ERROR_FILE_NOT_FOUND)
        return -1;
#else
    if (unlink(index_path) != 0 && errno != ENOENT)
        return -1;
#endif

    return 0;
}

#ifdef __cplusplus
}
#endif

#endif /* SOCKET_CACHE_H */
