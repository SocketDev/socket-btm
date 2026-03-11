# binpress Build System

This document describes the build system for binpress, the binary compression tool.

## Quick Reference

```bash
pnpm run build           # Build for current platform
pnpm run clean           # Clean build artifacts
pnpm test                # Run tests
```

## What is binpress?

binpress is a binary compression tool that:
- Compresses executables using LZFSE algorithm
- Creates self-extracting binaries
- Embeds stub loaders that decompress at runtime
- Supports Mach-O (macOS), ELF (Linux), and PE (Windows)

## Directory Structure

```
packages/binpress/
├── src/socketsecurity/binpress/   # Source code
│   ├── main.c                     # Entry point
│   ├── binpress.c                 # Core compression logic
│   ├── macho_press.cpp            # Mach-O compression
│   ├── elf_press.cpp              # ELF compression
│   ├── pe_press.cpp               # PE compression
│   └── ...
├── build/                         # Build output (gitignored)
│   ├── *.o                        # Object files
│   └── binpress                   # Built binary
├── bin/                           # Final binary location
│   └── binpress
├── test/                          # Test files
├── Makefile.macos                 # macOS build rules
├── Makefile.linux                 # Linux build rules
├── Makefile.windows               # Windows build rules
└── scripts/build.mjs              # Build orchestrator
```

## Build Process

1. **Download LIEF** - Downloads prebuilt LIEF from releases
2. **Embed stubs** - Stub binaries from stubs-builder are embedded
3. **Compile sources** - C and C++ compilation
4. **Link binary** - Links with LIEF and LZFSE

## Dependencies

### LIEF Library
For binary format manipulation (same as binject).

### Stubs
Stub binaries from `stubs-builder` are embedded into binpress. These are the self-extracting loaders.

### LZFSE
Apple's compression algorithm. Used for high-ratio compression with fast decompression.

## Compression Pipeline

```
Input Binary → LZFSE Compress → Embed in Stub → Self-Extracting Binary
```

At runtime:
```
Self-Extracting Binary → Decompress to memory → Execute
```

## Platform-Specific Builds

| Platform | Makefile | Output |
|----------|----------|--------|
| macOS | `Makefile.macos` | `bin/binpress` |
| Linux | `Makefile.linux` | `bin/binpress` |
| Windows | `Makefile.windows` | `bin/binpress.exe` |

## Key Paths

| Path | Description |
|------|-------------|
| `bin/binpress` | Built binary |
| `build/*.o` | Object files |
| `src/socketsecurity/binpress/` | Source files |
| `../stubs-builder/build/` | Stub binaries (embedded) |
| `../lief-builder/` | LIEF dependency |

## Testing

```bash
pnpm test                # Run compression/decompression tests
```

## Cleaning

```bash
pnpm run clean           # Clean build artifacts
```

## Troubleshooting

### Stubs not found
Build stubs-builder first:
```bash
pnpm --filter stubs-builder build
pnpm --filter binpress build
```

### Compression ratio poor
LZFSE works best on binaries with debug symbols stripped. Use `strip` first.
