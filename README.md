# Socket BTM

Build infrastructure for Socket's binary artifacts and ML models.

## Packages

- **onnxruntime-builder** - ONNX Runtime WASM with SIMD + threading
- **yoga-layout-builder** - Yoga Layout WASM for flexbox calculations
- **models** - AI models (MiniLM-L6, CodeT5) with int8/int4 quantization
- **node-smol-builder** - Minimal Node.js binaries for 8 platforms

## Development

```bash
# Install dependencies
pnpm install

# Build a specific package
pnpm --filter onnxruntime-builder build
pnpm --filter yoga-layout-builder build
pnpm --filter models build
pnpm --filter node-smol-builder build
```

## CI/CD

Workflows automatically build on push/PR. Releases are created manually via GitHub Actions or on release events.

All workflows support dry-run mode by default (build only, no release).

## License

MIT
