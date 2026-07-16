# node-smol build: flags, compression strategy, size budget

Detail for `packages/node-smol-builder/scripts/common/shared/build.mts`, the
custom Node.js builder for Socket CLI distribution (smol builds) and Single
Executable Applications (SEA) with automatic Brotli compression.

## Directory structure

Fully isolated by mode + platform-arch, so concurrent builds don't collide:

- `build/shared/` — shared pristine artifacts (cloned source, extracted to
  dev/prod).
  - `build/shared/source/` — pristine Node.js source (archived in checkpoint).
  - `build/shared/checkpoints/` — source-cloned checkpoint (shared across
    dev/prod).
- `build/<mode>/<platform-arch>/` — build workspace for one mode on one
  target.
  - `build/<mode>/<platform-arch>/source/` — Node.js source (extracted from
    the shared checkpoint).
  - `build/<mode>/<platform-arch>/out/` — build outputs (Release, Stripped,
    Compressed, Final, …).
  - `build/<mode>/<platform-arch>/.cache/` — compiled binary cache +
    `cache-validation.hash`.
  - `build/<mode>/<platform-arch>/checkpoints/` — build checkpoints
    (source-patched, binary-released, …).

## Dual compression strategy

- **Layer 1 — SEA blob compression (Brotli on JavaScript).** Enabled by
  default during `--experimental-sea-config`. 70-80% size reduction
  (10-50MB → 2-10MB). Opt out with `"useCompression": false` in
  `sea-config.json`. Decompression: ~50-100ms at startup.
- **Layer 2 — binary compression (platform-specific on the whole binary).**
  Always enabled during build. 75-79% size reduction (27MB → 8-12MB).
  Decompression: ~100ms on first run, then cached.

## Build flags

- `--clean` — force clean build (ignore cache).
- `--prod` — production optimizations (V8 Lite, LTO).
- `--dev` — development mode (faster builds).
- `--with-dawn` — link against dawn-builder's `libwebgpu_dawn.a` (requires
  `pnpm --filter dawn-builder build` first; hard-fails if the artifact is
  missing).
- `--with-lief` — enable LIEF support (enables `--build-sea` flag, +5MB
  binary size).
- `--from-checkpoint=<name>` — skip to a specific build phase (resume from
  an existing artifact). Valid: `binary-released`, `binary-stripped`,
  `binary-compressed`, `finalized`.
- `--stop-at=<name>` — stop after a specific build phase (creates a
  checkpoint). Same valid set as above.
- `--build-only=<name>` — build to a stage but skip checkpoint creation
  (for Depot CI). Same valid set as above.

## Usage patterns

```text
pnpm build                                          # smol binary only
postject smol-binary NODE_SEA_BLOB app.blob         # smol + SEA
pnpm build --prod                                   # production build

node scripts/load.mts build-custom-node             # normal build
node scripts/load.mts build-custom-node --clean     # force fresh build
node scripts/load.mts build-custom-node --yes       # auto-yes to prompts
node scripts/load.mts build-custom-node --verify    # verify after build
node scripts/load.mts build-custom-node --test      # build + smoke tests
node scripts/load.mts build-custom-node --test-full # build + full tests
```

## Binary size optimization strategy

Starting size: ~49 MB (default Node.js v25 build).

**Stage 1 — configure flags (applied):**

- `--with-intl=small-icu`: ~44 MB (-5 MB, English-only ICU) — used.
- `--without-*` flags: ~27 MB (-22 MB, removes npm, amaro, etc.) — used.
- `--experimental-enable-pointer-compression`: reduced memory usage — used.

Additional options considered but not used:

- `--with-intl=none`: ~41 MB (-8 MB, no ICU, breaks Unicode).
- `--v8-lite-mode`: ~29 MB (-20 MB, disables JIT, 5-10x slower).

**Stage 2 — binary stripping** (platform-specific strip): ~25 MB (-24 MB,
removes debug symbols).

**Stage 3 — compression** (this script) + pkg Brotli (VFS): ~23 MB (-26 MB,
compresses Socket CLI code). Node.js `lib/` minify+Brotli: ~21 MB (-28 MB,
compresses built-in modules).

Target: ~21 MB (small-icu + full V8 JIT for performance).

**Size breakdown:**

- Node.js `lib/` (compressed): ~2.5 MB (minified + Brotli).
- Socket CLI (VFS): ~13 MB (pkg Brotli).
- Native code (V8, libuv): ~2.5 MB (stripped).

**Compression approach:**

1. Node.js built-in modules: esbuild minify → Brotli quality 11.
2. Socket CLI application: pkg automatic Brotli compression.

**Performance impact:**

- Startup overhead: ~50-100 ms (one-time decompression).
- Runtime performance: ~5-10x slower JS (V8 Lite mode).
- WASM performance: unaffected (Liftoff baseline compiler).
