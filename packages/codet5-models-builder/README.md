# codet5-models-builder

CodeT5 model conversion and quantization for code analysis.

## Building

```bash
pnpm build          # Dev build (INT8 quantization, default)
pnpm build --dev    # Dev build (INT8 quantization)
pnpm build --int4   # Prod build (INT4 quantization, smaller)
pnpm build --prod   # Prod build (INT4 quantization, smaller)
pnpm build --force  # Force rebuild (ignore checkpoints)
```

## Output

Models are split into encoder and decoder:

- `build/dev/int8/output/encoder.onnx` - INT8 quantized encoder
- `build/dev/int8/output/decoder.onnx` - INT8 quantized decoder
- `build/dev/int8/output/tokenizer.json` - Tokenizer
- `build/prod/int4/output/encoder.onnx` - INT4 quantized encoder
- `build/prod/int4/output/decoder.onnx` - INT4 quantized decoder
- `build/prod/int4/output/tokenizer.json` - Tokenizer

## Size Comparison

- Original PyTorch: ~220 MB
- ONNX INT8: ~55 MB
- ONNX INT4: ~28 MB
