# models

Compiled AI models for Socket security analysis.

## Building

```bash
pnpm build          # Build all models with int8 and int4 quantization
pnpm build --int8   # Build int8 only
pnpm build --int4   # Build int4 only
```

## Models

- **MiniLM-L6-v2** - Sentence embeddings (384-dimensional)
- **CodeT5** - Code understanding and analysis

## Output

```
dist/
├── int8/
│   ├── minilm-l6/model.onnx
│   └── codet5/model.onnx
└── int4/
    ├── minilm-l6/model.onnx
    └── codet5/model.onnx
```

## Usage

```javascript
import * as ort from 'onnxruntime-node'

const session = await ort.InferenceSession.create('./dist/int8/minilm-l6/model.onnx')
const results = await session.run(inputs)
```
