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

- `build/wasm/ort.wasm`
- `build/wasm/ort.mjs`
- `build/wasm/ort-sync.js`

Based on ONNX Runtime v1.20.1.
