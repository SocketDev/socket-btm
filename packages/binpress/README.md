# binpress

Compresses a Node.js binary with zstd and wraps it in a small self-extracting stub (from stubs-builder). The result is a single executable that decompresses itself on launch via binflate.

Shrinks a ~25MB node-smol binary by roughly 30–50% depending on compression settings, with a one-time extraction cost at startup.

## Build

```bash
pnpm --filter binpress run build        # dev build
pnpm --filter binpress run build --prod # production build
```

Output: `build/<mode>/<platform-arch>/out/Final/binpress`.

Depends on `lief-builder` and `stubs-builder` — build those first, or let the cache-miss path fetch prebuilt artifacts from our GitHub releases.
