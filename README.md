# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## What is Socket BTM?

Socket BTM (Binary Tooling Manager) is Socket Security's build infrastructure for creating custom Node.js binaries, binary manipulation tools, and machine learning models.

**Why does this exist?** Socket Security needs to:

- Build custom Node.js binaries with security enhancements and embedded capabilities (VFS, SEA)
- Create tools to inject data into binaries without recompilation (binject)
- Compress and decompress binaries while preserving functionality (binpress, binflate)
- Ship optimized ML models for security analysis (CodeT5, MiniLM)

**What can you do with it?**

- Build a custom Node.js binary (~23-27MB) with Socket's security patches
- Embed files into executables using Virtual File System (VFS)
- Create Single Executable Applications (SEA) from Node.js apps
- Compress binaries for smaller distribution size
- Build WASM modules for browser and server-side use

**Who is this for?** Developers working on Socket's internal tools, contributing to Socket's open source projects, or building custom Node.js distributions.

## Overview

Monorepo containing:

- **Binary Tools** - binject, binpress, binflate (C/C++ binary manipulation)
- **Node.js** - Custom Node.js v25 with Socket security patches
- **WASM** - ONNX Runtime and Yoga Layout
- **ML Models** - Quantized AI models (CodeT5, MiniLM)

## Core Concepts

If you're new to binary manipulation or Node.js customization, here are the key concepts you'll encounter:

### Single Executable Application (SEA)

A Node.js program bundled into a single executable file. Instead of shipping `node` + `.js` files, you get one `.exe`/binary that contains everything. This makes distribution easier and protects source code.

**Example:** `my-app.exe` contains both Node.js runtime and your application code.

### Virtual File System (VFS)

A filesystem embedded inside a binary. Your executable can read "files" that are actually data baked into the binary itself. No need to extract files to disk first.

**Example:** Your binary contains `config.json` and `index.js` internally, accessed via normal `fs.readFile()` calls.

### Binary Injection

Modifying a compiled binary without recompiling from source. We insert data into special sections of executables (Mach-O on macOS, ELF on Linux, PE on Windows).

**Example:** Take `node` binary, inject a VFS archive into it, output `node-with-vfs`.

### LIEF (Library for Instrumenting Executable Formats)

A C++ library for reading and modifying executable formats (Mach-O, ELF, PE). We use it to inject data into binaries safely without corrupting them.

### Checkpoints

Incremental build caching system. Each build stage (copy sources → apply patches → compile → strip → compress) saves a checkpoint. If source hasn't changed, we skip rebuilding.

**Example:** Building Node.js takes 30 minutes from scratch, but only 2 minutes if you only changed one patch file.

### Compression (LZFSE/UPX)

Reducing binary size for distribution. Compressed binaries self-extract at runtime.

**Example:** 60MB Node.js binary → 23MB compressed binary (saves bandwidth, faster downloads).

## Quick Start

```bash
# Install dependencies
pnpm install

# Build binary tools
pnpm --filter binject run build
pnpm --filter binpress run build
pnpm --filter binflate run build

# Build Node.js
pnpm --filter node-smol-builder run build

# Build WASM modules
pnpm --filter onnxruntime-builder run build
pnpm --filter yoga-layout-builder run build

# Build ML models
pnpm --filter codet5-models-builder run build
pnpm --filter minilm-builder run build
pnpm --filter models run build
```

## Development

### Git Hooks

This repository uses [Husky](https://typicode.github.io/husky/) for git hooks:

**Pre-commit Hook** (optional quality checks):

- Runs linting on staged files (`pnpm lint --staged`)
- Runs tests on staged test files (`pnpm test --staged`)
- Can be bypassed with `git commit --no-verify` for fast local commits, history operations (squash, rebase, amend), or emergency hotfixes
- Selectively disable checks with environment variables:
  - `DISABLE_PRECOMMIT_LINT=1` - Skip linting
  - `DISABLE_PRECOMMIT_TEST=1` - Skip testing

**Pre-push Hook** (mandatory security checks):

- Runs security validation before pushing to remote
- Cannot be bypassed

**Setup**:
Git hooks are automatically installed when running `pnpm install` (via the `prepare` script).

**Windows Requirements**:
Git hooks use bash scripts and require [Git Bash](https://gitforwindows.org/) or [WSL](https://docs.microsoft.com/en-us/windows/wsl/install) on Windows systems.

## Packages

### Binary Tools

- [binject](packages/binject/) - Binary injection (Mach-O, ELF, PE)
- [binpress](packages/binpress/) - Binary compression (LZFSE)
- [binflate](packages/binflate/) - Binary decompression utility

### Infrastructure

- [build-infra](packages/build-infra/) - Shared build utilities (checkpoints, CMake, Rust, WASM)
- [bin-infra](packages/bin-infra/) - Binary infrastructure (LIEF, compression, format handling)
- [stubs-builder](packages/stubs-builder/) - Self-extracting stub binaries for compressed executables
- [curl-builder](packages/curl-builder/) - Curl static library builder
- [lief-builder](packages/lief-builder/) - LIEF library builder

### Node.js

- [node-smol-builder](packages/node-smol-builder/) - Custom Node.js v25 with Socket security patches

### WASM Builders

- [onnxruntime-builder](packages/onnxruntime-builder/) - ONNX Runtime WASM module builder
- [yoga-layout-builder](packages/yoga-layout-builder/) - Yoga Layout WASM module builder

### UI Libraries

- [ink-builder](packages/ink-builder/) - Prepatched Ink with yoga-sync
- [iocraft-builder](packages/iocraft-builder/) - ioCraft TUI builder

### ML Models

- [codet5-models-builder](packages/codet5-models-builder/) - CodeT5 model quantization
- [minilm-builder](packages/minilm-builder/) - MiniLM model quantization
- [models](packages/models/) - ML model distribution package

## License

MIT
