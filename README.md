# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## Overview

Monorepo containing:
- **Binary Tools** - binject, binpress, binflate (C/C++ binary manipulation)
- **Node.js** - Custom Node.js v24 with Socket security patches
- **WASM** - ONNX Runtime and Yoga Layout
- **ML Models** - Quantized AI models (CodeT5, MiniLM)

## Quick Start

```bash
# Install dependencies
pnpm install

# Build binary tools
cd packages/binject && make
cd packages/binpress && make
cd packages/binflate && make

# Build Node.js
cd packages/node-smol-builder && pnpm build

# Build WASM
cd packages/onnxruntime-builder && pnpm build
cd packages/yoga-layout-builder && pnpm build

# Build ML models
cd packages/codet5-models-builder && pnpm build
```

## Packages

- [binject](packages/binject/) - Binary injection
- [binpress](packages/binpress/) - Binary compression
- [binflate](packages/binflate/) - Binary decompression
- [node-smol-builder](packages/node-smol-builder/) - Custom Node.js builds
- [build-infra](packages/build-infra/) - Shared build utilities

## License

MIT
