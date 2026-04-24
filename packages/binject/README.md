# binject

Injects data into compiled binaries without recompiling them. Used to embed SEA (Single Executable Application) resources and VFS archives into a Node.js binary, and to embed bundled stubs into binpress. Under the hood it uses LIEF to parse and rewrite Mach-O, ELF, and PE files so the same tool works on macOS, Linux, and Windows.

## Build

```bash
pnpm --filter binject run build        # dev build (fast)
pnpm --filter binject run build --prod # production build (LTO/strip)
```

Output: `build/<mode>/<platform-arch>/out/Final/binject`.

Depends on `lief-builder` — run it first, or let the cache-miss path download a prebuilt LIEF from our GitHub releases.
