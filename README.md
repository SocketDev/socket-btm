# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## Packages

- **onnxruntime-builder** - ONNX Runtime WASM with SIMD + threading
- **yoga-layout-builder** - Yoga Layout WASM for flexbox calculations
- **minilm-builder** - MiniLM-L6 models
- **codet5-models-builder** - CodeT5 models
- **node-smol-builder** - Minimal Node.js binaries for 8 platforms

## Development

```bash
# Install dependencies
pnpm install

# Build a specific package
pnpm --filter onnxruntime-builder build
pnpm --filter yoga-layout-builder build
pnpm --filter minilm-builder build
pnpm --filter codet5-models-builder build
pnpm --filter node-smol-builder build
```

## License

MIT
