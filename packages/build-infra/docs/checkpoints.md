# Checkpoints and Checkpoint Chains

A junior-dev introduction to how socket-btm caches build progress.

## Why checkpoints exist

Building node-smol or one of the binsuite tools can take tens of minutes. We don't want to redo work that's already done — locally or in CI. Checkpoints are the mechanism that lets a build resume from the latest successfully completed stage instead of starting over.

## What a checkpoint is

A checkpoint is a named snapshot of build progress at one stage. It lives on disk as two files:

- `<checkpoint>.json` — metadata (platform, arch, source-file hash, artifact path, binary size)
- `<checkpoint>.tar.gz` — the actual built artifact, tarballed

Plus a `.tar.gz.lock` lockfile during concurrent writes.

**Canonical layout** (every package that uses checkpoints):

```
packages/<pkg>/build/<mode>/<platform-arch>/checkpoints/<pkg>/<checkpoint>.json
packages/<pkg>/build/<mode>/<platform-arch>/checkpoints/<pkg>/<checkpoint>.tar.gz
```

- `<mode>` is `dev` or `prod`.
- `<platform-arch>` is `darwin-arm64`, `linux-x64`, `linux-x64-musl`, `win-x64`, etc. This segment exists so multiple platforms can build concurrently without trampling each other.
- `<pkg>` appears twice: once as the build directory owner, and once (optionally) inside `checkpoints/` when `createCheckpoint` is called with `packageName`. Flat layouts omit the inner directory.

