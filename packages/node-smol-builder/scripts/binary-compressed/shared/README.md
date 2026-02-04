# Binary Compressed Checkpoint

This checkpoint phase handles binary compression after stripping debug symbols.

## External Tools

Tool dependencies for this phase are declared in `external-tools.json`:

- **gcc/g++**: C compiler for building platform-specific compression tools
- **make**: Build system for compiling compression tools
- **libssl-dev** (Linux only): OpenSSL library for SHA-512 hash calculation in decompressor

### Version Management

All tool versions are pinned in `external-tools.json` to ensure reproducible builds across environments:
- Local development
- CI/CD (GitHub Actions)
- Production builds

When updating versions, update both:
1. `external-tools.json` (source of truth)
2. GitHub Actions workflow (`.github/workflows/node-smol.yml`)

### Platform-Specific Dependencies

#### Linux
- `libssl-dev=3.0.2-*` - OpenSSL for static linking (SHA-512 hashing)
- LZFSE compression library is compiled from upstream/lzfse submodule

#### macOS
- Uses system Compression framework (no external deps)
- Requires Xcode Command Line Tools

#### Windows
- Uses Windows Compression API (no external deps)
- Requires MinGW with gcc
