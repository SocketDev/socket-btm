# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## Overview

Monorepo containing:
- **Binary Tools** - binject, binpress, binflate (C/C++ binary manipulation)
- **Node.js** - Custom Node.js v25 with Socket security patches
- **WASM** - ONNX Runtime and Yoga Layout
- **ML Models** - Quantized AI models (CodeT5, MiniLM)

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
- [bin-stubs](packages/bin-stubs/) - Self-extracting stub binaries for compressed executables

### Node.js
- [node-smol-builder](packages/node-smol-builder/) - Custom Node.js v25 with Socket security patches

### WASM Builders
- [onnxruntime-builder](packages/onnxruntime-builder/) - ONNX Runtime WASM module builder
- [yoga-layout-builder](packages/yoga-layout-builder/) - Yoga Layout WASM module builder

### ML Models
- [codet5-models-builder](packages/codet5-models-builder/) - CodeT5 model quantization
- [minilm-builder](packages/minilm-builder/) - MiniLM model quantization
- [models](packages/models/) - ML model distribution package

## License

MIT
