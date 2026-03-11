# binflate Build System

This document describes the build system for binflate, the binary decompression/extraction tool.

## Quick Reference

```bash
pnpm run build           # Build for current platform
pnpm run clean           # Clean build artifacts
pnpm test                # Run tests
```

## What is binflate?

binflate is a binary extraction and decompression tool that:
- Extracts VFS archives from binaries
- Decompresses LZFSE-compressed binaries
- Extracts SEA resources from executables
- Supports Mach-O (macOS), ELF (Linux), and PE (Windows)

binflate is the inverse of binject/binpress - it extracts what they inject.

## Directory Structure

```
packages/binflate/
├── src/socketsecurity/binflate/   # Source code
│   ├── main.c                     # Entry point
│   ├── binflate.c                 # Core extraction logic
│   ├── macho_extract.cpp          # Mach-O extraction
│   ├── elf_extract.cpp            # ELF extraction
│   ├── pe_extract.cpp             # PE extraction
│   └── ...
├── build/                         # Build output (gitignored)
│   ├── *.o                        # Object files
│   └── binflate                   # Built binary
├── bin/                           # Final binary location
│   └── binflate
├── test/                          # Test files
├── Makefile.macos                 # macOS build rules
├── Makefile.linux                 # Linux build rules
├── Makefile.windows               # Windows build rules
└── scripts/build.mjs              # Build orchestrator
```

## Build Process

1. **Download LIEF** - Downloads prebuilt LIEF from releases
2. **Compile sources** - C and C++ compilation
3. **Link binary** - Links with LIEF and LZFSE

## Dependencies

### LIEF Library
For binary format parsing and section extraction.

### LZFSE
For decompressing LZFSE-compressed payloads.

## Use Cases

### Extract VFS Archive
```bash
binflate --extract-vfs input.exe output.tar.gz
```

### Decompress Binary
```bash
binflate --decompress compressed.exe original.exe
```

### Extract SEA Resources
```bash
binflate --extract-sea node.exe resources/
```

## Platform-Specific Builds

| Platform | Makefile | Output |
|----------|----------|--------|
| macOS | `Makefile.macos` | `bin/binflate` |
| Linux | `Makefile.linux` | `bin/binflate` |
| Windows | `Makefile.windows` | `bin/binflate.exe` |

## Key Paths

| Path | Description |
|------|-------------|
| `bin/binflate` | Built binary |
| `build/*.o` | Object files |
| `src/socketsecurity/binflate/` | Source files |
| `../lief-builder/` | LIEF dependency |

## Testing

```bash
pnpm test                # Run extraction tests
```

## Cleaning

```bash
pnpm run clean           # Clean build artifacts
```

## Troubleshooting

### Extraction fails
Ensure input binary was created by binject/binpress. Generic binaries may not have expected sections.

### LIEF errors
Update LIEF via:
```bash
pnpm --filter lief-builder build
pnpm --filter binflate build
```
