/**
 * Test constants for binject
 *
 * Re-exports shared constants from build-infra that match the limits defined in the C source code:
 * - MAX_ELF_SIZE in src/single_elf_inject.c
 * - MAX_PE_SIZE in src/single_pe_inject.c
 * - MAX_RESOURCE_SIZE in src/binject.c
 */

export {
  MAX_NODE_BINARY_SIZE,
  MAX_SEA_BLOB_SIZE,
  MAX_VFS_SIZE,
} from 'build-infra/lib/constants'
