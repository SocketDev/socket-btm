# models

Compiled AI models for Socket security analysis.

## Building

```bash
pnpm build        # Build production models (INT4 quantization, default)
pnpm build --prod # Build production models (INT4 quantization)
pnpm build --dev  # Build development models (INT8 quantization)

# Legacy aliases (still supported)
pnpm build --int4 # Alias for --prod
pnpm build --int8 # Alias for --dev
```

## Models

- **MiniLM-L6-v2** - Sentence embeddings (384-dimensional)
- **CodeT5** - Code understanding and analysis

## Output

```
dist/
├── dev/    # INT8 quantization (development)
│   ├── minilm-l6/model.onnx
│   └── codet5/model.onnx
└── prod/   # INT4 quantization (production)
    ├── minilm-l6/model.onnx
    └── codet5/model.onnx
```

## Usage

```javascript
import * as ort from 'onnxruntime-node'

// Use production models (INT4, smaller)
const session = await ort.InferenceSession.create('./dist/prod/minilm-l6/model.onnx')
const results = await session.run(inputs)
```
