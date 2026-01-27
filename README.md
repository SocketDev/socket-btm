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
pnpm --filter @socketbin/node-smol-builder run build

# Build WASM
pnpm --filter @socketbin/onnxruntime-builder run build
pnpm --filter @socketbin/yoga-layout-builder run build

# Build ML models
pnpm --filter @socketbin/codet5-models-builder run build
```

## Packages

- [binject](packages/binject/) - Binary injection
- [binpress](packages/binpress/) - Binary compression
- [binflate](packages/binflate/) - Binary decompression
- [node-smol-builder](packages/node-smol-builder/) - Custom Node.js builds
- [build-infra](packages/build-infra/) - Shared build utilities

## License

MIT
