# minilm-builder

MiniLM-L6-v2 model conversion and quantization for embeddings.

## Building

```bash
pnpm build          # Dev build (INT8 quantization, default)
pnpm build --int4   # Prod build (INT4 quantization, smaller)
pnpm build --force  # Force rebuild (ignore checkpoints)
```

## Output

- `build/int8/models/minilm.onnx` - INT8 quantized model
- `build/int8/models/minilm-tokenizer/` - Tokenizer files
- `build/int4/models/minilm.onnx` - INT4 quantized model
- `build/int4/models/minilm-tokenizer/` - Tokenizer files

## Size Comparison

- Original PyTorch: ~66 MB
- ONNX INT8: ~17 MB
- ONNX INT4: ~13 MB
