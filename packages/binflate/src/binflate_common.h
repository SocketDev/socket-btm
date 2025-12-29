/**
 * Binflate-specific helper functions
 *
 * These functions are used by binflate decompressor tool for calculating
 * cache keys and checksums. The embedded stubs use pre-calculated values
 * to avoid runtime SHA-512 overhead.
 */

#ifndef BINFLATE_COMMON_H
#define BINFLATE_COMMON_H

#include <stdio.h>
#include <string.h>

// Platform-specific includes for SHA-512.
#if defined(__APPLE__)
    #include <CommonCrypto/CommonDigest.h>
    #define SHA512_DIGEST_LEN CC_SHA512_DIGEST_LENGTH
#elif defined(__linux__)
    #include <openssl/sha.h>
    #define SHA512_DIGEST_LEN SHA512_DIGEST_LENGTH
#elif defined(_WIN32)
    #include <windows.h>
    #include <wincrypt.h>
    #define SHA512_DIGEST_LEN 64
#endif

/**
 * Calculate SHA-512 hash (cross-platform).
 */
static int binflate_sha512(const unsigned char *data, size_t len, unsigned char *hash) {
#if defined(__APPLE__)
    CC_SHA512(data, (CC_LONG)len, hash);
    return 0;
#elif defined(__linux__)
    SHA512(data, len, hash);
    return 0;
#elif defined(_WIN32)
    HCRYPTPROV hProv = 0;
    HCRYPTHASH hHash = 0;

    if (!CryptAcquireContext(&hProv, NULL, NULL, PROV_RSA_AES, CRYPT_VERIFYCONTEXT)) {
        return -1;
    }

    if (!CryptCreateHash(hProv, CALG_SHA_512, 0, 0, &hHash)) {
        CryptReleaseContext(hProv, 0);
        return -1;
    }

    if (!CryptHashData(hHash, data, (DWORD)len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }

    DWORD hash_len = SHA512_DIGEST_LEN;
    if (!CryptGetHashParam(hHash, HP_HASHVAL, hash, &hash_len, 0)) {
        CryptDestroyHash(hHash);
        CryptReleaseContext(hProv, 0);
        return -1;
    }

    CryptDestroyHash(hHash);
    CryptReleaseContext(hProv, 0);
    return 0;
#else
    return -1;
#endif
}

/**
 * Calculate SHA-512 hash and return first 16 hex chars (cache key).
 * Matches dlxBinary's generateCacheKey behavior.
 */
static int binflate_calculate_cache_key(const unsigned char *data, size_t len, char *cache_key) {
    unsigned char hash[SHA512_DIGEST_LEN];

    if (binflate_sha512(data, len, hash) != 0) {
        return -1;
    }

    // Take first 16 hex characters (8 bytes).
    for (int i = 0; i < 8; i++) {
        snprintf(cache_key + (i * 2), 3, "%02x", hash[i]);
    }
    cache_key[16] = '\0';

    return 0;
}

/**
 * Calculate full SHA-512 hash for metadata checksum.
 */
static int binflate_calculate_sha512_hex(const unsigned char *data, size_t len, char *output_hex) {
    unsigned char hash[SHA512_DIGEST_LEN];

    if (binflate_sha512(data, len, hash) != 0) {
        return -1;
    }

    // Convert full hash to hex string.
    for (int i = 0; i < SHA512_DIGEST_LEN; i++) {
        snprintf(output_hex + (i * 2), 3, "%02x", hash[i]);
    }
    output_hex[SHA512_DIGEST_LEN * 2] = '\0';

    return 0;
}

#endif /* BINFLATE_COMMON_H */
