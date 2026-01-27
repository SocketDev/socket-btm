/**
 * LIEF wrapper functions for Mach-O binary injection.
 *
 * Provides C API wrappers around LIEF C++ implementation.
 * Requires LIEF library to be built and linked.
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "binject.h"
#include "segment_names.h"

/**
 * Inject resource into Mach-O binary using LIEF.
 *
 * @param executable Path to the Mach-O binary.
 * @param segment_name Segment name (e.g., MACHO_SEGMENT_NODE_SEA).
 * @param section_name Section name (e.g., MACHO_SECTION_SMOL_VFS_BLOB).
 * @param data Resource data to inject.
 * @param size Size of resource data.
 * @return BINJECT_OK on success, error code otherwise.
 */
int binject_macho(const char *executable, const char *segment_name,
                  const char *section_name, const uint8_t *data, size_t size) {
    if (!executable || !segment_name || !section_name || !data || size == 0) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    printf("Using LIEF for injection (data size: %zu bytes)...\n", size);
    int result = binject_macho_lief(executable, segment_name, section_name, data, size);
    if (result == BINJECT_OK) {
        printf("Successfully injected using LIEF\n");
        return BINJECT_OK;
    }

    fprintf(stderr, "Error: LIEF injection failed (exit code %d)\n", result);
    return result;
}

/**
 * List sections in Mach-O binary.
 *
 * @param executable Path to the Mach-O binary.
 * @return BINJECT_OK on success, error code otherwise.
 */
int binject_macho_list(const char *executable) {
    if (!executable) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    return binject_macho_list_lief(executable);
}

/**
 * Extract section from Mach-O binary.
 *
 * @param executable Path to the Mach-O binary.
 * @param section_name Section name to extract.
 * @param output_file Path to write extracted data.
 * @return BINJECT_OK on success, error code otherwise.
 */
int binject_macho_extract(const char *executable, const char *section_name,
                          const char *output_file) {
    if (!executable || !section_name || !output_file) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    return binject_macho_extract_lief(executable, section_name, output_file);
}

/**
 * Verify section in Mach-O binary.
 *
 * @param executable Path to the Mach-O binary.
 * @param section_name Section name to verify.
 * @return BINJECT_OK on success, error code otherwise.
 */
int binject_macho_verify(const char *executable, const char *section_name) {
    if (!executable || !section_name) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    return binject_macho_verify_lief(executable, section_name);
}

/**
 * Repack SMOL segment in compressed stub using LIEF.
 *
 * @param stub_path Path to the original compressed stub.
 * @param section_data New content for __PRESSED_DATA section.
 * @param section_size Size of new content.
 * @param output_path Path to write repacked stub.
 * @return BINJECT_OK on success, error code otherwise.
 */
int binject_macho_repack_smol(const char *stub_path, const uint8_t *section_data,
                               size_t section_size, const char *output_path) {
    if (!stub_path || !section_data || !output_path || section_size == 0) {
        fprintf(stderr, "Error: Invalid arguments\n");
        return BINJECT_ERROR_INVALID_ARGS;
    }

    return binject_macho_repack_smol_lief(stub_path, section_data, section_size, output_path);
}
