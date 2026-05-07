/**
 * Required-files manifest for an ONNX Runtime install.
 *
 * ORT's Emscripten build produces a WASM bundle + JS glue, paralleling
 * yoga-layout-builder:
 *
 *   ort.wasm       — Emscripten-compiled WASM module (~10-20 MB)
 *   ort.mjs        — async ESM glue
 *   ort-sync.cjs   — sync CJS glue (bundled WASM bytes inline)
 *   ort-sync.mjs   — sync ESM glue
 *
 * The sync variants are what node:smol-onnx pulls in at bootstrap.
 */
export const ONNXRUNTIME_REQUIRED_FILES = [
  'ort.wasm',
  'ort.mjs',
  'ort-sync.cjs',
  'ort-sync.mjs',
]
