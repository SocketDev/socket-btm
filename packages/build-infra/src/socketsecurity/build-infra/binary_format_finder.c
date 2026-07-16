/**
 * Cross-platform section finders for ELF, PE, and Mach-O.
 *
 * Each finder is written to read as little of the file as possible:
 *   ELF: ELF header (64 B) + 1 section header per iteration + the
 *        per-section name bytes it needs from .shstrtab.
 *   PE:  DOS header (64 B) + PE signature & COFF header (24 B) +
 *        40 B per section header.
 *   Mach-O: mach_header + 1 load command at a time, skipping straight
 *           past anything that isn't LC_SEGMENT[_64].
 */

#include "socketsecurity/build-infra/binary_format_finder.h"

#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* Defensive caps so a malformed header can't make us loop forever or
 * allocate absurd buffers. Real binaries sit well below these. */
#define BF_MAX_ELF_SECTIONS 10000
#define BF_MAX_PE_SECTIONS 200
#define BF_MAX_MACHO_NCMDS 10000
#define BF_MAX_MACHO_NSECTS 1000

/* Helper: read N bytes from a fixed offset; return 0 on success, -1 else. */
static int read_at(FILE *fp, long offset, void *buf, size_t n) {
    if (fseek(fp, offset, SEEK_SET) != 0) {
        return -1;
    }
    return fread(buf, 1, n, fp) == n ? 0 : -1;
}

/*
 * ============================================================================
 * ELF
 * ============================================================================
 */

int bf_find_elf_section(FILE *fp,
                        const char *name,
                        int64_t *offset_out,
                        uint64_t *size_out) {
    if (!fp || !name || !offset_out || !size_out) {
        return -1;
    }

    /* e_ident is 16 B; bytes 0..3 = "\x7FELF", byte 4 = EI_CLASS. */
    unsigned char e_ident[16];
    if (read_at(fp, 0, e_ident, sizeof(e_ident)) != 0 ||
        e_ident[0] != 0x7F || e_ident[1] != 'E' ||
        e_ident[2] != 'L'  || e_ident[3] != 'F') {
        return -1;
    }
    const int is_64 = (e_ident[4] == 2);

    /* Section-table metadata offsets inside the ELF header:
     *   32-bit: e_shoff@32 (4), e_shentsize@46 (2), e_shnum@48 (2), e_shstrndx@50 (2)
     *   64-bit: e_shoff@40 (8), e_shentsize@58 (2), e_shnum@60 (2), e_shstrndx@62 (2)
     */
    uint64_t e_shoff;
    uint16_t e_shentsize, e_shnum, e_shstrndx;
    if (is_64) {
        if (read_at(fp, 40, &e_shoff, 8) != 0) {
            return -1;
        }
        unsigned char tail[6];
        if (read_at(fp, 58, tail, sizeof(tail)) != 0) {
            return -1;
        }
        memcpy(&e_shentsize, tail + 0, 2);
        memcpy(&e_shnum,     tail + 2, 2);
        memcpy(&e_shstrndx,  tail + 4, 2);
    } else {
        uint32_t shoff32;
        if (read_at(fp, 32, &shoff32, 4) != 0) {
            return -1;
        }
        e_shoff = shoff32;
        unsigned char tail[6];
        if (read_at(fp, 46, tail, sizeof(tail)) != 0) {
            return -1;
        }
        memcpy(&e_shentsize, tail + 0, 2);
        memcpy(&e_shnum,     tail + 2, 2);
        memcpy(&e_shstrndx,  tail + 4, 2);
    }

    if (e_shnum == 0 || e_shnum > BF_MAX_ELF_SECTIONS ||
        e_shstrndx >= e_shnum || e_shentsize < 40) {
        return -1;
    }

    /* Read the string-table section header to get its file offset. */
    const long strtab_hdr = (long)(e_shoff + (uint64_t)e_shstrndx * e_shentsize);
    uint64_t strtab_offset;
    if (is_64) {
        /* sh_offset @ +24 (8 B). */
        if (read_at(fp, strtab_hdr + 24, &strtab_offset, 8) != 0) {
            return -1;
        }
    } else {
        uint32_t off32;
        /* sh_offset @ +16 (4 B). */
        if (read_at(fp, strtab_hdr + 16, &off32, 4) != 0) {
            return -1;
        }
        strtab_offset = off32;
    }

    /* Compare target name to each section's name without slurping the
     * whole string table. A .PRESSED_DATA name is 14 bytes; any real
     * section name we care about is well under 256. */
    const size_t name_len = strlen(name);
    if (name_len == 0 || name_len > 255) {
        return -1;
    }
    char sec_name[256];

    for (uint16_t i = 0; i < e_shnum; i++) {
        const long shdr = (long)(e_shoff + (uint64_t)i * e_shentsize);

        /* sh_name is the first 4 B of every section header. */
        uint32_t sh_name;
        if (read_at(fp, shdr, &sh_name, 4) != 0) {
            return -1;
        }

        /* Read name_len+1 bytes (need to see the null terminator to confirm
         * it's not a prefix match of a longer name). */
        if (read_at(fp, (long)(strtab_offset + sh_name),
                    sec_name, name_len + 1) != 0) {
            continue;
        }
        if (sec_name[name_len] != '\0' ||
            memcmp(sec_name, name, name_len) != 0) {
            continue;
        }

        /* Name hit: read sh_offset and sh_size. */
        uint64_t sh_offset, sh_size;
        if (is_64) {
            /* sh_offset @ +24 (8 B), sh_size @ +32 (8 B). */
            if (read_at(fp, shdr + 24, &sh_offset, 8) != 0 ||
                read_at(fp, shdr + 32, &sh_size,   8) != 0) {
                return -1;
            }
        } else {
            uint32_t o32, s32;
            /* sh_offset @ +16 (4 B), sh_size @ +20 (4 B). */
            if (read_at(fp, shdr + 16, &o32, 4) != 0 ||
                read_at(fp, shdr + 20, &s32, 4) != 0) {
                return -1;
            }
            sh_offset = o32;
            sh_size   = s32;
        }
        *offset_out = (int64_t)sh_offset;
        *size_out   = sh_size;
        return 0;
    }
    return -1;
}

