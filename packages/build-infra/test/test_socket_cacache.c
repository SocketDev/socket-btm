/**
 * test_socket_cache.c - Comprehensive tests for socket_cacache.h
 *
 * Standalone test program: each test uses a temp directory and cleans up.
 *
 * Build (macOS):
 *   cc -Wall -I../../.. test_socket_cache.c -o /tmp/test_sc -framework Security && /tmp/test_sc
 *
 * Build (Linux):
 *   cc -Wall -I../../.. test_socket_cache.c -o /tmp/test_sc -lssl -lcrypto && /tmp/test_sc
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>

/* Set SOCKET_CACACHE_DIR before including the header so it picks up our test dir */
#include "socketsecurity/build-infra/socket_cacache.h"

static int g_passed = 0;
static int g_failed = 0;

#define RUN_TEST(name, fn) do { \
    if ((fn)() == 0) { \
        printf("PASS: %s\n", (name)); \
        g_passed++; \
    } else { \
        printf("FAIL: %s\n", (name)); \
        g_failed++; \
    } \
} while (0)

/* Recursive directory removal (rm -rf) */
static int rmrf(const char *path) {
    struct stat st;
    if (lstat(path, &st) != 0) return 0;
    if (S_ISDIR(st.st_mode)) {
        DIR *d = opendir(path);
        if (!d) return -1;
        struct dirent *ent;
        while ((ent = readdir(d)) != NULL) {
            if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
            char child[1024];
            snprintf(child, sizeof(child), "%s/%s", path, ent->d_name);
            rmrf(child);
        }
        closedir(d);
        return rmdir(path);
    }
    if (S_ISLNK(st.st_mode)) return unlink(path);
    return unlink(path);
}

static char *make_tmpdir(const char *suffix) {
    static char buf[256];
    snprintf(buf, sizeof(buf), "/tmp/cacache-c-%s-XXXXXX", suffix);
    char *result = mkdtemp(buf);
    return result;
}

static int dir_exists(const char *path) {
    struct stat st;
    return (stat(path, &st) == 0 && S_ISDIR(st.st_mode));
}

static int dir_is_empty(const char *path) {
    DIR *d = opendir(path);
    if (!d) return 1; /* doesn't exist = empty */
    struct dirent *ent;
    while ((ent = readdir(d)) != NULL) {
        if (strcmp(ent->d_name, ".") == 0 || strcmp(ent->d_name, "..") == 0) continue;
        closedir(d);
        return 0; /* found a file */
    }
    closedir(d);
    return 1;
}

/* ===================================================================
 * Normal round-trip: put + get + verify content matches
 * =================================================================== */
static int test_normal_roundtrip(void) {
    char *tmpDir = make_tmpdir("roundtrip");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:test:roundtrip";
    const uint8_t data[] = "hello cacache from C";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(key, data, data_len, "") != 0) {
        fprintf(stderr, "  cacache_put failed\n");
        rmrf(tmpDir);
        return -1;
    }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  cacache_get failed\n");
        rmrf(tmpDir);
        return -1;
    }

    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  data mismatch\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Error handling: nonexistent key returns -1, not crash
 * =================================================================== */
