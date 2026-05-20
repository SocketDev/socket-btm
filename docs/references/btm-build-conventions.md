# BTM Build Conventions

## Build system

- ALWAYS use `pnpm run build`, NEVER invoke Makefiles directly (build scripts handle dependency downloads).
- ALWAYS run clean before rebuilding: `pnpm --filter <pkg> clean && pnpm --filter <pkg> build`.
- NEVER manually delete checkpoint files — the clean script knows all locations.

## Toolchain alignment with language upstreams

Keep pins, source-of-truth URLs, and checksum metadata aligned with where each language project **currently lives and publishes**, not where it used to. When a language or compiler migrates its canonical home, mirror the move in our tooling the same release cycle:

- `packages/*/external-tools.json`: update `source`, `sourceTag`, and `notes` so the canonical URL points at the new home.
- `packages/build-infra/tool-checksums/<tool>-<version>.json`: record the new `source`, `sourceTag`, `sourceTagSha`, `sourceCommitSha`, `sourceTarball`, `sourceTarballSha256`. Keep `binaryHost` pointing at wherever the prebuilt artifacts actually live (often a separate CDN), with a `binaryHostNote` explaining why.
- Prebuilt binary URLs stay where the project hosts them — don't assume the new source home also hosts binaries. Verify, and keep the fields distinct.
- One concrete precedent: Zig moved its source from GitHub → Codeberg. The `zig-*.json` tool-checksum files record Codeberg as the `source` + tag SHA, while `binaryHost` stays on `ziglang.org/download`.

When in doubt, check the language's own `README` / `index.json` / release metadata for where they're pushing tagged releases now.

## Source-of-truth architecture

Source packages (`binject`, `bin-infra`, `build-infra`) are canonical. ALL work in source packages, then sync to `additions/`. NEVER make changes only in `additions/` — they will be overwritten.

The mirrored subdirectories under `additions/source-patched/src/socketsecurity/{bin-infra,binject,build-infra}/` are GITIGNORED (see `.gitignore` lines 59-61). The `prepare-external-sources.mts` step of the node-smol build populates them by copying from the canonical source packages and validates the hash. If the build fails with "Additions directory out of sync!", the working-tree copy is stale — rerun `pnpm --filter node-smol-builder build` (which re-syncs), or do it manually with `rsync -a --delete packages/<pkg>/src/socketsecurity/<pkg>/ packages/node-smol-builder/additions/source-patched/src/socketsecurity/<pkg>/`. Never "commit" a fix — those paths are untracked on purpose.

## Cache-version cascade

When modifying source, bump `.github/cache-versions.json` for all dependents. The full path → consumer mapping lives in `scripts/validate-cache-versions.mts` (`CASCADE_RULES`); the gate runs in `pnpm check` and CI, so missed bumps fail the build instead of leaking into a release.

## Test style

NEVER write source-code-scanning tests. Write functional tests that verify behavior. For modules requiring the built binary: use integration tests with the final binary (`getLatestFinalBinary`), NEVER intermediate stages.

Test fixtures run by the built binary (smoke tests, integration tests) MUST use `.mjs`/`.js` extensions, NOT `.mts`. The node-smol binary is built `--without-amaro` so it has no TypeScript stripping support. Build scripts run by the host Node.js can use `.mts` normally.

## Fetching npm packages

ALWAYS use the npm registry directly (`npm pack` or `https://registry.npmjs.org/`), NEVER CDNs like unpkg.

## BTM-specific code style

- **Codex usage** — Codex is for advice and critical assessment ONLY, never for making code changes. Proactively consult before complex optimizations (>30min estimated) to catch design flaws early.
- **`spawn()` shell option** — NEVER change `shell: WIN32` to `shell: true`. `shell: WIN32` enables shell on Windows (needed) and disables on Unix (not needed). If spawn fails with ENOENT, separate command from arguments.
- **`isMainModule` detection** — ALWAYS use `fileURLToPath(import.meta.url) === path.resolve(process.argv[1])`. NEVER use `endsWith()` or raw URL comparison.
- **Platform-arch and libc** — ALWAYS pass `libc` for Linux platform operations. Prefer `getCurrentPlatformArch()`, which auto-detects libc. Missing libc causes builds to output to wrong directories.

The general fleet rules — existsSync, `@socketsecurity/lib-stable/spawn`, `@socketsecurity/lib-stable/logger`, no `process.chdir()`, no `fetch()`, etc. — apply here and are documented in the fleet block of `CLAUDE.md`.
