# onnxruntime-builder

ONNX Runtime WASM build with SIMD and threading support.

## Building

```bash
# Standard production build
pnpm build

# Force clean rebuild
pnpm build:force

# Development build (faster, less optimized)
pnpm build --dev

# Production build (slower, optimized)
pnpm build --prod
```

## Testing

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test:suite
```

## Requirements

- Emscripten SDK (emsdk)
- CMake 3.13+

## Output

Production builds output to `build/prod/out/Final/`:
- `ort.wasm` (~4.7MB)
- `ort.mjs` (~48KB)
- `ort-sync.cjs` (~4.8MB)
- `ort-sync.mjs` (~4.8MB)

Development builds output to `build/dev/out/Final/`:
- `ort.wasm` (~9.4MB)
- `ort.mjs` (~48KB)
- `ort-sync.cjs` (~9.4MB)
- `ort-sync.mjs` (~9.4MB)

Based on ONNX Runtime v1.20.1.
