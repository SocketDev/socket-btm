# minilm-builder

MiniLM-L6-v2 model conversion and quantization for embeddings.

## Building

```bash
pnpm build          # Build with int8 and int4 quantization
pnpm build --int8   # Build int8 only
pnpm build --int4   # Build int4 only
```

## Output

- `dist/int8/minilm-l6/model.onnx` - INT8 quantized model
- `dist/int4/minilm-l6/model.onnx` - INT4 quantized model

## Size Comparison

- Original PyTorch: ~66 MB
- ONNX INT8: ~17 MB
- ONNX INT4: ~13 MB
