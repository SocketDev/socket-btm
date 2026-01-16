/**
 * Shared segment and section name constants for all binary formats.
 *
 * These constants ensure consistency across binpress, binject, and binflate
 * for Mach-O, ELF, and PE binary manipulation.
 *
 * Naming conventions:
 * - Mach-O segments: "SMOL", "NODE_SEA" (no underscores, following Node.js pattern)
 * - Mach-O sections: "__PRESSED_DATA", "__NODE_SEA_BLOB", "__SMOL_VFS_BLOB" (with underscores)
 * - ELF sections: ".pressed_data" (lowercase with dot prefix, for binpress)
 * - ELF notes: "NODE_SEA_BLOB", "SMOL_VFS_BLOB" (uppercase, NO dot prefix, PT_NOTE segments)
 * - PE sections: ".pressed_data" (lowercase with dot prefix, for binpress)
 * - PE resources: "NODE_SEA_BLOB", "SMOL_VFS_BLOB" (uppercase, NO dot prefix, RT_RCDATA type)
 *
 * Platform-specific details:
 * - ELF: Uses PT_NOTE segments (not PT_LOAD sections) to align with postject/Node.js
 * - PE: Uses PE resources (.rsrc section with RT_RCDATA) to align with postject/Node.js
 * - Mach-O: Uses custom segments with sections, matches postject approach
 */

#ifndef SEGMENT_NAMES_H
#define SEGMENT_NAMES_H

// Mach-O segment names (no underscores)
#define MACHO_SEGMENT_SMOL "SMOL"
#define MACHO_SEGMENT_NODE_SEA "NODE_SEA"

// Mach-O section names (with underscores)
#define MACHO_SECTION_PRESSED_DATA "__PRESSED_DATA"
#define MACHO_SECTION_NODE_SEA_BLOB "__NODE_SEA_BLOB"
#define MACHO_SECTION_SMOL_VFS_BLOB "__SMOL_VFS_BLOB"

// ELF section names (lowercase with dot prefix - for binpress)
#define ELF_SECTION_PRESSED_DATA ".pressed_data"

// ELF note names (for PT_NOTE segments - no dot prefix)
// These are note owner names that Node.js searches for via postject_find_resource()
#define ELF_NOTE_NODE_SEA_BLOB "NODE_SEA_BLOB"
#define ELF_NOTE_SMOL_VFS_BLOB "SMOL_VFS_BLOB"
// SMOL note for binpress compression:
//   Mach-O: SMOL/__PRESSED_DATA        (segment/section)
//   ELF:    PT_NOTE with owner "pressed_data" (LIEF creates .note.pressed_data section)
//   PE:     .pressed_data              (section only - no segments in PE)
#define ELF_NOTE_PRESSED_DATA "pressed_data"

// PE section names (lowercase with dot prefix - for binpress)
#define PE_SECTION_PRESSED_DATA ".pressed_data"

// PE resource names (for PE resource-based injection - no dot prefix)
// These are resource names that Node.js searches for via FindResourceA()
#define PE_RESOURCE_NODE_SEA_BLOB "NODE_SEA_BLOB"
#define PE_RESOURCE_SMOL_VFS_BLOB "SMOL_VFS_BLOB"

// Magic markers
#define SMOL_PRESSED_DATA_MAGIC_MARKER "__SMOL_PRESSED_DATA_MAGIC_MARKER"

// NODE_SEA fuse string (from Node.js)
#define NODE_SEA_FUSE_STRING "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
#define NODE_SEA_FUSE_UNFLIPPED "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0"
#define NODE_SEA_FUSE_FLIPPED "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1"

#endif /* SEGMENT_NAMES_H */
