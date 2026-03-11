# stubs-builder Build System

This document describes the build system for stubs-builder, which creates self-extracting stub binaries.

## Quick Reference

```bash
pnpm run build           # Build stubs for current platform
pnpm run clean           # Clean build artifacts
pnpm test                # Run tests
```

## What are Stubs?

Stubs are small self-extracting loader binaries used by binpress. They:
- Decompress LZFSE-compressed payloads
- Load the decompressed binary into memory
- Execute the decompressed binary
- Support cross-platform targets

## Directory Structure

```
packages/stubs-builder/
├── src/                           # Stub source code
│   ├── stub_main.c                # Common entry point
│   ├── stub_darwin.c              # macOS-specific loader
│   ├── stub_linux.c               # Linux-specific loader
│   └── stub_windows.c             # Windows-specific loader
├── build/                         # Build output (gitignored)
│   ├── stub-darwin-arm64          # macOS ARM64 stub
│   ├── stub-darwin-x64            # macOS x64 stub
│   ├── stub-linux-x64             # Linux glibc stub
│   ├── stub-linux-x64-musl        # Linux musl stub
│   └── stub-win32-x64.exe         # Windows stub
├── Makefile.macos                 # macOS build rules
├── Makefile.linux                 # Linux build rules
├── Makefile.windows               # Windows build rules
└── scripts/build.mjs              # Build orchestrator
```

## Build Process

1. **Download curl** - Downloads prebuilt curl from releases (for HTTP support)
2. **Compile stubs** - Minimal C compilation for each target
3. **Strip binaries** - Remove symbols for smallest size
4. **Output to build/** - Platform-specific stub binaries

## Dependencies

### curl
HTTP client library for network operations. Downloaded from curl-builder releases.

### LZFSE
Apple's compression algorithm for decompression.

## Stub Targets

| Target | File | Description |
|--------|------|-------------|
| darwin-arm64 | `stub-darwin-arm64` | macOS Apple Silicon |
| darwin-x64 | `stub-darwin-x64` | macOS Intel |
| linux-x64 | `stub-linux-x64` | Linux glibc |
| linux-x64-musl | `stub-linux-x64-musl` | Linux Alpine/musl |
| win32-x64 | `stub-win32-x64.exe` | Windows 64-bit |

## Size Optimization

Stubs are optimized for minimal size:
- No C++ runtime
- No exceptions
- Static linking
- Aggressive `-Os` optimization
- Symbol stripping

Typical stub size: 50-100KB

## Integration with binpress

binpress embeds stubs during build:

```
binpress build
  └─ Embeds stubs from stubs-builder/build/
       └─ Creates self-extracting compressed binary
```

## Key Paths

| Path | Description |
|------|-------------|
| `build/stub-*` | Built stub binaries |
| `src/` | Stub source code |
| `../curl-builder/` | curl dependency |

## Testing

```bash
pnpm test                # Test stub decompression
```

## Cleaning

```bash
pnpm run clean           # Clean all stub binaries
```

## Troubleshooting

### curl not found
```bash
pnpm --filter curl-builder build
pnpm --filter stubs-builder build
```

### Stub too large
Ensure release build flags. Check for debug symbols with `nm` or `objdump`.

### Cross-compilation fails
Native builds only. CI builds cross-platform stubs.
