/**
 * @file test-relative-path-detection.c
 * @brief Unit test for binary format detection with relative paths
 *
 * This test verifies that binject_detect_format() correctly handles both
 * absolute and relative paths when detecting binary formats.
 *
 * Regression test for bug where relative paths caused format detection to fail.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <limits.h>
#include "socketsecurity/binject/binject.h"

/**
 * Create a minimal Mach-O file for testing.
 */
static int create_test_macho(const char *path) {
    FILE *fp = fopen(path, "wb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot create test file: %s\n", path);
        return -1;
    }

    /* Write Mach-O magic bytes (MH_MAGIC_64 little-endian: CF FA ED FE) */
    uint8_t magic[4] = { 0xCF, 0xFA, 0xED, 0xFE };
    if (fwrite(magic, 1, 4, fp) != 4) {
        fclose(fp);
        fprintf(stderr, "Error: Cannot write magic bytes\n");
        return -1;
    }

    fclose(fp);
    return 0;
}

int main(void) {
    int failures = 0;
    char cwd[PATH_MAX];
    if (getcwd(cwd, sizeof(cwd)) == NULL) {
        fprintf(stderr, "Error: Cannot get current directory\n");
        return 1;
    }

    /* Create test file in current directory */
    const char *test_filename = "test-macho-binary.tmp";
    if (create_test_macho(test_filename) != 0) {
        return 1;
    }

    /* Build absolute path */
    char absolute_path[PATH_MAX];
    snprintf(absolute_path, sizeof(absolute_path), "%s/%s", cwd, test_filename);

    /* Test 1: Absolute path detection */
    printf("Test 1: Detecting format with absolute path...\n");
    printf("  Path: %s\n", absolute_path);
    binject_format_t format_absolute = binject_detect_format(absolute_path);
    if (format_absolute != BINJECT_FORMAT_MACHO) {
        fprintf(stderr, "  ✗ FAIL: Expected MACHO, got %d\n", format_absolute);
        failures++;
    } else {
        printf("  ✓ PASS: Correctly detected MACHO format\n");
    }

    /* Test 2: Relative path detection */
    printf("\nTest 2: Detecting format with relative path...\n");
    printf("  Path: %s\n", test_filename);
    binject_format_t format_relative = binject_detect_format(test_filename);
    if (format_relative != BINJECT_FORMAT_MACHO) {
        fprintf(stderr, "  ✗ FAIL: Expected MACHO, got %d\n", format_relative);
        failures++;
    } else {
        printf("  ✓ PASS: Correctly detected MACHO format\n");
    }

    /* Test 3: Relative path with directory traversal */
    printf("\nTest 3: Detecting format with directory traversal path...\n");
    char relative_path[PATH_MAX];
    snprintf(relative_path, sizeof(relative_path), "./%s", test_filename);
    printf("  Path: %s\n", relative_path);
    binject_format_t format_dot = binject_detect_format(relative_path);
    if (format_dot != BINJECT_FORMAT_MACHO) {
        fprintf(stderr, "  ✗ FAIL: Expected MACHO, got %d\n", format_dot);
        failures++;
    } else {
        printf("  ✓ PASS: Correctly detected MACHO format\n");
    }

    /* Cleanup */
    remove(test_filename);

    /* Summary */
    printf("\n");
    if (failures == 0) {
        printf("✓ All tests passed!\n");
        return 0;
    } else {
        printf("✗ %d test(s) failed\n", failures);
        return 1;
    }
}
