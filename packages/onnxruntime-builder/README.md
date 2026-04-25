# onnxruntime-builder

Builds a custom WebAssembly build of [ONNX Runtime](https://onnxruntime.ai/) tailored for Socket CLI's embedded inference needs. We compile only the operators our models require, which keeps the WASM binary small and the startup cost low compared to the stock `onnxruntime-node` distribution.

Produces `ort.wasm` and the JS glue that loads it synchronously. Consumed by code that runs the `models` package's CodeT5 and MiniLM models without any external dependency at runtime.

## Build

```bash
pnpm --filter onnxruntime-builder run build        # dev build (~5–10min clean)
pnpm --filter onnxruntime-builder run build --prod # production build with wasm-opt
```

First-time init (clones ~500MB of upstream ONNX Runtime):

```bash
git submodule update --init --recursive packages/onnxruntime-builder/upstream/onnxruntime
```

Prereqs: `cmake`, `ninja`, `python3`, and the Emscripten SDK version pinned in `external-tools.json`. The preflight will auto-install Emscripten on first use; `cmake` / `ninja` / `python3` must be on PATH.

Output: `build/<mode>/<platform-arch>/out/Final/` with `ort.wasm`, `ort.mjs` (ESM loader), and `ort-sync.cjs` (sync CJS loader with embedded base64 WASM).
