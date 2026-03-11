# lief-builder Build System

This document describes the build system for lief-builder, which builds the LIEF binary analysis library.

## Quick Reference

```bash
pnpm run build           # Build LIEF for current platform
pnpm run clean           # Clean build artifacts
```

## What is LIEF?

LIEF (Library to Instrument Executable Formats) provides:
- Parsing and modifying Mach-O binaries (macOS)
- Parsing and modifying ELF binaries (Linux)
- Parsing and modifying PE binaries (Windows)
- Section/segment manipulation
- Code signing operations

## Directory Structure

```
packages/lief-builder/
├── upstream/
│   ├── lief/                      # Git submodule (lief-project/LIEF)
│   └── lzfse/                     # Git submodule (Apple's LZFSE)
├── build/                         # Build output (gitignored)
│   ├── lief/                      # LIEF build artifacts
│   └── lib/                       # Static libraries
│       └── libLIEF.a
├── include/                       # Headers for consumers
│   └── LIEF/
├── make/                          # Make include files
│   └── lief.mk                    # LIEF flags for consumers
└── scripts/build.mjs              # Build orchestrator
```

## Build Process

1. **Configure CMake** - LIEF with custom options
2. **Build LIEF** - Static library (C++ with C API)
3. **Build LZFSE** - Compression support
4. **Install headers** - Copy to include/

## Dependencies

### CMake
Build system for LIEF.

### LZFSE
Apple's compression algorithm, used by LIEF for Mach-O compression.

## Build Configuration

LIEF is built with:
- Static library only (no shared)
- C API enabled
- Mach-O, ELF, PE support
- No Python bindings
- No examples

## Platform-Specific Builds

| Platform | Output |
|----------|--------|
| macOS | `build/lib/libLIEF.a` |
| Linux | `build/lib/libLIEF.a` |
| Windows | `build/lib/LIEF.lib` |

## Key Paths

| Path | Description |
|------|-------------|
| `build/lib/libLIEF.a` | LIEF static library |
| `include/LIEF/` | LIEF headers |
| `make/lief.mk` | Make include for consumers |
| `upstream/lief/` | LIEF submodule |
| `upstream/lzfse/` | LZFSE submodule |

## Consumers

LIEF is used by:
- **binject** - Binary injection
- **binpress** - Binary compression
- **binflate** - Binary extraction
- **bin-infra** - Shared LIEF utilities

## Consumer Integration

Consumers include `make/lief.mk` in their Makefiles:
```makefile
include ../lief-builder/make/lief.mk

CFLAGS += $(LIEF_CFLAGS)
LDFLAGS += $(LIEF_LDFLAGS)
```

## Updating

LIEF version is tied to Node.js deps:
```bash
# Check Node.js LIEF version
ls packages/node-smol-builder/upstream/node/deps/LIEF/

# Use updating-lief skill for updates
```

## Cleaning

```bash
pnpm run clean           # Clean build artifacts
```

## Troubleshooting

### CMake version too old
LIEF requires CMake 3.16+. Update CMake.

### C++17 errors
LIEF requires C++17. Update compiler.

### Large build output
LIEF builds are large (~100MB objects). This is normal.

### API changes after update
LIEF API changes between versions. Use `updating-lief` skill which includes API audit.
