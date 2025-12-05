# @socketsecurity/models

Production-ready AI models for Socket BTM, optimized with aggressive quantization.

## Package Architecture

This is a **private build package** (not published to npm) used to generate tagged GitHub releases. It consumes builds from:
- `codet5-models-builder`: Standalone CodeT5 build infrastructure
- `minilm-builder`: Standalone MiniLM build infrastructure

**Release Process**:
- All packages are `"private": true` and not published to npm
- Builds create tagged GitHub releases with model artifacts
- Individual model builders can be used for isolated development and testing
- This unified package combines all models for the final release

## Models

- **MiniLM-L6-v2** - Sentence embeddings (384-dimensional)
- **CodeT5** - Code understanding and analysis

## Building

```bash
# Build all models (production, INT4 quantization, default)
pnpm --filter models build

# Development build (INT8, faster, larger)
pnpm --filter models build --dev

# Build specific model only
pnpm --filter models build --minilm
pnpm --filter models build --codet5

# Force rebuild (ignore cache)
pnpm --filter models build --force

# Clean all checkpoints
pnpm --filter models build --clean
```

## Quantization

Models are quantized for optimal size/performance:
- **Production** (default): INT4 quantization (~75% size reduction)
- **Development**: INT8 quantization (~50% size reduction, better compatibility)

## Output

```
build/
├── dev/out/Final/    # INT8 quantization (development)
│   ├── minilm-l6/model.onnx
│   └── codet5/model.onnx
└── prod/out/Final/   # INT4 quantization (production)
    ├── minilm-l6/model.onnx
    └── codet5/model.onnx
```

## Usage

```javascript
import * as ort from 'onnxruntime-node'

// Use production models (INT4, smaller)
const session = await ort.InferenceSession.create('./build/prod/out/Final/minilm-l6/model.onnx')
const results = await session.run(inputs)
```

## Related Packages

All packages are private build infrastructure for generating GitHub releases:
- `codet5-models-builder` - CodeT5 build infrastructure
- `minilm-builder` - MiniLM build infrastructure
- `onnxruntime-builder` - ONNX Runtime WASM build
- `yoga-layout-builder` - Yoga Layout WASM build
- `node-smol-builder` - Node.js custom binary build
- `build-infra` - Shared build infrastructure
