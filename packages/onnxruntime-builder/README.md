# onnxruntime-builder

ONNX Runtime WASM build with SIMD and threading support.

## Building

```bash
pnpm build
```

## Requirements

- Emscripten SDK (emsdk)
- CMake 3.13+

## Output

- `dist/ort-wasm-simd-threaded.wasm`
- `dist/ort-wasm-simd-threaded.mjs`

Based on ONNX Runtime v1.20.1.
