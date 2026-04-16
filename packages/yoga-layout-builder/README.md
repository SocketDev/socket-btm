# yoga-layout-builder

Builds [Yoga](https://github.com/facebook/yoga) (Meta's Flexbox layout engine) as a synchronous WASM module. The stock `yoga-layout` npm package does async WASM instantiation which breaks anything that needs layout available the moment the process starts — including Ink, which we patch to use this build (see `ink-builder`).

Ships two outputs: `yoga.wasm` + `yoga.mts` (ESM) and `yoga-sync.cjs` for legacy consumers. The WASM binary is embedded as bytes so nothing has to be loaded from disk at runtime.