Some packages also have `build/shared/checkpoints/<pkg>/...` for stages that are truly platform-independent (e.g. node-smol's `source-copied` stage). Everything else should be platform-scoped.

**Use `getPlatformBuildDir(packageDir, platformArch)`** from `build-infra/lib/constants` to compute `build/<mode>/<platform-arch>`. Do not hand-roll `path.join(BUILD_ROOT, mode)` — it drops the platform segment.

## What a checkpoint chain is

A **chain** is the ordered list of checkpoint names a package can restore from, **newest → oldest** (reverse dependency order).

```js
// node-smol
['finalized', 'binary-compressed', 'binary-stripped', 'binary-released', 'source-patched', 'source-copied']
```

Index 0 is the end of the pipeline. Each later entry is a stage that came before. `finalized` is built on top of `binary-compressed`, which is built on top of `binary-stripped`, and so on.

On restore, the runner walks the chain left to right: "do I have `finalized`? If yes, done. If no, do I have `binary-compressed`? If yes, run finalize on top. If no, keep walking." The first checkpoint it finds wins, and the build continues from there.

Put `finalized` **last** and you'd always rebuild from scratch. The order is load-bearing.

## Where chains are defined

Two places:

1. **Centralized registry** — `CHECKPOINT_CHAINS` in `packages/build-infra/lib/constants.mts`. Named generators like `simple()`, `nodeSmol()`, `curl()`, `yoga(mode)`, `onnxruntime(mode)`. Use these when a package's chain is one of the standard shapes.
2. **Per-package entry point** — `packages/<pkg>/scripts/get-checkpoint-chain.mts`. This is what CI calls. It prints the chain to stdout as a comma-separated string. The contract between the script and the workflow is exactly that: comma-separated names on stdout.

Packages with simple `['finalized']` chains (binsuite tools, stubs, lief, libpq) delegate to the shared `build-infra/scripts/get-checkpoint-chain.mts` to avoid duplication. Packages with multi-stage chains (curl, node-smol, yoga, onnx, models, minilm, codet5, iocraft) implement their chain inline.

## The checkpoint names themselves

`CHECKPOINTS` in `packages/build-infra/lib/constants.mts` is the canonical enum. Add new names here, not as ad-hoc strings. `validateCheckpointChain()` rejects anything that isn't in this enum at runtime.

Currently defined:

- **Universal**: `finalized`
- **Models/data**: `downloaded`, `converted`, `quantized`, `optimized`
- **WASM**: `source-copied`, `source-configured`, `wasm-compiled`, `wasm-optimized`, `wasm-released`, `wasm-synced`
- **Binary/native**: `binary-compressed`, `binary-released`, `binary-stripped`, `lief-built`, `mbedtls-built`, `source-patched`

## How CI consumes a chain

Two patterns in use, both acceptable:

**Pattern A — composite action (binsuite.yml)**

```yaml
- uses: ./.github/actions/setup-checkpoints
  with:
    package-name: binpress
    build-mode: ${{ inputs.build_mode || 'prod' }}
    platform: ${{ matrix.platform }}
    arch: ${{ matrix.arch }}
    libc: ${{ matrix.libc || '' }}
```

The composite action loads the cache version, computes a cache key, restores from cache, calls `get-checkpoint-chain.mts`, and validates — all as one unit.

**Pattern B — hand-rolled (node-smol.yml, lief.yml, yoga-layout.yml, onnxruntime.yml, models.yml)**

```yaml
- name: Set checkpoint chain
  id: checkpoint-chain
  run: |
    CHAIN=$(node packages/<pkg>/scripts/get-checkpoint-chain.mts --$BUILD_MODE)
    echo "checkpoint_chain=$CHAIN" >> $GITHUB_OUTPUT

- uses: ./.github/actions/restore-checkpoint
  with:
    package-name: '<pkg>'
    checkpoint-chain: ${{ steps.checkpoint-chain.outputs.checkpoint_chain }}
    ...
```

The hand-rolled pattern is used when the workflow needs package-specific logic around the cache key (e.g. node-smol folds in the Node submodule ref; lief/binsuite share LIEF cache versions).

**Do not invent a third pattern.** If you need caching for a new package, route it through one of these two.

## Creating a checkpoint at runtime

```js
import { createCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

await createCheckpoint(
  buildDir,                 // absolute path to build/<mode>/<platform-arch>
  CHECKPOINTS.FINALIZED,    // name from the enum — never a hand-typed string
  async () => {             // smoke test — enforced, can't checkpoint a broken build
    await spawn(binaryPath, ['--version'])
  },
  {
    artifactPath: './out/Final/binary',
    sourcePaths: ['build.mts', 'patches/*.patch'],
    packageName: '<pkg>',   // optional — adds the <pkg>/ suffix under checkpoints/
    packageRoot: PACKAGE_ROOT,
  },
)
```

Rules:

- The smoke test is **mandatory**. `createCheckpoint` fails if you pass anything other than a function. The pattern is always **build → smoke test → checkpoint**.
- `buildDir` must be platform-scoped. Pass `getPlatformBuildDir(packageDir, platformArch)`, never `path.join(packageDir, 'build', mode)`.
- `sourcePaths` drives cache invalidation. On the next run, `shouldRun(checkpoint)` hashes these paths; if the hash doesn't match the stored one, the stage rebuilds. Omit and you get no source-based invalidation.
- The metadata JSON is readable text. The tarball is binary. Never edit either by hand.

## Cache versioning

Orthogonal to the chain itself: `.github/cache-versions.json` holds per-package cache version strings like `"node-smol": "v206"`. These are folded into the CI cache key so bumping a version force-invalidates every checkpoint in CI for that package without touching any code.

Bump when:

- The checkpoint format changes (e.g. we add a new metadata field that old restores would miss).
- We need to flush stale caches after a fix.
- The cascade in `CLAUDE.md` says to — e.g. a change in `build-infra` bumps stubs, binflate, binject, binpress, and node-smol together.

The chain script does not read or care about cache versions. Only the workflow does.

## Adding a new package

1. Add its chain shape to `CHECKPOINT_CHAINS` in `build-infra/lib/constants.mts` (or reuse an existing shape like `simple()`).
2. Add new checkpoint names, if any, to `CHECKPOINTS` in the same file.
3. Create `packages/<pkg>/scripts/get-checkpoint-chain.mts`. For simple chains, copy the stubs-builder wrapper verbatim — it delegates to the shared script. For multi-stage chains, implement inline using the `CHECKPOINT_CHAINS.<name>()` generator.
4. In the package's `build.mts`, call `createCheckpoint(getPlatformBuildDir(packageRoot, platformArch), CHECKPOINTS.X, smokeTest, opts)` at the end of each stage.
5. Add the package to `.github/cache-versions.json` with an initial version.
6. In the package's workflow, use Pattern A (`setup-checkpoints` composite action) if the package is standalone, or Pattern B (hand-rolled) if the cache key needs package-specific logic. Do not invent Pattern C.

## Adding a new checkpoint stage to an existing package

1. Add the name to `CHECKPOINTS` in `build-infra/lib/constants.mts` if it's new to the codebase.
2. Update the relevant chain generator in `CHECKPOINT_CHAINS`. Remember: **newest first**.
3. Update the package's `get-checkpoint-chain.mts` if it inlines its chain.
4. Call `createCheckpoint(...)` at the end of the new stage in `build.mts`.
5. Bump the package's entry in `.github/cache-versions.json` so CI caches invalidate.

## Related reading

- `packages/build-infra/lib/constants.mts:51` — `CHECKPOINTS` enum and `CHECKPOINT_CHAINS` registry
- `packages/build-infra/lib/checkpoint-manager.mts` — `createCheckpoint`, `shouldRun`, `hasCheckpoint` runtime
- `packages/build-infra/scripts/get-checkpoint-chain.mts` — shared script for simple chains
- `.github/actions/setup-checkpoints/action.yml` — composite action (Pattern A)
- `.github/actions/restore-checkpoint/action.yml` — chain-walking restore (Pattern A and B)
- `.github/actions/validate-checkpoints/action.yml` — artifact/metadata validation
- `.github/cache-versions.json` — per-package cache invalidation dial
- `packages/build-infra/docs/shared-cache.md` — complementary doc on the CI-side cache infrastructure
