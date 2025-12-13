/**
 * Shared constants for Socket BTM build infrastructure
 *
 * These constants define size limits and constraints used across multiple packages.
 */

/**
 * Maximum Node.js binary size that binject can process
 * Matches MAX_ELF_SIZE and MAX_PE_SIZE in binject C source (200 MB)
 *
 * This limit applies to the final Node.js binary (ELF or PE format) that
 * binject processes.
 */
// 200 MB
export const MAX_NODE_BINARY_SIZE = 200 * 1024 * 1024

/**
 * Maximum SEA (Single Executable Application) blob size
 * Matches Node.js's kMaxPayloadSize limit (2 GB - 1 byte)
 *
 * This is the maximum size for the application code embedded in the
 * NODE_SEA_BLOB section of a Node.js binary.
 */
// 2 GB - 1 byte (2^31 - 1, INT_MAX on 32-bit systems)
export const MAX_SEA_BLOB_SIZE = 2_147_483_647

/**
 * Maximum VFS (Virtual File System) size
 * Matches MAX_RESOURCE_SIZE in binject C source (500 MB)
 *
 * This is the maximum size for the virtual file system data embedded in the
 * NODE_VFS_BLOB section.
 */
// 500 MB
export const MAX_VFS_SIZE = 500 * 1024 * 1024
