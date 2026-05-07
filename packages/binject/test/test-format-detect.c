/**
 * @file test-format-detect.c
 * @brief Test binary format detection with actual node-smol binary
 */

#include <stdio.h>
#include <stdint.h>
#include "socketsecurity/bin-infra/binary_format.h"

int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <binary-file>\n", argv[0]);
        return 1;
    }

    const char *path = argv[1];
    FILE *fp = fopen(path, "rb");
    if (!fp) {
        fprintf(stderr, "Error: Cannot open file: %s\n", path);
        return 1;
    }

    uint8_t magic[4];
    if (fread(magic, 1, 4, fp) != 4) {
        fprintf(stderr, "Error: Cannot read magic bytes\n");
        fclose(fp);
        return 1;
    }
    fclose(fp);

    printf("Magic bytes: 0x%02X 0x%02X 0x%02X 0x%02X\n",
           magic[0], magic[1], magic[2], magic[3]);

    binary_format_t format = detect_binary_format(magic);
    const char *format_names[] = {"UNKNOWN", "MACHO", "ELF", "PE"};
    printf("Detected format: %s (%d)\n", format_names[format], format);

    /* Manual Mach-O check */
    int is_macho_manual = 0;
    if ((magic[0] == 0xFE && magic[1] == 0xED && magic[2] == 0xFA && (magic[3] == 0xCE || magic[3] == 0xCF)) ||
        (magic[0] == 0xCF && magic[1] == 0xFA && magic[2] == 0xED && magic[3] == 0xFE) ||
        (magic[0] == 0xCA && magic[1] == 0xFE && magic[2] == 0xBA && magic[3] == 0xBE) ||
        (magic[0] == 0xBE && magic[1] == 0xBA && magic[2] == 0xFE && magic[3] == 0xCA)) {
        is_macho_manual = 1;
    }
    printf("Manual Mach-O check: %s\n", is_macho_manual ? "YES" : "NO");

    return 0;
}
