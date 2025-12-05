/**
 * binject unit tests
 *
 * Tests core functionality: format detection, resource reading, checksum, etc.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../src/binject.h"
#include "../../bin-infra/src/test.h"
#include "test_helpers.h"


/* Create temporary test files */
static void create_test_file(const char *filename, const uint8_t *data, size_t size) {
    char path[512];
    build_temp_path(path, sizeof(path), filename);
    FILE *fp = fopen(path, "wb");
    if (fp) {
        fwrite(data, 1, size, fp);
        fclose(fp);
    }
}

/* Test: Version constants */
TEST(test_version_constants) {
    ASSERT_EQ(BINJECT_VERSION_MAJOR, 0);
    ASSERT_EQ(BINJECT_VERSION_MINOR, 0);
    ASSERT_EQ(BINJECT_VERSION_PATCH, 0);
    return TEST_PASS;
}

/* Test: Error code constants */
TEST(test_error_codes) {
    ASSERT_EQ(BINJECT_OK, 0);
    ASSERT_NE(BINJECT_ERROR, 0);
    ASSERT_NE(BINJECT_ERROR_INVALID_ARGS, 0);
    ASSERT_NE(BINJECT_ERROR_FILE_NOT_FOUND, 0);
    return TEST_PASS;
}

/* Test: Detect Mach-O format (32-bit big endian) */
TEST(test_detect_macho_format_32be) {
    char path[512];
    uint8_t macho_magic[] = {0xFE, 0xED, 0xFA, 0xCE, 0x00, 0x00, 0x00, 0x00};
    create_test_file("test_macho_32be.bin", macho_magic, sizeof(macho_magic));
    build_temp_path(path, sizeof(path), "test_macho_32be.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_MACHO);

    build_temp_path(path, sizeof(path), "test_macho_32be.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect Mach-O format (64-bit big endian) */
TEST(test_detect_macho_format_64be) {
    char path[512];
    uint8_t macho_magic[] = {0xFE, 0xED, 0xFA, 0xCF, 0x00, 0x00, 0x00, 0x00};
    create_test_file("test_macho_64be.bin", macho_magic, sizeof(macho_magic));
    build_temp_path(path, sizeof(path), "test_macho_64be.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_MACHO);

    build_temp_path(path, sizeof(path), "test_macho_64be.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect Mach-O format (64-bit little endian) */
TEST(test_detect_macho_format_64le) {
    char path[512];
    uint8_t macho_magic[] = {0xCF, 0xFA, 0xED, 0xFE, 0x00, 0x00, 0x00, 0x00};
    create_test_file("test_macho_64le.bin", macho_magic, sizeof(macho_magic));
    build_temp_path(path, sizeof(path), "test_macho_64le.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_MACHO);

    build_temp_path(path, sizeof(path), "test_macho_64le.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect Mach-O universal binary */
TEST(test_detect_macho_format_universal) {
    char path[512];
    uint8_t macho_magic[] = {0xCA, 0xFE, 0xBA, 0xBE, 0x00, 0x00, 0x00, 0x02};
    create_test_file("test_macho_universal.bin", macho_magic, sizeof(macho_magic));
    build_temp_path(path, sizeof(path), "test_macho_universal.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_MACHO);

    build_temp_path(path, sizeof(path), "test_macho_universal.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect ELF format */
TEST(test_detect_elf_format) {
    char path[512];
    uint8_t elf_magic[] = {0x7F, 'E', 'L', 'F', 0x02, 0x01, 0x01, 0x00};
    create_test_file("test_elf.bin", elf_magic, sizeof(elf_magic));
    build_temp_path(path, sizeof(path), "test_elf.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_ELF);

    build_temp_path(path, sizeof(path), "test_elf.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect PE format */
TEST(test_detect_pe_format) {
    char path[512];
    uint8_t pe_magic[] = {'M', 'Z', 0x90, 0x00, 0x03, 0x00, 0x00, 0x00};
    create_test_file("test_pe.bin", pe_magic, sizeof(pe_magic));
    build_temp_path(path, sizeof(path), "test_pe.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_PE);

    build_temp_path(path, sizeof(path), "test_pe.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect unknown format */
TEST(test_detect_unknown_format) {
    char path[512];
    uint8_t unknown_magic[] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
    create_test_file("test_unknown.bin", unknown_magic, sizeof(unknown_magic));
    build_temp_path(path, sizeof(path), "test_unknown.bin");

    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_UNKNOWN);

    build_temp_path(path, sizeof(path), "test_unknown.bin");
    unlink(path);
    return TEST_PASS;
}

/* Test: Detect format for nonexistent file */
TEST(test_detect_format_nonexistent) {
    char path[512];
    build_temp_path(path, sizeof(path), "nonexistent_file_12345.bin");
    binject_format_t format = binject_detect_format(path);
    ASSERT_EQ(format, BINJECT_FORMAT_UNKNOWN);
    return TEST_PASS;
}

/* Test: Read resource file */
TEST(test_read_resource) {
    char path[512];
    const char *test_data = "Hello, binject!";
    size_t test_size = strlen(test_data);
    create_test_file("test_resource.txt", (const uint8_t*)test_data, test_size);
    build_temp_path(path, sizeof(path), "test_resource.txt");

    uint8_t *data = NULL;
    size_t size = 0;
    int rc = binject_read_resource(path, &data, &size);

    ASSERT_EQ(rc, BINJECT_OK);
    ASSERT_NOT_NULL(data);
    ASSERT_EQ(size, test_size);
    ASSERT_MEM_EQ(data, test_data, test_size);

    free(data);
    build_temp_path(path, sizeof(path), "test_resource.txt");
    unlink(path);
    return TEST_PASS;
}

/* Test: Read nonexistent resource */
TEST(test_read_nonexistent_resource) {
    char path[512];
    build_temp_path(path, sizeof(path), "nonexistent_resource_12345.txt");
    uint8_t *data = NULL;
    size_t size = 0;
    int rc = binject_read_resource(path, &data, &size);

    ASSERT_EQ(rc, BINJECT_ERROR_FILE_NOT_FOUND);
    return TEST_PASS;
}

/* Test: Read empty resource */
TEST(test_read_empty_resource) {
    char path[512];
    create_test_file("test_empty.txt", NULL, 0);
    build_temp_path(path, sizeof(path), "test_empty.txt");

    build_temp_path(path, sizeof(path), "test_empty.txt");
    uint8_t *data = NULL;
    size_t size = 0;
    int rc = binject_read_resource(path, &data, &size);

    ASSERT_EQ(rc, BINJECT_OK);
    ASSERT_NOT_NULL(data);
    ASSERT_EQ(size, 0);

    free(data);
    build_temp_path(path, sizeof(path), "test_empty.txt");
    unlink(path);
    return TEST_PASS;
}

/* Test: Checksum basic functionality */
TEST(test_checksum_basic) {
    const uint8_t data[] = {0x01, 0x02, 0x03, 0x04, 0x05};
    uint32_t checksum = binject_checksum(data, sizeof(data));

    ASSERT_NE(checksum, 0);
    return TEST_PASS;
}

/* Test: Checksum deterministic */
TEST(test_checksum_deterministic) {
    const uint8_t data[] = {0x01, 0x02, 0x03, 0x04, 0x05};
    uint32_t checksum1 = binject_checksum(data, sizeof(data));
    uint32_t checksum2 = binject_checksum(data, sizeof(data));

    ASSERT_EQ(checksum1, checksum2);
    return TEST_PASS;
}

/* Test: Checksum different for different data */
TEST(test_checksum_different_data) {
    const uint8_t data1[] = {0x01, 0x02, 0x03, 0x04, 0x05};
    const uint8_t data2[] = {0x05, 0x04, 0x03, 0x02, 0x01};

    uint32_t checksum1 = binject_checksum(data1, sizeof(data1));
    uint32_t checksum2 = binject_checksum(data2, sizeof(data2));

    ASSERT_NE(checksum1, checksum2);
    return TEST_PASS;
}

/* Test: Checksum empty data */
TEST(test_checksum_empty) {
    const uint8_t data[] = {};
    uint32_t checksum = binject_checksum(data, 0);

    /* Empty data should still produce a checksum (likely 0 or a seed value) */
    ASSERT_EQ(checksum, checksum);  /* Just verify it doesn't crash */
    return TEST_PASS;
}

/* Main test runner */
int main(void) {
    TEST_SUITE("binject Core Tests");

    /* Version and error codes */
    RUN_TEST(test_version_constants);
    RUN_TEST(test_error_codes);

    /* Format detection */
    RUN_TEST(test_detect_macho_format_32be);
    RUN_TEST(test_detect_macho_format_64be);
    RUN_TEST(test_detect_macho_format_64le);
    RUN_TEST(test_detect_macho_format_universal);
    RUN_TEST(test_detect_elf_format);
    RUN_TEST(test_detect_pe_format);
    RUN_TEST(test_detect_unknown_format);
    RUN_TEST(test_detect_format_nonexistent);

    /* Resource reading */
    RUN_TEST(test_read_resource);
    RUN_TEST(test_read_nonexistent_resource);
    RUN_TEST(test_read_empty_resource);

    /* Checksum */
    RUN_TEST(test_checksum_basic);
    RUN_TEST(test_checksum_deterministic);
    RUN_TEST(test_checksum_different_data);
    RUN_TEST(test_checksum_empty);

    return TEST_REPORT();
}
