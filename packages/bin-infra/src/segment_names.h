/**
 * Shared segment and section name constants for all binary formats.
 *
 * These constants ensure consistency across binpress, binject, and binflate
 * for Mach-O, ELF, and PE binary manipulation.
 *
 * Naming approach (aligned with Node.js 25):
 * - Define logical resource names (e.g., "NODE_SEA_BLOB")
 * - Derive platform-specific constants from logical names:
 *   - Mach-O: Add "__" prefix to logical name (e.g., "__NODE_SEA_BLOB")
 *   - ELF: Use logical name as-is (e.g., "NODE_SEA_BLOB")
 *   - PE: Use logical name as-is (e.g., "NODE_SEA_BLOB")
 *
 * This matches Node.js 25's approach in src/node_sea_bin.cc:
 *   static constexpr const char* kSEAResourceName = "NODE_SEA_BLOB";
 *   if (!(sec.rfind("__", 0) == 0)) sec = "__" + sec;  // Mach-O only
 *
 * Platform-specific details:
 * - Mach-O: Uses custom segments (e.g., "NODE_SEA") with sections (e.g., "__NODE_SEA_BLOB")
 * - ELF: Uses PT_NOTE segments with owner names (e.g., "NODE_SEA_BLOB")
 * - PE: Uses RT_RCDATA resources with names (e.g., "NODE_SEA_BLOB")
 */

#ifndef SEGMENT_NAMES_H
#define SEGMENT_NAMES_H

// Logical resource names (platform-independent)
// These are the names postject_find_resource() expects
#define NODE_SEA_RESOURCE_NAME "NODE_SEA_BLOB"
#define SMOL_VFS_RESOURCE_NAME "SMOL_VFS_BLOB"
#define PRESSED_DATA_RESOURCE_NAME "pressed_data"
#define PRESSED_DATA_RESOURCE_NAME_UPPER "PRESSED_DATA"

// Mach-O segment names (no underscores)
#define MACHO_SEGMENT_SMOL "SMOL"
#define MACHO_SEGMENT_NODE_SEA "NODE_SEA"

// Mach-O section names (add "__" prefix to logical names)
#define MACHO_SECTION_PRESSED_DATA "__" PRESSED_DATA_RESOURCE_NAME_UPPER
#define MACHO_SECTION_NODE_SEA_BLOB "__" NODE_SEA_RESOURCE_NAME
#define MACHO_SECTION_SMOL_VFS_BLOB "__" SMOL_VFS_RESOURCE_NAME

// ELF section names (lowercase with dot prefix - for binpress)
#define ELF_SECTION_PRESSED_DATA "." PRESSED_DATA_RESOURCE_NAME

// ELF note names (use logical names directly)
// These are note owner names that Node.js searches for via postject_find_resource()
#define ELF_NOTE_NODE_SEA_BLOB NODE_SEA_RESOURCE_NAME
#define ELF_NOTE_SMOL_VFS_BLOB SMOL_VFS_RESOURCE_NAME
#define ELF_NOTE_PRESSED_DATA PRESSED_DATA_RESOURCE_NAME

// PE section names (lowercase with dot prefix - for binpress)
#define PE_SECTION_PRESSED_DATA "." PRESSED_DATA_RESOURCE_NAME

// PE resource names (use logical names directly)
// These are resource names that Node.js searches for via FindResourceA()
#define PE_RESOURCE_NODE_SEA_BLOB NODE_SEA_RESOURCE_NAME
#define PE_RESOURCE_SMOL_VFS_BLOB SMOL_VFS_RESOURCE_NAME

// Magic markers
#define SMOL_PRESSED_DATA_MAGIC_MARKER "__SMOL_PRESSED_DATA_MAGIC_MARKER"

// NODE_SEA fuse string (from Node.js)
#define NODE_SEA_FUSE_STRING "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
#define NODE_SEA_FUSE_UNFLIPPED "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:0"
#define NODE_SEA_FUSE_FLIPPED "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1"

#endif /* SEGMENT_NAMES_H */
