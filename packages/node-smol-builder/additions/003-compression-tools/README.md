# Binary Compression Tools

Native binary compression without antivirus false positives.

## Purpose

Cross-platform compression tools for smol binaries:
- 70-80% compression (better than UPX)
- No antivirus flags (native OS APIs)
- Code signing compatible

## Usage

### macOS (Mach-O)
```bash
socket_macho_compress input output --quality=lzma
```

### Linux (ELF)
```bash
socket_elf_compress input output --quality=lzma
```

### Windows (PE)
```bash
socket_pe_compress.exe input output --quality=lzms
```

## Building

Built automatically during `pnpm build` in node-smol-builder.

Output: `build/prod/Compressed/socket_*_compress`
