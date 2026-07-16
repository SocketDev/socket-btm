#ifndef BIN_INFRA_STUB_DECOMPRESS_H
#define BIN_INFRA_STUB_DECOMPRESS_H

#include <stddef.h>
#include <stdio.h>

#include <zstd.h>

/**
 * Decompress a ZSTD payload into a caller-provided buffer of the exact expected
 * uncompressed size. Returns 0 on success, -1 on a ZSTD error or a size
 * mismatch. Shared by every stub (bin + addon) — was duplicated per-platform in
 * elf_stub.c / macho_stub.c / pe_stub.c.
 */
static inline int stub_zstd_decompress(const unsigned char *compressed_data,
                                       size_t compressed_size,
                                       unsigned char *decompressed_data,
                                       size_t uncompressed_size) {
    size_t decompressed_bytes = ZSTD_decompress(
        decompressed_data, uncompressed_size, compressed_data, compressed_size);

    if (ZSTD_isError(decompressed_bytes)) {
        fprintf(stderr, "Error: ZSTD decompression failed: %s\n",
                ZSTD_getErrorName(decompressed_bytes));
        return -1;
    }

    if (decompressed_bytes != uncompressed_size) {
        fprintf(stderr,
                "Error: ZSTD decompression size mismatch (got %zu, expected %zu)\n",
                decompressed_bytes, uncompressed_size);
        return -1;
    }

    return 0;
}

#endif /* BIN_INFRA_STUB_DECOMPRESS_H */
