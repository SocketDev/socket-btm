# minilm-builder

MiniLM-L6-v2 model conversion and quantization for embeddings.

## Prerequisites

- Python 3.11+
- Python packages: transformers, torch, onnx, onnxruntime, optimum

The build script auto-installs Python packages if missing.

## Source Model

- Model: [sentence-transformers/all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
- Type: Sentence embedding model
- Use: Text similarity, semantic search

## Building

```bash
pnpm build          # Dev build (INT8 quantization, default)
pnpm build --int4   # Prod build (INT4 quantization, smaller)
pnpm build --force  # Force rebuild (ignore checkpoints)
```

## Output

This is a build dependency consumed by the `models` package. Intermediate outputs:

- `build/int8/models/minilm.onnx` - INT8 quantized model
- `build/int8/models/minilm-tokenizer/` - Tokenizer files
- `build/int4/models/minilm.onnx` - INT4 quantized model
- `build/int4/models/minilm-tokenizer/` - Tokenizer files

Final distribution outputs (via `models` package):

- `../models/build/dev/out/Final/minilm-l6/model.onnx` - INT8 model
- `../models/build/prod/out/Final/minilm-l6/model.onnx` - INT4 model

## Size Comparison

- Original PyTorch: ~66 MB
- ONNX INT8: ~17 MB
- ONNX INT4: ~13 MB

## Testing

```bash
pnpm test           # Run tests
pnpm coverage       # Run tests with coverage
```

## Cleaning

```bash
pnpm clean          # Remove build artifacts
```
