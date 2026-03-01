# build-infra

Shared build infrastructure for building third-party dependencies from source.

Used by: node-smol-builder, onnxruntime-builder, yoga-layout-builder, binject, binflate, binpress, and model builders.

## Key Modules

### Build Pipeline
- `checkpoint-manager` - Build stage checkpoints and caching
- `build-env` - Environment variable setup and detection
- `build-helpers` - File system and environment utilities
- `build-output` - Formatted build output
- `preflight-checks` - Pre-build validation

### Builders
- `cmake-builder` - CMake-based builds (Node.js, ONNX Runtime)
- `rust-builder` - Rust/Cargo builds
- `emscripten-builder` - WebAssembly builds via Emscripten
- `docker-builder` - Cross-platform Docker builds
- `clean-builder` - Clean build artifacts

### Tool Installation
- `compiler-installer` - GCC, Clang, MSVC installation
- `emscripten-installer` - Emscripten SDK setup
- `python-installer` - Python runtime installation
- `tool-installer` - Generic tool download and caching

### Build Configuration
- `constants` - Build stages, size limits, byte conversions
- `path-builder` - Standard directory structure
- `platform-mappings` - Platform/arch/libc detection and mapping
- `pinned-versions` - Version pinning for reproducible builds
- `cache-key` - Cache key generation for CI

### External Dependencies
- `lzfse-init` - LZFSE compression library setup
- `libdeflate-init` - libdeflate compression library setup
- `github-releases` - GitHub releases API client

### Build Utilities
- `script-runner` - Execute build scripts
- `python-runner` - Execute Python scripts
- `check-tools` - Verify tool availability
- `install-tools` - Install build tools
- `setup-build-toolchain` - Complete toolchain setup
- `sign` - Code signing for macOS binaries
- `tarball-utils` - Tarball extraction and manipulation
- `download-with-progress` - Download with progress bars

### WASM Pipeline
- `wasm-pipeline` - WebAssembly build orchestration
- `wasm-helpers` - WASM-specific utilities
- `onnx-helpers` - ONNX Runtime build helpers
- `wasm-synced/generate-sync-phase` - Generate synchronous WASM wrappers
- `wasm-synced/wasm-sync-wrapper` - Synchronous wrapper runtime

### Testing
- `lib/test/` - Test utilities for WASM build validation
- Includes helpers for testing compressed WASM builds

### CI/CD
- `ci-cleanup-paths` - CI artifact cleanup
- `extraction-cache` - Artifact extraction caching
- `local-build-setup` - Local development setup
- `version-helpers` - Version parsing and comparison

### Patches
- `patch-validator` - Node.js patch validation

## C Header Files

Located in `src/socketsecurity/build-infra/`:

- `dlx_cache_common.h` - DLX cache implementation for self-extracting stubs
- `debug_common.h` - Debug logging and error handling
- `tmpdir_common.h` - Temporary directory management
- `file_io_common.h` - Low-level file I/O operations
- `file_utils.h` - High-level file system utilities
- `gzip_compress.h` - gzip compression utilities
- `tar_create.h` - TAR archive creation
- `path_utils.h` - Cross-platform path manipulation utilities
- `posix_compat.h` - POSIX compatibility layer for Windows
- `process_exec.h` - Process execution utilities

These headers are used by:
- Self-extracting stubs (binpress output)
- node-smol-builder (embedded into Node.js binary)
- Binary tools (binject, binflate)

## Scripts

- `setup-docker-builds.mjs` - Docker build environment setup
- `build-docker.mjs` - Execute Docker builds
- `get-checkpoint-chain.mjs` - List checkpoint dependencies
- `get-tool-version.mjs` - Query installed tool versions
- `smoke-test-binary.mjs` - Basic binary validation

Run with:
```bash
pnpm run setup:docker     # Setup Docker builds
pnpm run build:docker     # Run Docker builds
pnpm run docker:status    # Check Docker status
```

## Documentation

- [Caching Strategy](docs/caching-strategy.md) - DLX cache structure, key generation, and validation

## License

MIT