static int test_error_nonexistent_key(void) {
    char *tmpDir = make_tmpdir("nokey");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);
    mkdir(tmpDir, 0755);

    uint8_t *got = NULL;
    size_t got_len = 0;
    int rc = cacache_get("socket-btm:nonexistent-key-xyz", &got, &got_len);
    if (rc == 0) {
        fprintf(stderr, "  expected error for missing key\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * DI-01: Integrity verification on read
 * =================================================================== */
static int test_di01_integrity_verification(void) {
    char *tmpDir = make_tmpdir("di01");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:integrity-corrupt-test";
    const uint8_t data[] = "original content for integrity test";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(key, data, data_len, "") != 0) {
        rmrf(tmpDir);
        return -1;
    }

    /* Verify read works before corruption */
    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  get before corruption failed\n");
        rmrf(tmpDir);
        return -1;
    }
    free(got);

    /* Corrupt the content file: find the content-v2 dir and corrupt the file */
    unsigned char hash[SCACHE_SHA512_LEN];
    scache_sha512(data, data_len, hash);
    char content_path[1024];
    scache_content_path_from_hash(tmpDir, hash, content_path, sizeof(content_path));

    FILE *f = fopen(content_path, "wb");
    if (!f) {
        fprintf(stderr, "  failed to open content file for corruption\n");
        rmrf(tmpDir);
        return -1;
    }
    fprintf(f, "CORRUPTED DATA");
    fclose(f);

    /* Read after corruption must fail */
    got = NULL;
    got_len = 0;
    int rc = cacache_get(key, &got, &got_len);
    if (rc == 0) {
        fprintf(stderr, "  DI-01: read after corruption must fail\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * SEC-01: Symlink protection — put, get, remove are blocked
 * =================================================================== */
static int test_sec01_symlink_protection(void) {
    char *testDir = make_tmpdir("sec01");
    if (!testDir) return -1;

    char socketDir[512], realTarget[512], symlinkPath[512];
    snprintf(socketDir, sizeof(socketDir), "%s/.socket", testDir);
    snprintf(realTarget, sizeof(realTarget), "%s/real_cache", testDir);
    snprintf(symlinkPath, sizeof(symlinkPath), "%s/.socket/_cacache", testDir);
    mkdir(socketDir, 0755);
    mkdir(realTarget, 0755);
    symlink(realTarget, symlinkPath);

    setenv("SOCKET_CACACHE_DIR", symlinkPath, 1);

    /* Put must fail */
    if (cacache_put("sec01-key", (const uint8_t *)"data", 4, "") == 0) {
        fprintf(stderr, "  SEC-01: put through symlink must fail\n");
        rmrf(testDir);
        return -1;
    }

    /* Get must fail */
    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get("sec01-key", &got, &got_len) == 0) {
        fprintf(stderr, "  SEC-01: get through symlink must fail\n");
        free(got);
        rmrf(testDir);
        return -1;
    }

    /* Remove must fail */
    if (cacache_remove("sec01-key") == 0) {
        fprintf(stderr, "  SEC-01: remove through symlink must fail\n");
        rmrf(testDir);
        return -1;
    }

    rmrf(testDir);
    return 0;
}

/* ===================================================================
 * SEC-01: Non-Windows symlink check is active (verify on macOS/Linux)
 * =================================================================== */
static int test_sec01_non_windows_symlink_check(void) {
#if defined(_WIN32)
    /* On Windows, symlink check is skipped — test is N/A */
    return 0;
#else
    char *testDir = make_tmpdir("sec01nw");
    if (!testDir) return -1;

    char socketDir[512], realTarget[512], symlinkPath[512];
    snprintf(socketDir, sizeof(socketDir), "%s/.socket", testDir);
    snprintf(realTarget, sizeof(realTarget), "%s/real_nw", testDir);
    snprintf(symlinkPath, sizeof(symlinkPath), "%s/.socket/_cacache", testDir);
    mkdir(socketDir, 0755);
    mkdir(realTarget, 0755);
    symlink(realTarget, symlinkPath);

    int rc = scache_verify_no_symlinks(symlinkPath);
    if (rc == 0) {
        fprintf(stderr, "  SEC-01: non-Windows must detect symlinks\n");
        rmrf(testDir);
        return -1;
    }
    rmrf(testDir);
    return 0;
#endif
}

/* ===================================================================
 * SEC-06: Buffer handling — very long key (500+ chars)
 * =================================================================== */
static int test_sec06_long_key(void) {
    char *tmpDir = make_tmpdir("sec06");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    /* Build a 620-char key */
    char longKey[700];
    memset(longKey, 'k', 620);
    longKey[620] = '\0';

    const uint8_t data[] = "long key test data";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(longKey, data, data_len, "") != 0) {
        fprintf(stderr, "  SEC-06: put with long key failed\n");
        rmrf(tmpDir);
        return -1;
    }
    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(longKey, &got, &got_len) != 0) {
        fprintf(stderr, "  SEC-06: get with long key failed\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  SEC-06: long key data mismatch\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * SEC-08: Key escaping — keys with quotes, backslashes, newlines
 * =================================================================== */
static int test_sec08_key_escaping(void) {
    char *tmpDir = make_tmpdir("sec08");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *specialKey = "key-with-\"quotes\"-and-\\backslash-and-\nnewline";
    const uint8_t data[] = "special chars test data";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(specialKey, data, data_len, "") != 0) {
        fprintf(stderr, "  SEC-08: put with special key failed\n");
        rmrf(tmpDir);
        return -1;
    }
    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(specialKey, &got, &got_len) != 0) {
        fprintf(stderr, "  SEC-08: get with special key failed\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  SEC-08: special key data mismatch\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * FS-01: Atomic writes — staging dir is created on write
 * =================================================================== */
static int test_fs01_atomic_write_staging_dir(void) {
    char *testDir = make_tmpdir("fs01");
    if (!testDir) return -1;

    char socketParent[512], cacheDir[512], tmpDirPath[512];
    snprintf(socketParent, sizeof(socketParent), "%s/.socket", testDir);
    snprintf(cacheDir, sizeof(cacheDir), "%s/.socket/_cacache", testDir);
    snprintf(tmpDirPath, sizeof(tmpDirPath), "%s/.socket/_tmp", testDir);

    setenv("SOCKET_CACACHE_DIR", cacheDir, 1);

    if (cacache_put("staging-test", (const uint8_t *)"data", 4, "") != 0) {
        fprintf(stderr, "  cacache_put failed\n");
        rmrf(testDir);
        return -1;
    }

    if (!dir_exists(tmpDirPath)) {
        fprintf(stderr, "  FS-01: staging dir %s not created\n", tmpDirPath);
        rmrf(testDir);
        return -1;
    }

    rmrf(testDir);
    return 0;
}

/* ===================================================================
 * Error handling: permission denied returns error, not crash
 * =================================================================== */
static int test_error_permission_denied(void) {
    char *tmpDir = make_tmpdir("perms");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    chmod(tmpDir, 0444);

    int rc = cacache_put("perm-test", (const uint8_t *)"data", 4, "");
    chmod(tmpDir, 0755);

    if (rc == 0) {
        fprintf(stderr, "  put to read-only dir must fail\n");
        rmrf(tmpDir);
        return -1;
    }
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Soft delete: put, remove, then get returns -1
 * =================================================================== */
static int test_soft_delete(void) {
    char *tmpDir = make_tmpdir("softdel");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:delete-me";
    const uint8_t data[] = "data to be deleted";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(key, data, data_len, "") != 0) {
        rmrf(tmpDir);
        return -1;
    }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  get before delete failed\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  data mismatch before delete\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);

    if (cacache_remove(key) != 0) {
        fprintf(stderr, "  cacache_remove failed\n");
        rmrf(tmpDir);
        return -1;
    }

    got = NULL;
    got_len = 0;
    int rc = cacache_get(key, &got, &got_len);
    if (rc == 0) {
        fprintf(stderr, "  soft delete: get after remove must fail\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Directory structure verification
 * =================================================================== */
static int test_directory_structure(void) {
    char *tmpDir = make_tmpdir("dirstruct");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    if (cacache_put("socket-btm:path-check", (const uint8_t *)"data", 4, "") != 0) {
        rmrf(tmpDir);
        return -1;
    }

    char indexDir[512], contentDir[512];
    snprintf(indexDir, sizeof(indexDir), "%s/index-v5", tmpDir);
    snprintf(contentDir, sizeof(contentDir), "%s/content-v2", tmpDir);

    if (!dir_exists(indexDir)) {
        fprintf(stderr, "  index-v5 not created\n");
        rmrf(tmpDir);
        return -1;
    }
    if (!dir_exists(contentDir)) {
        fprintf(stderr, "  content-v2 not created\n");
        rmrf(tmpDir);
        return -1;
    }
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Put overwrite: second put replaces first
 * =================================================================== */
static int test_put_overwrite(void) {
    char *tmpDir = make_tmpdir("overwrite");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:overwrite";
    const uint8_t d1[] = "first value";
    const uint8_t d2[] = "second value";

    if (cacache_put(key, d1, strlen((const char *)d1), "") != 0) { rmrf(tmpDir); return -1; }
    if (cacache_put(key, d2, strlen((const char *)d2), "") != 0) { rmrf(tmpDir); return -1; }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  get after overwrite failed\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != strlen((const char *)d2) || memcmp(got, d2, got_len) != 0) {
        fprintf(stderr, "  overwrite: expected latest value\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Empty data: put 0-byte data, get it back, verify not NULL
 * =================================================================== */
static int test_empty_data(void) {
    char *tmpDir = make_tmpdir("empty");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:empty-data";

    if (cacache_put(key, (const uint8_t *)"", 0, "") != 0) {
        fprintf(stderr, "  cacache_put empty data failed\n");
        rmrf(tmpDir);
        return -1;
    }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  cacache_get empty data failed (returned error instead of empty)\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != 0) {
        fprintf(stderr, "  expected 0 bytes, got %zu\n", got_len);
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Binary with NUL: data containing \0 bytes round-trips correctly
 * =================================================================== */
static int test_binary_with_nul(void) {
    char *tmpDir = make_tmpdir("nul");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:binary-nul";
    const uint8_t data[] = {0x00, 0x01, 0x02, 0xff};
    size_t data_len = sizeof(data);

    if (cacache_put(key, data, data_len, "") != 0) {
        fprintf(stderr, "  cacache_put binary data failed\n");
        rmrf(tmpDir);
        return -1;
    }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  cacache_get binary data failed\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  binary data with NUL bytes round-trip mismatch\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Overwrite same key: second put replaces first
 * =================================================================== */
static int test_overwrite_same_key(void) {
    char *tmpDir = make_tmpdir("owsamekey");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:overwrite-key";
    const uint8_t v1[] = "v1";
    const uint8_t v2[] = "v2";

    if (cacache_put(key, v1, 2, "") != 0) { rmrf(tmpDir); return -1; }
    if (cacache_put(key, v2, 2, "") != 0) { rmrf(tmpDir); return -1; }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  get after overwrite failed\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != 2 || memcmp(got, v2, 2) != 0) {
        fprintf(stderr, "  overwrite: expected v2, got %.*s\n", (int)got_len, got);
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Content file deleted: get returns -1 when content is missing
 * =================================================================== */
static int test_content_file_deleted(void) {
    char *tmpDir = make_tmpdir("contdel");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:content-deleted";
    const uint8_t data[] = "data whose content file will be deleted";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(key, data, data_len, "") != 0) {
        rmrf(tmpDir);
        return -1;
    }

    /* Verify read works before deletion */
    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  get before content deletion failed\n");
        rmrf(tmpDir);
        return -1;
    }
    free(got);

    /* Delete the content file */
    unsigned char hash[SCACHE_SHA512_LEN];
    scache_sha512(data, data_len, hash);
    char content_path[1024];
    scache_content_path_from_hash(tmpDir, hash, content_path, sizeof(content_path));
    unlink(content_path);

    /* Get must now fail */
    got = NULL;
    got_len = 0;
    int rc = cacache_get(key, &got, &got_len);
    if (rc == 0) {
        fprintf(stderr, "  get must return error when content file is deleted\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Corrupt index line: appended garbage doesn't break valid entry reads
 * =================================================================== */
static int test_corrupt_index_line(void) {
    char *tmpDir = make_tmpdir("corruptidx");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const char *key = "socket-btm:corrupt-index";
    const uint8_t data[] = "valid data for corrupt index test";
    size_t data_len = strlen((const char *)data);

    if (cacache_put(key, data, data_len, "") != 0) {
        rmrf(tmpDir);
        return -1;
    }

    /* Find index file and append garbage */
    char index_path[1024];
    scache_index_path(tmpDir, key, index_path, sizeof(index_path));
    FILE *f = fopen(index_path, "ab");
    if (!f) {
        fprintf(stderr, "  failed to open index file for corruption\n");
        rmrf(tmpDir);
        return -1;
    }
    fprintf(f, "garbage\n");
    fclose(f);

    /* Get must still succeed */
    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(key, &got, &got_len) != 0) {
        fprintf(stderr, "  get must still return valid entry after corrupt line\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  data mismatch after corrupt index line\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Shared content delete: same data under two keys, delete one, other works
 * =================================================================== */
static int test_shared_content_delete(void) {
    char *tmpDir = make_tmpdir("shared");
    if (!tmpDir) return -1;
    setenv("SOCKET_CACACHE_DIR", tmpDir, 1);

    const uint8_t data[] = "shared content between two keys";
    size_t data_len = strlen((const char *)data);
    const char *keyA = "socket-btm:shared-a";
    const char *keyB = "socket-btm:shared-b";

    if (cacache_put(keyA, data, data_len, "") != 0) { rmrf(tmpDir); return -1; }
    if (cacache_put(keyB, data, data_len, "") != 0) { rmrf(tmpDir); return -1; }

    if (cacache_remove(keyA) != 0) {
        fprintf(stderr, "  cacache_remove keyA failed\n");
        rmrf(tmpDir);
        return -1;
    }

    uint8_t *got = NULL;
    size_t got_len = 0;
    if (cacache_get(keyB, &got, &got_len) != 0) {
        fprintf(stderr, "  keyB must still be readable after removing keyA\n");
        rmrf(tmpDir);
        return -1;
    }
    if (got_len != data_len || memcmp(got, data, data_len) != 0) {
        fprintf(stderr, "  shared content data mismatch\n");
        free(got);
        rmrf(tmpDir);
        return -1;
    }
    free(got);
    rmrf(tmpDir);
    return 0;
}

/* ===================================================================
 * Tmp cleanup: no leftover files in staging _tmp/ after put
 * =================================================================== */
static int test_tmp_cleanup(void) {
    char *testDir = make_tmpdir("tmpclean");
    if (!testDir) return -1;

    char socketParent[512], cacheDir[512], tmpDirPath[512];
    snprintf(socketParent, sizeof(socketParent), "%s/.socket", testDir);
    snprintf(cacheDir, sizeof(cacheDir), "%s/.socket/_cacache", testDir);
    snprintf(tmpDirPath, sizeof(tmpDirPath), "%s/.socket/_tmp", testDir);

    setenv("SOCKET_CACACHE_DIR", cacheDir, 1);

    if (cacache_put("socket-btm:tmp-cleanup", (const uint8_t *)"tmp test data", 13, "") != 0) {
        fprintf(stderr, "  cacache_put failed\n");
        rmrf(testDir);
        return -1;
    }

    if (!dir_is_empty(tmpDirPath)) {
        fprintf(stderr, "  staging _tmp/ dir must be empty after put\n");
        rmrf(testDir);
        return -1;
    }

    rmrf(testDir);
    return 0;
}

int main(void) {
    printf("=== socket_cacache.h comprehensive tests ===\n\n");

    RUN_TEST("normal-roundtrip",                test_normal_roundtrip);
    RUN_TEST("error-nonexistent-key",           test_error_nonexistent_key);
    RUN_TEST("di01-integrity-verification",     test_di01_integrity_verification);
    RUN_TEST("sec01-symlink-protection",        test_sec01_symlink_protection);
    RUN_TEST("sec01-non-windows-symlink-check", test_sec01_non_windows_symlink_check);
    RUN_TEST("sec06-long-key",                  test_sec06_long_key);
    RUN_TEST("sec08-key-escaping",              test_sec08_key_escaping);
    RUN_TEST("fs01-atomic-write-staging-dir",   test_fs01_atomic_write_staging_dir);
    RUN_TEST("error-permission-denied",         test_error_permission_denied);
    RUN_TEST("soft-delete",                     test_soft_delete);
    RUN_TEST("directory-structure",             test_directory_structure);
    RUN_TEST("put-overwrite",                   test_put_overwrite);
    RUN_TEST("empty-data",                      test_empty_data);
    RUN_TEST("binary-with-nul",                 test_binary_with_nul);
    RUN_TEST("overwrite-same-key",              test_overwrite_same_key);
    RUN_TEST("content-file-deleted",            test_content_file_deleted);
    RUN_TEST("corrupt-index-line",              test_corrupt_index_line);
    RUN_TEST("shared-content-delete",           test_shared_content_delete);
    RUN_TEST("tmp-cleanup",                     test_tmp_cleanup);

    printf("\nResults: %d passed, %d failed\n", g_passed, g_failed);
    return (g_failed > 0) ? 1 : 0;
}
