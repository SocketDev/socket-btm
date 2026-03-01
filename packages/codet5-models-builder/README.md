# codet5-models-builder

CodeT5 model conversion and quantization for code analysis.

## Prerequisites

- Python 3.11+
- Python packages: transformers, torch, onnx, onnxruntime, optimum

The build script auto-installs Python packages if missing.

## Source Model

- Model: [Salesforce/codet5-base](https://huggingface.co/Salesforce/codet5-base)
- Type: Code understanding and generation
- Use: Code summarization, analysis

## Building

```bash
pnpm build          # Dev build (INT8 quantization, default)
pnpm build --dev    # Dev build (INT8 quantization)
pnpm build --int4   # Prod build (INT4 quantization, smaller)
pnpm build --prod   # Prod build (INT4 quantization, smaller)
pnpm build --force  # Force rebuild (ignore checkpoints)
```

## Output

Intermediate outputs (encoder + decoder split):

- `build/dev/int8/output/encoder.onnx` - INT8 quantized encoder
- `build/dev/int8/output/decoder.onnx` - INT8 quantized decoder
- `build/dev/int8/output/tokenizer.json` - Tokenizer
- `build/prod/int4/output/encoder.onnx` - INT4 quantized encoder
- `build/prod/int4/output/decoder.onnx` - INT4 quantized decoder
- `build/prod/int4/output/tokenizer.json` - Tokenizer

Final distribution outputs (combined, via `models` package):

- `../models/build/dev/out/Final/codet5/model.onnx` - Combined encoder+decoder (INT8)
- `../models/build/prod/out/Final/codet5/model.onnx` - Combined encoder+decoder (INT4)

## Size Comparison

- Original PyTorch: ~220 MB
- ONNX INT8: ~55 MB
- ONNX INT4: ~28 MB

## Testing

```bash
pnpm test           # Run tests
pnpm coverage       # Run tests with coverage
```

## Cleaning

```bash
pnpm clean          # Remove build artifacts
```
