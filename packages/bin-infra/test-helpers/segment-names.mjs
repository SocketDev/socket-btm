/**
 * Shared segment and section name constants for test files.
 *
 * These constants mirror the C/C++ definitions in bin-infra/src/segment_names.h
 * to ensure consistency across the codebase and tests.
 *
 * Naming conventions:
 * - Mach-O segments: "SMOL", "NODE_SEA" (no underscores, following Node.js pattern)
 * - Mach-O sections: "__PRESSED_DATA", "__NODE_SEA_BLOB", "__SMOL_VFS_BLOB" (with underscores)
 * - ELF sections: ".pressed_data" (lowercase with dot prefix, for binpress)
 * - ELF notes: "NODE_SEA_BLOB", "SMOL_VFS_BLOB" (uppercase, NO dot prefix, PT_NOTE segments)
 * - PE sections: ".pressed_data" (lowercase with dot prefix, for binpress)
 * - PE resources: "NODE_SEA_BLOB", "SMOL_VFS_BLOB" (uppercase, NO dot prefix, RT_RCDATA type)
 */

// Mach-O segment names (no underscores)
export const MACHO_SEGMENT_SMOL = 'SMOL'
export const MACHO_SEGMENT_NODE_SEA = 'NODE_SEA'

// Mach-O section names (with underscores)
export const MACHO_SECTION_PRESSED_DATA = '__PRESSED_DATA'
export const MACHO_SECTION_NODE_SEA_BLOB = '__NODE_SEA_BLOB'
export const MACHO_SECTION_SMOL_VFS_BLOB = '__SMOL_VFS_BLOB'

// ELF section names (lowercase with dot prefix - for binpress)
export const ELF_SECTION_PRESSED_DATA = '.pressed_data'

// ELF note names (for PT_NOTE segments - no dot prefix)
export const ELF_NOTE_NODE_SEA_BLOB = 'NODE_SEA_BLOB'
export const ELF_NOTE_SMOL_VFS_BLOB = 'SMOL_VFS_BLOB'

// PE section names (lowercase with dot prefix - for binpress)
export const PE_SECTION_PRESSED_DATA = '.pressed_data'

// PE resource names (for PE resource-based injection - no dot prefix)
export const PE_RESOURCE_NODE_SEA_BLOB = 'NODE_SEA_BLOB'
export const PE_RESOURCE_SMOL_VFS_BLOB = 'SMOL_VFS_BLOB'

// Magic markers
export const SMOL_PRESSED_DATA_MAGIC_MARKER = '__SMOL_PRESSED_DATA_MAGIC_MARKER'

// NODE_SEA fuse string (from Node.js)
export const NODE_SEA_FUSE_STRING =
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
export const NODE_SEA_FUSE_UNFLIPPED =
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0'
export const NODE_SEA_FUSE_FLIPPED =
  'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1'
