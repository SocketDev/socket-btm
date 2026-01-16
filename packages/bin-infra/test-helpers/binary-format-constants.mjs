/**
 * Binary format structure constants for parsing binary files in tests.
 *
 * These constants define the layout of binary format structures (Mach-O, ELF, PE)
 * to enable consistent parsing across test files without magic numbers.
 */

/* eslint-disable line-comment-position */

// ============================================================================
// Mach-O Constants
// ============================================================================

/**
 * Mach-O magic numbers
 */
export const MACHO_MAGIC = {
  MH_MAGIC: 0xfe_ed_fa_ce, // 32-bit little-endian
  MH_MAGIC_64: 0xfe_ed_fa_cf, // 64-bit little-endian
  MH_CIGAM: 0xce_fa_ed_fe, // 32-bit big-endian
  MH_CIGAM_64: 0xcf_fa_ed_fe, // 64-bit big-endian
}

/**
 * Mach-O load command types
 */
export const MACHO_LOAD_COMMAND = {
  LC_SEGMENT: 0x1, // 32-bit segment
  LC_SEGMENT_64: 0x19, // 64-bit segment
}

/**
 * Mach-O header offsets
 */
export const MACHO_HEADER_OFFSET = {
  MAGIC: 0,
  CPUTYPE: 4,
  CPUSUBTYPE: 8,
  FILETYPE: 12,
  NCMDS: 16, // Number of load commands
  SIZEOFCMDS: 20, // Size of all load commands
  FLAGS: 24,
  RESERVED_64: 28, // Only in 64-bit
}

/**
 * Mach-O header sizes
 */
export const MACHO_HEADER_SIZE = {
  HEADER_32: 28,
  HEADER_64: 32,
}

/**
 * Mach-O load command header offsets (common to all commands)
 */
export const MACHO_LOAD_COMMAND_OFFSET = {
  CMD: 0,
  CMDSIZE: 4,
}

/**
 * Mach-O LC_SEGMENT_64 offsets
 */
export const MACHO_LC_SEGMENT_64_OFFSET = {
  CMD: 0,
  CMDSIZE: 4,
  SEGNAME: 8, // 16 bytes
  VMADDR: 24,
  VMSIZE: 32,
  FILEOFF: 40,
  FILESIZE: 48,
  MAXPROT: 56,
  INITPROT: 60,
  NSECTS: 64,
  FLAGS: 68,
}

/**
 * Mach-O LC_SEGMENT offsets (32-bit)
 */
export const MACHO_LC_SEGMENT_OFFSET = {
  CMD: 0,
  CMDSIZE: 4,
  SEGNAME: 8, // 16 bytes
  VMADDR: 24,
  VMSIZE: 28,
  FILEOFF: 32,
  FILESIZE: 36,
  MAXPROT: 40,
  INITPROT: 44,
  NSECTS: 48,
  FLAGS: 52,
}

// ============================================================================
// ELF Constants
// ============================================================================

/**
 * ELF magic numbers
 */
export const ELF_MAGIC = {
  MAGIC_0: 0x7f,
  MAGIC_1: 0x45, // 'E'
  MAGIC_2: 0x4c, // 'L'
  MAGIC_3: 0x46, // 'F'
}

/**
 * ELF identification (e_ident) constants
 */
export const ELF_IDENT = {
  EI_CLASS: 4, // 1=32-bit, 2=64-bit
  EI_DATA: 5, // 1=little-endian, 2=big-endian
  EI_VERSION: 6,
  EI_OSABI: 7,
}

export const ELF_CLASS = {
  ELFCLASS32: 1,
  ELFCLASS64: 2,
}

export const ELF_DATA = {
  ELFDATA2LSB: 1, // Little-endian
  ELFDATA2MSB: 2, // Big-endian
}

/**
 * ELF header offsets (64-bit)
 */