/*
 * ============================================================================
 * PE
 * ============================================================================
 */

int bf_find_pe_section(FILE *fp,
                       const char name8[8],
                       int64_t *offset_out,
                       uint32_t *size_out) {
    if (!fp || !name8 || !offset_out || !size_out) {
        return -1;
    }

    /* DOS header: "MZ" @ 0, e_lfanew (PE offset) @ 0x3C. */
    unsigned char dos_header[64];
    if (read_at(fp, 0, dos_header, sizeof(dos_header)) != 0 ||
        dos_header[0] != 'M' || dos_header[1] != 'Z') {
        return -1;
    }
    uint32_t pe_offset;
    memcpy(&pe_offset, dos_header + 0x3C, 4);

    /* PE signature "PE\0\0" (4 B) + COFF header (20 B) = 24 B. */
    unsigned char pe_header[24];
    if (read_at(fp, (long)pe_offset, pe_header, sizeof(pe_header)) != 0 ||
        pe_header[0] != 'P' || pe_header[1] != 'E' ||
        pe_header[2] != 0   || pe_header[3] != 0) {
        return -1;
    }

    /* COFF header starts at pe_header + 4.
     *   NumberOfSections:     +2  (2 B)
     *   SizeOfOptionalHeader: +16 (2 B)
     */
    uint16_t nsections, opt_hdr_size;
    memcpy(&nsections,    pe_header + 4 + 2,  2);
    memcpy(&opt_hdr_size, pe_header + 4 + 16, 2);
    if (nsections == 0 || nsections > BF_MAX_PE_SECTIONS) {
        return -1;
    }

    /* Section table follows the optional header.
     * PE section header is 40 B:
     *   Name:           +0  (8 B, null-padded)
     *   SizeOfRawData:  +16 (4 B)
     *   PointerToRawData:+20 (4 B)
     */
    const long sect_table = (long)pe_offset + 24 + opt_hdr_size;
    unsigned char row[40];
    for (uint16_t i = 0; i < nsections; i++) {
        if (read_at(fp, sect_table + i * 40, row, sizeof(row)) != 0) {
            return -1;
        }
        if (memcmp(row, name8, 8) != 0) {
            continue;
        }
        uint32_t raw_size, raw_ptr;
        memcpy(&raw_size, row + 16, 4);
        memcpy(&raw_ptr,  row + 20, 4);
        *offset_out = (int64_t)raw_ptr;
        *size_out   = raw_size;
        return 0;
    }
    return -1;
}

/*
 * ============================================================================
 * Mach-O
 * ============================================================================
 */

/* Mach-O magic values — avoid a mach/loader.h dependency so this compiles
 * cleanly when cross-building. */
#define BF_MH_MAGIC     0xFEEDFACEu
#define BF_MH_CIGAM     0xCEFAEDFEu
#define BF_MH_MAGIC_64  0xFEEDFACFu
#define BF_MH_CIGAM_64  0xCFFAEDFEu
#define BF_LC_SEGMENT     0x1u
#define BF_LC_SEGMENT_64  0x19u

/* Copy up to 16 bytes from src into a fixed 16-byte slot, null-pad tail. */
static void pad_name16(const char *src, char dst[16]) {
    const size_t n = strnlen(src, 16);
    memcpy(dst, src, n);
    if (n < 16) {
        memset(dst + n, 0, 16 - n);
    }
}

