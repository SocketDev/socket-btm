# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## Overview

Socket BTM is a monorepo containing build infrastructure for:
- **Binary Tools** - Custom C/C++ tools for binary manipulation
- **Node.js** - Custom Node.js binaries with Socket security patches
- **WASM** - ONNX Runtime and Yoga Layout WebAssembly builds
- **ML Models** - Quantized AI models for code analysis

```mermaid
graph TD
    subgraph Binary Tools
        binject[binject<br/>Binary Injection]
        binpress[binpress<br/>Compression]
        binflate[binflate<br/>Decompression]
    end

    subgraph Node.js
        node[node-smol<br/>Custom Node v24]
        patches[Socket Patches]
        node --> patches
    end

    subgraph WASM
        onnx[ONNX Runtime<br/>ML Inference]
        yoga[Yoga Layout<br/>Flexbox]
    end

    subgraph ML Models
        codet5[CodeT5<br/>Code Analysis]
    end

    subgraph Build Infrastructure
        checkpoint[Checkpoint System]
        infra[build-infra]
    end

    binject --> node
    binpress --> node
    binflate --> node
    checkpoint --> binject
    checkpoint --> node
    checkpoint --> onnx
    checkpoint --> yoga
    checkpoint --> codet5
    infra --> checkpoint


## Getting Started

### Prerequisites

Before building, ensure you have the required system dependencies installed:
- **Build Tools**: Xcode CLI Tools (macOS), GCC/Build Essential (Linux), Visual Studio Build Tools (Windows)
- **Python 3.11+**: For ML model building
- **Node.js 18+**: For build scripts and infrastructure
- **pnpm**: Package manager

See [Prerequisites Guide](packages/build-infra/docs/prerequisites.md) for detailed platform-specific setup instructions.

### Quick Start

**What do you want to build?**

```mermaid
graph LR
    Start[Start Here] --> Choice{What to build?}
    Choice -->|Binary Tools| BinTools[make in binject/binpress/binflate]
    Choice -->|Node.js| Node[pnpm build in node-smol-builder]
    Choice -->|WASM| WASM[pnpm build in onnxruntime/yoga]
    Choice -->|ML Models| Models[pnpm build in codet5-models-builder]

    Node -.requires.-> BinTools
```

**For all builds:**
```bash
pnpm install                    # Install dependencies first
```

**Binary tools (binject, binpress, binflate):**
```bash
cd packages/binject && make && cd ../..
cd packages/binpress && make && cd ../..
cd packages/binflate && make && cd ../..
```

**Node.js custom binary:**
```bash
cd packages/node-smol-builder && pnpm build
```

**WASM builds:**
```bash
cd packages/onnxruntime-builder && pnpm build  # ONNX Runtime
cd packages/yoga-layout-builder && pnpm build  # Yoga Layout
```

**ML models:**
```bash
cd packages/codet5-models-builder && pnpm build
```

## Packages

### Binary Tools

Core C/C++ tools for binary manipulation:

- **[binject](packages/binject/)** - Binary resource injection for Mach-O, ELF, and PE
- **[binpress](packages/binpress/)** - Binary compression with platform-specific algorithms
- **[binflate](packages/binflate/)** - Binary decompression and self-extraction

### Build Infrastructure

- **[build-infra](packages/build-infra/)** - Shared checkpoint system and build utilities
  - [Checkpoint Lifecycle](packages/build-infra/docs/checkpoint-lifecycle.md) - Visual guide to incremental builds
  - [Prerequisites](packages/build-infra/docs/prerequisites.md) - System dependencies and setup

### Node.js

- **[node-smol-builder](packages/node-smol-builder/)** - Custom Node.js v24.x with Socket patches
  - 6 security and size-optimization patches
  - SEA (Single Executable Application) support
  - VFS (Virtual Filesystem) support
  - [Build Pipeline](packages/node-smol-builder/docs/build-pipeline.md) - Visual guide to build process

```bash
# Build Node.js
pnpm --filter node-smol-builder build

# Build for specific mode
pnpm --filter node-smol-builder build --dev   # Development (faster JS, larger)
pnpm --filter node-smol-builder build --prod  # Production (smaller, V8 Lite Mode)
```

### WASM

WebAssembly builds with checkpoint-based caching:

- **[onnxruntime-builder](packages/onnxruntime-builder/)** - ONNX Runtime with SIMD + threading
- **[yoga-layout-builder](packages/yoga-layout-builder/)** - Yoga Layout for flexbox

```bash
# Build WASM modules
pnpm --filter onnxruntime-builder build
pnpm --filter yoga-layout-builder build
```

### ML Models

Quantized AI models for code analysis:

- **[models](packages/models/)** - Unified ML model package
- **[minilm-builder](packages/minilm-builder/)** - MiniLM-L6 sentence embeddings
- **[codet5-models-builder](packages/codet5-models-builder/)** - CodeT5 code understanding

```bash
# Build all models (INT4 quantization, production)
pnpm --filter models build

# Development build (INT8, faster)
pnpm --filter models build --dev
```

## Build Features

### Checkpoint System

All builders use incremental checkpoints for fast rebuilds:
- **Incremental Builds**: Resume from last successful phase
- **CI Caching**: GitHub Actions cache integration
- **Progressive Cleanup**: Only keep latest checkpoint in CI (saves disk space)
- **Backward Restoration**: Walk backwards to find latest valid checkpoint

See [Checkpoint Lifecycle](packages/build-infra/docs/checkpoint-lifecycle.md) for details.

### Build Modes

Most packages support two build modes:
- **dev**: Fast JS, debug symbols, inspector enabled (~30-40 MB for Node.js)
- **prod**: V8 Lite Mode, stripped, compressed (~8-12 MB for Node.js)

### Binary Compression

Node.js binaries can be compressed with `binpress`:
- 50-70% size reduction
- Self-extracting with runtime decompression
- Cached in `~/.socket/_dlx/` for fast subsequent runs
- Platform-specific algorithms (LZFSE/LZMA/LZMS)

## Documentation

- [Prerequisites](packages/build-infra/docs/prerequisites.md) - System dependencies and setup
- [Checkpoint Lifecycle](packages/build-infra/docs/checkpoint-lifecycle.md) - Incremental build system
- [Node.js Build Pipeline](packages/node-smol-builder/docs/build-pipeline.md) - Node.js build process
- [binject README](packages/binject/README.md) - Binary injection usage
- [binpress README](packages/binpress/README.md) - Binary compression usage
- [binflate README](packages/binflate/README.md) - Binary decompression usage

## CI/CD

GitHub Actions workflows automatically build and cache artifacts:
- `.github/workflows/node-smol.yml` - Node.js builds
- `.github/workflows/models.yml` - ML model builds
- `.github/workflows/onnxruntime.yml` - ONNX Runtime WASM builds
- `.github/workflows/yoga-layout.yml` - Yoga Layout WASM builds
- `.github/workflows/binsuite.yml` - Binary tools (binject, binpress, binflate)

Checkpoints are cached and restored using content-addressable keys.

## License

MIT
