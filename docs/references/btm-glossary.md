# BTM Glossary

## Binary formats

- **Mach-O**: macOS/iOS executable format
- **ELF**: Linux executable format
- **PE**: Windows executable format

## Build concepts

- **Checkpoint**: Cached snapshot of build progress for incremental builds
- **Cache Version**: Version in `.github/cache-versions.json` that invalidates CI caches
- **Upstream**: Original Node.js source before patches

## Node.js customization

- **SEA**: Single Executable Application (standalone with runtime + app code)
- **VFS**: Virtual File System embedded inside a binary
- **Additions Directory**: Code embedded into Node.js during build

### `node:smol-*` modules

All require the `node:` prefix. Available: `node:smol-ffi`, `node:smol-http`, `node:smol-https`, `node:smol-ilp`, `node:smol-manifest`, `node:smol-power`, `node:smol-primordial`, `node:smol-purl`, `node:smol-sql`, `node:smol-util`, `node:smol-versions`, `node:smol-vfs`.

## Binary manipulation

- **Binary Injection**: Inserting data into compiled binary without recompilation
- **Section/Segment**: Named regions in executables
- **LIEF**: Library for reading/modifying executable formats

## Compression

- **zstd**: Zstandard compression (fast decompression ~1.5 GB/s, good ratio)
- **Stub Binary**: Small executable that decompresses and runs main binary

## Cross-platform

- **musl**: Lightweight C library for Alpine Linux (vs glibc on most distros)
- **Universal Binary**: macOS binary with ARM64 + x64 code

## Package names

### Core binary-injection suite

- **binject**: Injects data into binaries (SEA resources, VFS archives)
- **binpress**: Compresses binaries (zstd)
- **binflate**: Decompresses binaries
- **stubs-builder**: Builds self-extracting stub binaries

### Infrastructure (canonical TypeScript helpers, mirrored under additions/source-patched/)

- **build-infra**: Cross-package build helpers (checkpoint-manager, platform-mappings, release-checksums, docker-builder)
- **bin-infra**: Binary-manipulation helpers (zstd bindings, compression utilities)

### Custom Node.js

- **node-smol-builder**: Builds custom Node.js binary with Socket patches — provides the `node:smol-*` built-in modules (`smol-ffi`, `smol-http`, `smol-https`, `smol-ilp`, `smol-manifest`, `smol-purl`, `smol-sql`, `smol-versions`, `smol-vfs`)

### Native library builders (each produces a shared/static library consumed by node-smol or stubs)

- **curl-builder**: Builds libcurl + mbedTLS (used by stubs for HTTP)
- **lief-builder**: Builds LIEF (used by binject for Mach-O/ELF/PE manipulation)
- **libpq-builder**: Builds libpq (PostgreSQL client, used by node:smol-sql)

### Native Node.js addons (each produces a `.node` binary)

- **opentui-builder**: Zig → .node; terminal UI layer
- **yoga-layout-builder**: Yoga Layout → WASM; flexbox primitives consumed by opentui
- **napi-go**: Go → .node framework; source-distributed N-API binding infrastructure (the napi-rs analog for Go)
- **ultraviolet-builder**: Go → .node via napi-go; Charmbracelet Ultraviolet — kitty/fixterms/SGR terminal decoder (Bubble Tea v2 foundation)

### ML/models

- **onnxruntime-builder**: Builds ONNX Runtime → WASM
- **codet5-models-builder**, **minilm-builder**, **models**: Model pipeline (downloads → converts → quantizes → optimizes)
