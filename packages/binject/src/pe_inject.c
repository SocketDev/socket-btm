#include "binject.h"
#include "file_io_common.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/**
 * Injection for PE binaries
 * Copies executable and injects both SEA and VFS sections
 */
int binject_batch_pe(const char *executable, const char *output,
                      const uint8_t *sea_data, size_t sea_size,
                      const uint8_t *vfs_data, size_t vfs_size) {
    /* Always use temp file for safety and simplicity */
    char temp_path[4096];
    snprintf(temp_path, sizeof(temp_path), "%s.tmp", output);

    /* Copy input to temp file */
    int copy_result = file_io_copy(executable, temp_path);
    if (copy_result != FILE_IO_OK) {
        return BINJECT_ERROR_FILE_NOT_FOUND;
    }

    /* Now inject sections into the temp file using LIEF (cross-platform) */
    int rc = BINJECT_OK;

    if (sea_data && rc == BINJECT_OK) {
#ifdef HAVE_LIEF
        rc = binject_pe_lief(temp_path, "NODE_SEA", sea_data, sea_size);
#else
        rc = binject_single_pe(temp_path, temp_path, "NODE_SEA", sea_data, sea_size, 0, 0);
#endif
        if (rc != BINJECT_OK) {
            fprintf(stderr, "Error: Failed to inject SEA section\n");
            remove(temp_path);
            return rc;
        }
    }

    if (vfs_data && rc == BINJECT_OK) {
#ifdef HAVE_LIEF
        rc = binject_pe_lief(temp_path, "NODE_VFS", vfs_data, vfs_size);
#else
        rc = binject_single_pe(temp_path, temp_path, "NODE_VFS", vfs_data, vfs_size, 0, 0);
#endif
        if (rc != BINJECT_OK) {
            fprintf(stderr, "Error: Failed to inject VFS section\n");
            remove(temp_path);
            return rc;
        }
    }

    /* Atomically move temp file to final output */
    if (rc == BINJECT_OK) {
        remove(output);
        if (rename(temp_path, output) != 0) {
            fprintf(stderr, "Error: Failed to rename temp file to output\n");
            remove(temp_path);
            return BINJECT_ERROR_FILE_NOT_FOUND;
        }
    }

    return rc;
}
