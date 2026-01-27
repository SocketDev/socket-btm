# codet5-models-builder

CodeT5 model conversion and quantization for code analysis.

## Building

```bash
pnpm build          # Build with int8 and int4 quantization
pnpm build --int8   # Build int8 only
pnpm build --int4   # Build int4 only
```

## Output

- `dist/int8/codet5/model.onnx` - INT8 quantized model
- `dist/int4/codet5/model.onnx` - INT4 quantized model

## Size Comparison

- Original PyTorch: ~220 MB
- ONNX INT8: ~55 MB
- ONNX INT4: ~28 MB