export const ELF64_HEADER_OFFSET = {
  E_IDENT: 0, // 16 bytes
  E_TYPE: 16,
  E_MACHINE: 18,
  E_VERSION: 20,
  E_ENTRY: 24,
  E_PHOFF: 32, // Program header offset
  E_SHOFF: 40, // Section header offset
  E_FLAGS: 48,
  E_EHSIZE: 52, // ELF header size
  E_PHENTSIZE: 54, // Program header entry size
  E_PHNUM: 56, // Number of program headers
  E_SHENTSIZE: 58, // Section header entry size
  E_SHNUM: 60, // Number of section headers
  E_SHSTRNDX: 62, // Section header string table index
}

/**
 * ELF header offsets (32-bit)
 */
export const ELF32_HEADER_OFFSET = {
  E_IDENT: 0, // 16 bytes
  E_TYPE: 16,
  E_MACHINE: 18,
  E_VERSION: 20,
  E_ENTRY: 24,
  E_PHOFF: 28, // Program header offset
  E_SHOFF: 32, // Section header offset
  E_FLAGS: 36,
  E_EHSIZE: 40,
  E_PHENTSIZE: 42,
  E_PHNUM: 44,
  E_SHENTSIZE: 46,
  E_SHNUM: 48,
  E_SHSTRNDX: 50,
}

/**
 * ELF program header types
 */
export const ELF_PROGRAM_HEADER_TYPE = {
  PT_NULL: 0,
  PT_LOAD: 1,
  PT_DYNAMIC: 2,
  PT_INTERP: 3,
  PT_NOTE: 4, // Used for compressed data in binpress
  PT_SHLIB: 5,
  PT_PHDR: 6,
  PT_TLS: 7,
}

/**
 * ELF program header offsets (64-bit)
 */
export const ELF64_PROGRAM_HEADER_OFFSET = {
  P_TYPE: 0,
  P_FLAGS: 4,
  P_OFFSET: 8,
  P_VADDR: 16,
  P_PADDR: 24,
  P_FILESZ: 32,
  P_MEMSZ: 40,
  P_ALIGN: 48,
}

/**
 * ELF program header offsets (32-bit)
 */
export const ELF32_PROGRAM_HEADER_OFFSET = {
  P_TYPE: 0,
  P_OFFSET: 4,
  P_VADDR: 8,
  P_PADDR: 12,
  P_FILESZ: 16,
  P_MEMSZ: 20,
  P_FLAGS: 24,
  P_ALIGN: 28,
}

// ============================================================================
// PE Constants
// ============================================================================

/**
 * PE (DOS) magic numbers
 */
export const PE_MAGIC = {
  DOS_MAGIC: 0x5a_4d, // 'MZ'
  PE_SIGNATURE: 0x00_00_45_50, // 'PE\0\0'
}

/**
 * PE DOS header offsets
 */
export const PE_DOS_HEADER_OFFSET = {
  E_MAGIC: 0, // 'MZ'
  E_LFANEW: 0x3c, // Offset to PE header
}

/**
 * PE COFF header offsets (after PE signature)
 */
export const PE_COFF_HEADER_OFFSET = {
  MACHINE: 0,
  NUMBER_OF_SECTIONS: 2,
  TIME_DATE_STAMP: 4,
  POINTER_TO_SYMBOL_TABLE: 8,
  NUMBER_OF_SYMBOLS: 12,
  SIZE_OF_OPTIONAL_HEADER: 16,
  CHARACTERISTICS: 18,
}

/**
 * PE COFF header size
 */
export const PE_COFF_HEADER_SIZE = 20

/**
 * PE section header offsets
 */
export const PE_SECTION_HEADER_OFFSET = {
  NAME: 0, // 8 bytes
  VIRTUAL_SIZE: 8,
  VIRTUAL_ADDRESS: 12,
  SIZE_OF_RAW_DATA: 16,
  POINTER_TO_RAW_DATA: 20,
  POINTER_TO_RELOCATIONS: 24,
  POINTER_TO_LINENUMBERS: 28,
  NUMBER_OF_RELOCATIONS: 32,
  NUMBER_OF_LINENUMBERS: 34,
  CHARACTERISTICS: 36,
}

/**
 * PE section header size
 */
export const PE_SECTION_HEADER_SIZE = 40