int bf_find_macho_section(FILE *fp,
                          const char *segname,
                          const char *sectname,
                          int64_t *offset_out,
                          uint64_t *size_out) {
    if (!fp || !segname || !sectname || !offset_out || !size_out) {
        return -1;
    }

    /* Read magic + 12 more bytes so we get ncmds @ +16 (both 32/64 bit). */
    uint32_t header[6];
    if (read_at(fp, 0, header, sizeof(header)) != 0) {
        return -1;
    }
    const uint32_t magic = header[0];
    int is_64;
    if (magic == BF_MH_MAGIC_64 || magic == BF_MH_CIGAM_64) {
        is_64 = 1;
    } else if (magic == BF_MH_MAGIC || magic == BF_MH_CIGAM) {
        is_64 = 0;
    } else {
        return -1;
    }
    const uint32_t ncmds = header[4];
    if (ncmds == 0 || ncmds > BF_MAX_MACHO_NCMDS) {
        return -1;
    }

    /* Pad target names to 16 B for exact memcmp against on-disk records. */
    char want_seg[16], want_sect[16];
    pad_name16(segname,  want_seg);
    pad_name16(sectname, want_sect);

    /* First load command starts right after the header. */
    const long first_cmd = is_64 ? 32 : 28;
    /* After segname (16 B), the segment_command has offsets we don't need
     * to parse here; we just skip to nsects.
     *   32-bit LC_SEGMENT:    segname(16) + vmaddr(4) + vmsize(4) + fileoff(4) +
     *                         filesize(4) + maxprot(4) + initprot(4) = 16+24 B
     *                         then nsects(4)
     *   64-bit LC_SEGMENT_64: segname(16) + vmaddr(8) + vmsize(8) + fileoff(8) +
     *                         filesize(8) + maxprot(4) + initprot(4) = 16+40 B
     *                         then nsects(4)
     */
    const long nsects_skip = is_64 ? 40 : 24;
    /* Size of a section record following the segment header:
     *   section   (32-bit): sectname(16) + segname(16) + addr(4) + size(4) +
     *                       offset(4) + align(4) + reloff(4) + nreloc(4) +
     *                       flags(4) + reserved1(4) + reserved2(4) = 68 B
     *   section_64:         sectname(16) + segname(16) + addr(8) + size(8) +
     *                       offset(4) + align(4) + reloff(4) + nreloc(4) +
     *                       flags(4) + reserved1(4) + reserved2(4) + reserved3(4)
     *                       = 80 B
     * We already read sectname(16), so the "rest" skip is 68-16 = 52 or 80-16 = 64.
     * And the fields we want (offset, size) sit at known offsets from sectname
     * start — see reads below. */
    long cmd_pos = first_cmd;
    for (uint32_t i = 0; i < ncmds; i++) {
        uint32_t cmd_hdr[2]; /* cmd, cmdsize */
        if (read_at(fp, cmd_pos, cmd_hdr, sizeof(cmd_hdr)) != 0) {
            return -1;
        }
        const uint32_t cmd     = cmd_hdr[0];
        const uint32_t cmdsize = cmd_hdr[1];
        if (cmdsize < 8 || cmdsize > (uint32_t)0x7FFFFFFF) {
            return -1;
        }

        const uint32_t want_seg_cmd = is_64 ? BF_LC_SEGMENT_64 : BF_LC_SEGMENT;
        if (cmd == want_seg_cmd) {
            char on_disk_seg[16];
            if (read_at(fp, cmd_pos + 8, on_disk_seg, 16) != 0) {
                return -1;
            }
            if (memcmp(on_disk_seg, want_seg, 16) == 0) {
                /* Jump to nsects (right after the segment-specific fields). */
                uint32_t nsects;
                if (read_at(fp, cmd_pos + 8 + 16 + nsects_skip,
                            &nsects, sizeof(nsects)) != 0) {
                    return -1;
                }
                if (nsects > BF_MAX_MACHO_NSECTS) {
                    return -1;
                }
                /* Sections begin after nsects(4) + flags(4) = 8 B. */
                const long sect0 = cmd_pos + 8 + 16 + nsects_skip + 8;
                const long sect_size = is_64 ? 80 : 68;
                for (uint32_t j = 0; j < nsects; j++) {
                    const long sect_pos = sect0 + j * sect_size;
                    char on_disk_sect[16];
                    if (read_at(fp, sect_pos, on_disk_sect, 16) != 0) {
                        return -1;
                    }
                    if (memcmp(on_disk_sect, want_sect, 16) != 0) {
                        continue;
                    }
                    /* Match. Read size and offset.
                     * 32-bit section:  addr@32, size@36, offset@40
                     * 64-bit section_64: addr@32, size@40, offset@48
                     */
                    uint64_t size_val;
                    uint32_t off_val;
                    if (is_64) {
                        if (read_at(fp, sect_pos + 40, &size_val, 8) != 0 ||
                            read_at(fp, sect_pos + 48, &off_val,  4) != 0) {
                            return -1;
                        }
                    } else {
                        uint32_t s32;
                        if (read_at(fp, sect_pos + 36, &s32,      4) != 0 ||
                            read_at(fp, sect_pos + 40, &off_val,  4) != 0) {
                            return -1;
                        }
                        size_val = s32;
                    }
                    *offset_out = (int64_t)off_val;
                    *size_out   = size_val;
                    return 0;
                }
                /* SMOL segment found but section missing — no reason to
                 * check other load commands, but keep scanning in case a
                 * future binary has multiple SMOL segments (unusual). */
            }
        }
        cmd_pos += (long)cmdsize;
    }
    return -1;
}
