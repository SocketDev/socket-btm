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

- **MiniLM-L6-v2** - Sentence embeddings
- **CodeT5** - Code understanding and analysis

## Building

```bash
# Build all models (INT8/dev quantization, default)
pnpm --filter models build

# Production build (INT4 quantization, smaller)
pnpm --filter models build --prod
pnpm --filter models build --int4

# Development build (INT8 quantization, explicit)
pnpm --filter models build --dev
pnpm --filter models build --int8

# Build specific model only
pnpm --filter models build --minilm
pnpm --filter models build --codet5

# Force rebuild (ignore checkpoints)
pnpm --filter models build --force

# Clean all checkpoints
pnpm --filter models build --clean
```

## Quantization

Models are quantized for optimal size/performance:
- **Development** (default): INT8 quantization (~50% size reduction, better compatibility)
- **Production**: INT4 quantization (~75% size reduction)

## Output

```
build/
├── dev/out/Final/    # INT8 quantization (development, default)
│   ├── minilm-l6/
│   │   ├── model.onnx
│   │   └── tokenizer.json
│   └── codet5/
│       ├── model.onnx          # Note: CodeT5 uses combined encoder+decoder
│       └── tokenizer.json
└── prod/out/Final/   # INT4 quantization (production)
    ├── minilm-l6/
    │   ├── model.onnx
    │   └── tokenizer.json
    └── codet5/
        ├── model.onnx          # Note: CodeT5 uses combined encoder+decoder
        └── tokenizer.json
```

Note: CodeT5 models are generated as separate encoder and decoder files by the conversion process, but are combined into a single `model.onnx` file for distribution.

## Usage

```javascript
import * as ort from 'onnxruntime-node'
import path from 'node:path'

// Use development models (INT8, default, better compatibility)
const modelPath = path.join(__dirname, 'build/dev/out/Final/minilm-l6/model.onnx')
const session = await ort.InferenceSession.create(modelPath)
const results = await session.run(inputs)

// Or use production models (INT4, smaller)
const prodModelPath = path.join(__dirname, 'build/prod/out/Final/minilm-l6/model.onnx')
const prodSession = await ort.InferenceSession.create(prodModelPath)
const prodResults = await prodSession.run(inputs)
```

## Checkpoint System

This package uses unified checkpoints for workflow caching:

### Unified Checkpoints:
1. **downloaded** - All models downloaded from HuggingFace
2. **converted** - All models converted to ONNX format (CodeT5 split into encoder + decoder)
3. **quantized** - All models quantized (INT4 or INT8 depending on build mode)
4. **finalized** - All models ready for distribution

Checkpoints are cached and restored automatically in CI. See `packages/build-infra` for checkpoint implementation details.

### Build Modes:
- **dev** (default): INT8 quantization, better compatibility, faster builds
- **prod**: INT4 quantization, maximum compression, smaller size

## Related Packages

All packages are private build infrastructure for generating GitHub releases:
- `codet5-models-builder` - CodeT5 build infrastructure
- `minilm-builder` - MiniLM build infrastructure
- `onnxruntime-builder` - ONNX Runtime WASM build
- `yoga-layout-builder` - Yoga Layout WASM build
- `node-smol-builder` - Node.js custom binary build
- `build-infra` - Shared build infrastructure
