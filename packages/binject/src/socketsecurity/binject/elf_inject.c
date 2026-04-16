// ============================================================================
// elf_inject.c — ELF (Linux) binary injection
// ============================================================================
//
// WHAT THIS FILE DOES
// Injects SEA and VFS data sections into Linux ELF executables. Delegates
// to binject_elf_lief_batch() which uses the LIEF library to parse, modify,
// and write the binary in a single pass.
//
// WHY IT EXISTS
// ELF is the executable format on Linux. This file provides the
// platform-specific glue between the generic binject API and the LIEF-based
// ELF manipulation code (written in C++).
// ============================================================================

#include "socketsecurity/binject/binject.h"
#include "socketsecurity/build-infra/file_io_common.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/**
 * Injection for ELF binaries.
 *
 * Uses binject_elf_lief_batch() to inject both SEA and VFS sections in a single
 * LIEF pass. This avoids LIEF memory corruption issues that occur when parsing
 * and modifying the same binary multiple times in sequence.
 *
 * @param executable Path to input ELF binary.
 * @param output Path to write modified binary.
 * @param sea_data SEA blob data (or NULL to skip).
 * @param sea_size Size of SEA data.
 * @param vfs_data VFS blob data (or NULL to skip).
 * @param vfs_size Size of VFS data.
 * @param vfs_compat_mode If true and vfs_data is NULL, inject 0-byte VFS section.
 * @return BINJECT_OK on success, error code otherwise.
 */
int binject_batch_elf(const char *executable, const char *output,
                      const uint8_t *sea_data, size_t sea_size,
                      const uint8_t *vfs_data, size_t vfs_size,
                      int vfs_compat_mode,
                      const uint8_t *vfs_config_data) {
    /*
     * Use the batch function which parses and writes the binary exactly once.
     * This avoids LIEF memory corruption from sequential parse-modify-write cycles.
     */
    return binject_elf_lief_batch(executable, output,
                                   sea_data, sea_size,
                                   vfs_data, vfs_size,
                                   vfs_compat_mode,
                                   vfs_config_data);
}
