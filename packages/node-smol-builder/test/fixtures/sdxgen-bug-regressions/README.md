# sdxgen Bug Regressions

Regression fixtures for the 4 shipped bug fixes (+ 1 deferred + 1 false-positive) that the smol-manifest C++ port must preserve.

Each subdirectory is one bug:

- `input.<ext>` — the lockfile content fed to `parseLockfile()`
- `expected.json` — the canonical `ParsedLockfile` output (frozen-equivalent, used in `toEqual` comparisons)
- `README.md` — bug description, originating sdxgen reference, fix shape

## How these gate the C++ port

Step 1 of `docs/plans/smol-manifest-native-full.md`. Every native parser implementation must produce `expected.json` byte-for-byte for the corresponding fixture. The equivalence harness loads all fixtures here at startup, parses each `input.<ext>`, and `toEqual`s the result against `expected.json`. Any divergence fails the build.

## Fixture register

| ID | Description | Ecosystem | Format | Status |
| ---- | ------------- | ----------- | -------- | -------- |
| `fix1-npm-v1-alias` | npm v1 `version: "npm:<real>@<v>"` → emit real name + version | npm | v1 | shipped |
| `fix2a-npm-v3-workspace-name` | npm v2/v3 workspace path entries prefer `pkg.name` over path-derived | npm | v2/v3 | shipped |
| `fix2b-npm-v3-alias-name` | npm v2/v3 `node_modules/<alias>` aliased installs prefer `pkg.name` | npm | v2/v3 | shipped |
| `fix3a-pnpm-v9-empty-version` | pnpm v9 importer block-style entries do not emit empty-version parent | pnpm | v9 | shipped |
| `fix3b-pnpm-v9-workspace-file-filter` | pnpm v9 importers skip `workspace:` / `file:` / `link:` protocols | pnpm | v9 | shipped |
| `fix4-yarn-depsmeta-inversion` | yarn `dependenciesMeta.<child>.optional` does NOT flip parent's `isOptional` | yarn | berry | shipped |
| `fix5-pnpm-v9-isdev-derivation` | pnpm v9 isDev derived from importer prod/dev sets, post-pass classified | pnpm | v9 | **deferred** — C++ port lands the correct behavior; JS impl currently misclassifies |
| `cargo-patch-unused-no-leak` | Cargo `[[patch.unused]]` entries do not materialize as real deps | cargo | toml | shipped (no fix needed; filter exists) |

## Status semantics

- **shipped** — the JS impls in socket-btm + socket-lib already produce `expected.json`. The C++ port must match.
- **deferred** — `expected.json` encodes the _correct_ target behavior. The current JS impls do **not** match — they encode the bug. The fixture's test is `it.skip` / `it.todo` until the C++ port lands the correct derivation. The C++ port is **forbidden** from inheriting the partial impl.
