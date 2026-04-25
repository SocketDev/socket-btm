# yoga-layout-builder

Builds [Yoga](https://github.com/facebook/yoga) (Meta's Flexbox layout engine) as a synchronous WASM module. The stock `yoga-layout` npm package does async WASM instantiation which breaks anything that needs layout available the moment the process starts — including Ink, which we patch to use this build (see `ink-builder`).

Ships `yoga.wasm` + `yoga.mjs` (ESM) and `yoga-sync.cjs` for legacy consumers. The WASM binary is embedded as bytes so nothing has to be loaded from disk at runtime.

## Build

```bash
pnpm --filter yoga-layout-builder run build        # dev build
pnpm --filter yoga-layout-builder run build --prod # production build
```

Output: `build/<mode>/<platform-arch>/out/Final/` with `yoga.wasm`, `yoga.mjs`, and `yoga-sync.cjs`.

The postinstall probes for cmake / ninja / python3 / clang (macOS) or gcc (Linux/Windows) and will fail early if they're missing — install those first.
