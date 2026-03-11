# binject Build System

This document describes the build system for binject, the binary injection tool.

## Quick Reference

```bash
pnpm run build           # Build for current platform
pnpm run clean           # Clean build artifacts
pnpm test                # Run tests
```

## What is binject?

binject is a cross-platform binary injection tool that:
- Injects SEA (Single Executable Application) resources into binaries
- Injects VFS (Virtual File System) archives into binaries
- Supports Mach-O (macOS), ELF (Linux), and PE (Windows) formats
- Uses LIEF library for binary manipulation

## Directory Structure

```
packages/binject/
├── src/socketsecurity/binject/    # Source code
│   ├── main.c                     # Entry point
│   ├── binject.c                  # Core injection logic
│   ├── macho_inject_lief.cpp      # Mach-O injection (LIEF)
│   ├── elf_inject_lief.cpp        # ELF injection (LIEF)
│   ├── pe_inject_lief.cpp         # PE injection (LIEF)
│   └── ...
├── build/                         # Build output (gitignored)
│   ├── *.o                        # Object files
│   └── binject                    # Built binary
├── bin/                           # Final binary location
│   └── binject
├── test/                          # Test files
├── upstream/                      # Vendored dependencies
│   └── cJSON/                     # JSON parser
├── Makefile.macos                 # macOS build rules
├── Makefile.linux                 # Linux build rules
├── Makefile.windows               # Windows build rules
└── scripts/build.mjs              # Build orchestrator
```

## Build Process

The build uses platform-specific Makefiles orchestrated by `scripts/build.mjs`:

1. **Download LIEF** - Downloads prebuilt LIEF from releases
2. **Compile sources** - C and C++ compilation
3. **Link binary** - Links with LIEF static library
4. **Sign binary** - (macOS) Ad-hoc code signing

## Dependencies

### LIEF Library
LIEF is downloaded automatically from GitHub releases during build. It provides:
- Binary format parsing (Mach-O, ELF, PE)
- Section/segment manipulation
- Code signing removal (macOS)

### cJSON
Vendored in `upstream/cJSON/` for JSON configuration parsing.

### bin-infra / build-infra
Shared infrastructure packages providing common utilities.

## Platform-Specific Builds

| Platform | Makefile | Compiler | Output |
|----------|----------|----------|--------|
| macOS | `Makefile.macos` | clang/clang++ | `bin/binject` |
| Linux | `Makefile.linux` | gcc/g++ | `bin/binject` |
| Windows | `Makefile.windows` | cl.exe | `bin/binject.exe` |

## Build Flags

```makefile
CFLAGS = -Wall -Wextra -O2 -std=c11
CXXFLAGS = -Wall -Wextra -O2 -std=c++17 -fno-exceptions
```

C++17 is required for LIEF integration. Exceptions are disabled for smaller binary size.

## Key Paths

| Path | Description |
|------|-------------|
| `bin/binject` | Built binary |
| `build/*.o` | Object files |
| `src/socketsecurity/binject/` | Source files |
| `upstream/cJSON/` | Vendored JSON parser |
| `../lief-builder/` | LIEF dependency |

## Testing

```bash
pnpm test                # Run all tests
make -f Makefile.macos test  # Run tests via Make
```

## Cleaning

```bash
pnpm run clean           # Clean via build script
make -f Makefile.macos clean  # Clean via Make
```

## Troubleshooting

### LIEF not found
```bash
pnpm run clean
pnpm run build           # Re-downloads LIEF
```

### Linker errors
Ensure C++17 support. Update compiler if needed.

### Code signing fails (macOS)
The build uses ad-hoc signing. No Apple Developer certificate required.
