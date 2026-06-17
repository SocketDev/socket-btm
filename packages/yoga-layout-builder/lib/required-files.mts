/**
 * Required-files manifest for a Yoga Layout install.
 *
 * Yoga's build produces a WASM bundle + JS glue:
 *
 * Yoga.wasm       — Emscripten-compiled WASM module
 * yoga.mjs        — async ESM glue
 * yoga-sync.cjs   — sync CJS glue (bundled WASM bytes inline)
 * yoga-sync.mjs   — sync ESM glue.
 *
 * The sync variants are what node:smol-tui's yoga binding pulls in
 * (Node's bootstrap is sync; async glue would require an Init step).
 * All four ship in the prebuilt tarball so downstream consumers can
 * pick the variant that matches their loader.
 */
export const YOGA_REQUIRED_FILES = [
  'yoga.wasm',
  'yoga.mjs',
  'yoga-sync.cjs',
  'yoga-sync.mjs',
]
