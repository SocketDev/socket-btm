# binflate

Self-extracting decompressor for binaries produced by binpress. Given a zstd-compressed artifact, binflate decompresses it into memory or a temp file and hands execution off to the real binary.

Used at runtime by stub binaries — you rarely call it directly. See the stubs-builder package for how the stubs embed binflate.

## Build

```bash
pnpm --filter binflate run build        # dev build
pnpm --filter binflate run build --prod # production build
```

Output: `build/<mode>/<platform-arch>/out/Final/binflate`.
