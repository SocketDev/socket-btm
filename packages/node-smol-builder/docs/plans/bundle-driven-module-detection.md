# Bundle-driven node-smol module detection & custom compile

**Status:** design · **Date:** 2026-05-31 · **Owner:** jdalton

## Goal

Don't hand-chop features. Build a **system** that, given a consumer's SEA bundle,
**detects which node-smol subsystems are unused**, **drives a custom Node compile**
that omits them, **caches** that compile off a released base build, and **fails
closed** in CI if the trimmed binary can't run the app. Unit tests for `node:smol-*`
modules become **flaggable** so a build that omits a module skips (not fails) its tests.

Decisions locked (2026-05-31):

- **Input:** static analysis of the SEA bundle.
- **Action:** drive a custom Node compile (emit configure flags → build).
- **Safety:** fail-closed CI gate (run the app suite against the trimmed binary).
- **Caching:** derive per-bundle builds from a cached **build release**, not from scratch.
- **Tests:** `node:smol-*` unit tests are flaggable per the compiled feature set.

---

## Pipeline overview

```
SEA bundle (esbuilt main + VFS tar)
        │
        ▼
┌──────────────────────┐   feature-usage manifest (JSON)
│ 1. DETECTOR (static) │ ─────────────────────────────────┐
└──────────────────────┘   { quic:false, sqlite:false,    │
        │                     postgres:false, tui:false,   │
        │                     power:true, ... }            │
        ▼                                                   │
┌──────────────────────┐   configure-flag set              │
│ 2. FLAG MAPPER       │   [--without-smol-quic,           │
└──────────────────────┘    --without-smol-tui, ...]       │
        │                                                   │
        ▼                                                   │
┌──────────────────────┐                                   │
│ 3. CACHED COMPILE    │   restore SOURCE_PATCHED checkpoint│
│  (off build release) │   → configure(flags) → make → strip│
└──────────────────────┘                                   │
        │                                                   │
        ▼                                                   ▼
┌──────────────────────┐   ┌─────────────────────────────────┐
│ 4. FAIL-CLOSED GATE  │   │ 5. FLAGGABLE TESTS                │
│  inject blob, run    │   │  it.skipIf(!has('quic')) ...      │
│  app suite + probes  │   │  manifest drives skip vs run      │
└──────────────────────┘   └─────────────────────────────────┘
```

The **feature-usage manifest** is the single source of truth that flows into the
flag mapper (what to compile), the gate (what to assert is absent), and the test
harness (what to skip). One artifact, three consumers.

---

## Component 1 — the detector (static analysis of the SEA bundle)

### What it parses

sfw's SEA blob is a **single esbuilt `main` file** + `useCodeCache: true`
(`firewall/scripts/create-sea.ts`). socket-cli additionally ships a **VFS tar**
(`additions/.../vfs/loader.js`, `tar_parser.js`). The detector must cover both:

1. **The bundled main JS** — scan the (possibly minified) source for feature signals.
2. **The VFS tarball entries** — enumerate `.js`/`.mjs`/`.cjs`, scan each. Reuse the
   in-tree `tar_parser.js` to walk entries without extracting to disk.

### What it looks for — the feature-signal table

Detection keys off **module specifiers and global references** that map 1:1 to a
node-smol subsystem. Because the bundle is post-bundler, prefer robust signals
(string literals survive minification; identifiers may be mangled):

| Subsystem                  | Positive signals (any ⇒ keep)                                                |
| -------------------------- | ---------------------------------------------------------------------------- |
| `smol-quic` / `smol-http3` | `'node:smol-quic'`, `'node:smol-http3'`, ALPN `'h3'`                         |
| `smol-http` (uWS server)   | `'node:smol-http'`                                                           |
| sqlite                     | `'node:sqlite'`, `'node:smol-sqlite'`                                        |
| postgres                   | `'node:smol-postgres'`, `libpq`                                              |
| webgpu/dawn                | `navigator.gpu`, `'node:smol-webgpu'`                                        |
| tui / keymap               | `'node:smol-tui'`, `'node:smol-keymap'`                                      |
| ffi                        | `'node:smol-ffi'` (and `/bun` subpath)                                       |
| tree-sitter                | `'node:smol-tree-sitter'`                                                    |
| qrcode                     | `'node:smol-qrcode'`                                                         |
| markdown                   | `'node:smol-markdown'` (NOT app-level JS "markdown" — must be the specifier) |
| ilp                        | `'node:smol-ilp'`                                                            |
| power                      | `'node:smol-power'`                                                          |
| manifest                   | `'node:smol-manifest'`                                                       |
| versions                   | `'node:smol-versions'`                                                       |
| Temporal                   | `Temporal.` member access, `'@js-temporal'`                                  |
| Intl/ICU                   | `Intl.`, `toLocale*(`, `'node:intl'`                                         |

Always-keep core (never gated): vfs, primordial, util, webstreams, simd, boringssl.

### Detection method (deterministic, layered)

1. **Specifier scan (primary):** regex/lexer pass for the exact `node:smol-*` /
   `node:sqlite` string literals. These survive minification because they're passed
   to `require`/`import`/`isBuiltin` as strings. High precision.
2. **AST pass (secondary, for globals):** parse with the bundler's own parser
   (oxc/acorn already in the toolchain) to find `Temporal.*`, `navigator.gpu`,
   `Intl.*` member expressions that a string scan can't catch.
3. **`isBuiltin()` awareness:** when code does `isBuiltin('node:smol-power')` as a
   _guard_ with a fallback (socket-cli's pattern), the feature is **optional** —
   record it as `softUse` (works with or without). Soft-use features are _droppable_
   but flagged so the gate verifies the fallback path actually works without them.

### The dynamic-require escape hatch (the one real risk of static analysis)

Static analysis can't see `require(someVariable)`. Mitigations, in order:

- **Denylist/allowlist override** in the consumer's `package.json`
  (`"smol": { "keep": ["quic"], "drop": ["tui"] }`) — explicit wins over inferred.
- **Computed-require detection:** if the detector sees `require(<non-literal>)` or
  `import(<expr>)` it emits a **warning + conservative keep-all-ambiguous** for the
  affected feature family, never a silent drop.
- **The gate (Component 4) is the backstop** — even a missed dynamic load surfaces
  as a runtime failure against the trimmed binary, failing the build.

### Output

A JSON manifest, content-hashed (the hash becomes the build cache key, see C3):

```json
{
  "bundleHash": "sha256:…",
  "features": {
    "quic": { "use": "none", "drop": true },
    "sqlite": { "use": "none", "drop": true },
    "power": {
      "use": "soft",
      "drop": true,
      "note": "isBuiltin-guarded, fallback verified by gate"
    },
    "manifest": { "use": "hard", "drop": false },
    "temporal": {
      "use": "none",
      "drop": false,
      "note": "default-keep: ICU-coupled, requires explicit opt-in"
    }
  },
  "ambiguous": []
}
```

---

## Component 2 — feature → configure-flag mapper

The flag truth lives in `patches/source-patched/018-configure-postgres-iouring.patch`.
Existing flags (verified):

| Feature manifest key | Configure flag to emit when `drop:true`          | gyp var               | Default today                          |
| -------------------- | ------------------------------------------------ | --------------------- | -------------------------------------- |
| quic                 | `--without-smol-quic` (+ `--without-smol-http3`) | `node_use_smol_quic`  | **on** (must add gyp gate — see §gaps) |
| http3                | `--without-smol-http3`                           | `node_use_smol_http3` | on                                     |
| tui                  | `--without-smol-tui`                             | `node_use_smol_tui`   | on (flag parsed; **gyp gate missing**) |
| postgres             | _(omit `--with-postgres`)_                       | `node_use_postgres`   | **off** ✅                             |
| iouring              | _(omit `--with-iouring`)_                        | `node_use_iouring`    | off ✅                                 |
| dawn/webgpu          | _(omit `--with-dawn`)_                           | `node_use_dawn`       | off ✅                                 |

**Gaps the mapper depends on (must be built first):**

- QUIC sources + `lsquic.gypi` + `ls-qpack.gypi` are in the unconditional
  `['1==1', {}]` block of patch 004 — the `--without-smol-quic` flag does NOT yet
  gate them. **Wire them to `node_use_smol_quic`.**
- TUI/keymap + `yoga.gypi` likewise need wiring to `node_use_smol_tui`.
- **New flags needed** (no flag today): `--without-smol-sqlite`, `--without-smol-ffi`,
  `--without-smol-ilp`, `--without-smol-treesitter`, `--without-smol-qrcode`,
  `--without-smol-markdown`, `--without-smol-http`. Each adds a configure arg
  (patch 018) + a gyp condition (patch 004), mirrored per
  `project_additions_vs_patch_sync` invariant.

The mapper is a pure function `manifest → string[]`. No magic; it just reads the
`drop` flags and respects the `defaults` (Temporal/ICU stay unless explicitly dropped).

---

## Component 3 — cached compile off a build release

**Requirement:** per-bundle compiles must NOT pay the 30–60 min from-scratch cost;
derive from a cached **build release**.

The checkpoint system already supports exactly this. From
`build-infra/lib/constants.mts`, the chain is:
`SOURCE_CLONED → SOURCE_COPIED → SOURCE_PATCHED → (configure) → BINARY_RELEASED →
BINARY_STRIPPED → BINARY_COMPRESSED → FINALIZED`, and source-stage checkpoints are
**`PLATFORM_AGNOSTIC`** (shared, carry no compiled artifacts).

### Caching strategy

- **Shared prefix (cache once, reuse for every bundle):** `SOURCE_CLONED` →
  `SOURCE_PATCHED`. Cloning ~1 GB of upstream + applying all patches is identical
  regardless of feature flags. This is the "build release" base — produce it once
  per Node version + patch set, publish the `SOURCE_PATCHED` checkpoint tarball.
- **Per-flag-set branch (cache per distinct manifest):** `configure(flags)` →
  `make` → `strip`. **Configure is cheap; `make` is the expensive step.** The cache
  key for the compiled output = `hash(SOURCE_PATCHED id + flag-set + platform)`.
  Two bundles with the same feature manifest hit the **same** compiled cache entry —
  so sfw and sfw-free (both "minimal") build once and share.
- **Invalidation:** the existing `writeCacheHash` mechanism already keys on inputs;
  add the flag-set to its hash input so a flag change busts only the compile layer,
  not the source layers.

### Practical effect

- First "minimal" bundle: full `make` (~30–60 min), cached.
- Every subsequent bundle with the same feature set: **checkpoint restore, seconds.**
- A new feature combination: re-`make` from the shared `SOURCE_PATCHED` base (no
  re-clone, no re-patch) — the expensive-but-not-worst-case path.

Wire via the existing `--from-checkpoint=source-patched` / `--stop-at` flags in
`build.mts`; the detector→mapper just supplies the configure args.

---

## Component 4 — fail-closed CI gate

The detector is **advisory until the binary proves itself.** After the cached
compile produces a trimmed `node`:

1. **Inject the bundle** (`postject` / binject) into the trimmed binary.
2. **Run the consumer's own suite** against it (firewall: e2e/integration proxy
   tests; socket-cli: its CLI suite). Real workload, real code paths.
3. **Absence probes:** for every `drop:true` feature, assert the binding is genuinely
   gone — `isBuiltin('node:smol-quic') === false`, `internalBinding('quic')` throws.
   This catches a mapper bug that _thinks_ it dropped a feature but didn't.
4. **Soft-use fallback probes:** for every `use:"soft"` dropped feature (e.g. power),
   run the code path that would have used it and assert the fallback works (e.g.
   `power-state.mts`'s shellout path returns a valid answer with no binding present).
5. **Fail closed:** any suite failure, any unexpectedly-present binding, any
   fallback failure ⇒ **non-zero exit, build fails.** No trimmed binary ships
   without a green run.

This is the safety net that makes aggressive static dropping acceptable: a missed
dynamic `require` can't ship silently — it dies here.

---

## Component 5 — flaggable `node:smol-*` unit tests

**Requirement:** unit tests for compiled `node:smol-*` packages must be flaggable so
a build that omits a module skips its tests instead of failing.

### Current state (verified)

Tests already gate on **binary presence** via `it.skipIf(!smolBinary)`
(`test/smol-manifest-native.test.mts:107`, `test/paths.mts:56`). The `node:smol-ffi/bun`
test asserts `isBuiltin(...) === false` on stock Node. So the _idiom_ exists — it
just keys on "is there a smol binary," not "does this binary include feature X."

### The extension

Introduce a single feature-aware predicate, fed by the build's feature manifest:

```ts
// test/helpers/smol-features.mts
import { readFeatureManifest } from './manifest'      // reads the C3 build manifest
const features = readFeatureManifest()                 // { quic:false, manifest:true, ... }
export const has = (f: string) => features?.[f] === true
export const smolBinary = /* existing resolution */
```

Then per-module suites become:

```ts
describe('node:smol-quic', () => {
  it.skipIf(!smolBinary || !has('quic'))('negotiates h3', () => { … })
})
```

- A **minimal** build (quic dropped) → `has('quic')` false → the QUIC suite **skips
  with a clear reason**, doesn't fail.
- A **full** build → runs everything.
- Source-of-truth = the same manifest that drove the compile, so tests and binary
  can never disagree.
- **Guard against false-green:** a CI lane that builds the _full_ feature set must
  run with `--require-all-features`, turning `skipIf` into a hard failure if any
  expected feature is missing — so "skipped" can't mask a broken full build.

The build can emit the manifest next to the binary (e.g.
`out/Final/node.features.json`), and `process.report`/`process.config.variables`
already exposes the `node_use_*` gyp vars at runtime as a cross-check.

---

## Build order (each step independently landable & testable)

Legend: ✅ done · ◻ todo.

| Step | Deliverable                                                                                                                                                         | Depends on | Risk | Status                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---- | --------------------------------------------------------------------------- |
| 1    | Wire `--without-smol-*` flags to gyp gates (patches 004+018) for quic/http3/tui/keymap/ffi/ilp/http/qrcode/markdown/treesitter; `--without-sqlite` already upstream | —          | low  | ✅                                                                          |
| 2    | **Detector**: specifier scan + AST pass + VFS-tar walk → feature manifest JSON + V8-lite heuristic                                                                  | —          | med  | ✅                                                                          |
| 3    | **Flag mapper**: manifest → configure args (pure fn)                                                                                                                | 1, 2       | low  | ✅ (in detector: `manifest.configureFlags`)                                 |
| 4    | **Cached compile** off `SOURCE_PATCHED`, flag-set in cache key                                                                                                      | 1, 3       | low  | ✅ orchestrator + flag passthrough landed; needs one real build to validate |
| 5    | **Fail-closed gate**: inject + app suite + absence/fallback probes                                                                                                  | 4          | med  | ✅ gate + probe logic landed; app-suite run needs a real trimmed binary     |
| 6    | **Flaggable tests**: `has(feature)` helper + `SOCKET_REQUIRE_ALL_FEATURES` lane                                                                                     | 1          | low  | ✅ helper+guard landed; CI-lane wiring deferred to step 4/5                 |
| 7    | Default-keep Temporal/ICU; require explicit `drop` + dedicated soak before either is auto-dropped                                                                   | 5          | high | ◻ (policy enforced in registry)                                             |

### What landed for step 6 (2026-05-31)

- **`test/helpers/smol-features.mts`** — exports `has(feature)`, `smolBinary`,
  `missingRequiredFeatures()`. `has()` maps a registry feature name → its
  `node:smol-*` specifier (via `featureBuiltinSpecifier` in the registry) and
  **delegates to the existing `smolBuiltinIsAvailable()`** in `smol-builtin.mts`
  (the canonical `isBuiltin('node:…')` probe) — no duplicate binary-spawn logic.
  Features with no importable module (intl/temporal, reached via globals;
  `keep-unless-explicit`, never gated out) report present whenever a binary
  exists. Results cached per feature.
- **Usage:** `describe.skipIf(!smolBinary || !has('quic'))('node:smol-quic', …)`.
  A trimmed build that dropped quic → suite skips with the binary still present,
  instead of failing.
- **`missingRequiredFeatures()`** is the full-build-lane guard: when
  `SOCKET_REQUIRE_ALL_FEATURES=1` and a binary is built, returns the gated
  features the binary is missing so a CI assert can hard-fail — "skipped" can't
  mask a broken full build. No-op otherwise.
- **`test/unit/smol-features-helper.test.mts`** — 6 tests (5 pass, 1 skipped
  without a binary). Probe mechanism proven end-to-end against stock Node's
  `process.config.variables.node_use_sqlite`.
- **Deferred:** wiring `SOCKET_REQUIRE_ALL_FEATURES=1` into the CI workflow
  (`.github/workflows/node-smol.yml`) is a no-op until step 4/5 produce
  per-bundle _trimmed_ binaries — the default full build always has every
  feature. Wire it alongside the gate (step 5) so the lane has trimmed builds to
  guard.

### What landed for step 4 (2026-05-31)

- **`scripts/compile-for-bundle.mts`** — orchestrator: detects a bundle → builds
  the flag set → computes a 16-char cache key `sha256(SOURCE_PATCHED + sorted
flags + platform + mode)` → invokes `build.mts --from-checkpoint=source-patched
--without-smol=<flags>`. `--dry-run` prints the full plan (manifest summary,
  flags, cache key, exact build command) without building — verified against the
  real `firewall/dist/sfw-registry.js`.
- **Flag passthrough wiring:** `build.mts` gained a `--without-smol=` option
  (bare feature names mapped via the registry, OR raw `--…` flags verbatim,
  incl. `--v8-lite-mode`) parsed into `EXTRA_CONFIGURE_FLAGS`; `buildRelease`
  gained an `extraConfigureFlags` config field appended (deduped, skipping
  already-present) after the standard configure set. Previously the detector's
  flags had **no path into the build** — this closes that gap.
- **Cache strategy:** the shared clone→patch prefix (`SOURCE_PATCHED`,
  platform-agnostic checkpoint) is reused across bundles; only configure→make→
  strip run per distinct flag set. Two bundles with the same feature manifest
  (e.g. sfw-free + sfw-registry, both minimal) produce the same cache key → one
  build. Verified by unit test.
- **`test/unit/compile-for-bundle.test.mts`** — 7 tests locking the cache-key
  contract (stable, order-independent, sensitive to flags/platform/mode, dedup).
- **Real build run (2026-05-31):** ran a clean trimmed build with the
  sfw-registry feature set (`build.mts --dev --without-smol=quic,http3,smolHttp,
tui,keymap,ffi,ilp,treeSitter,qrcode,markdown,--without-sqlite`). Results:
  - ✅ Patches apply cleanly to pristine (real `patch -p1`).
  - ✅ **Configure honored every flag** — generated `out/Release/config.gypi`
    shows all 11 dropped features `"false"` (`node_use_smol_quic`…`node_use_sqlite`).
  - ✅ The gated build **compiled 4500+ objects** including the non-excluded smol
    sources; the excluded subsystems produced no missing/extra-source ninja
    errors — confirming the gyp `conditions` correctly dropped them (a malformed
    gate would fail at gyp/ninja, not later).
  - ❌ The build then failed at the **final crypto link** — `ld: symbol(s) not
found for architecture arm64` for `ncrypto::Rsa`/`DH_free`/`EC_KEY_free`/
    `HMAC_CTX_free`. This is a **pre-existing BoringSSL↔ncrypto ABI mismatch on
    this checkout**, NOT a trimming regression: my commit touches zero crypto
    wiring (verified), `ncrypto` lives in the always-on `node_use_openssl` block
    (untouched), and the missing symbols are core RSA/DH/EC/HMAC — none of the
    gated features. The prebuilt `libsmol_crypto.a`/`libsmol_ssl.a` exist; the
    skew is version/ABI, upstream of this work.
  - **Confirmed pre-existing:** this checkout has only a `source-patched`
    checkpoint and **no `binary-released` checkpoint** — i.e. a full node-smol
    binary had never linked in this environment before this work either. The
    crypto link failure is independent of trimming.
  - **Net:** the detection→configure→gyp-gate chain is validated through a real
    compile up to the crypto link. The runtime `isBuiltin` proof + the gate's
    `--suite` run still need a binary that links — blocked on the unrelated
    BoringSSL/ncrypto ABI issue. Run on CI / the Depot Linux path (where the full
    build links) to get the final runtime confirmation: build trimmed, then
    `pnpm --filter node-smol-builder run gate -- --binary=<trimmed> --bundle=<app> --suite="…"`.

### What landed for step 5 (2026-05-31)

- **`scripts/gate-trimmed-binary.mts`** — fail-closed gate: re-derives the
  manifest from the bundle, then against the trimmed binary runs **absence
  probes** (every `drop:true` feature → `isBuiltin('node:…')` must be false),
  **presence probes** (every kept feature must still import — catches
  over-trimming), flags **soft-use** dropped features for fallback exercise, and
  runs the consumer's **app suite** (`--suite`, with `$SMOL_BINARY` set) — the
  real backstop for a missed dynamic `require()`. Any failure → non-zero exit,
  build must not ship. Probe failures fail closed (treated as "present" so they
  can't satisfy an expect-absent).
- **`checkBinaryFeatures(binary, expectations, probe)`** is pure (probe
  injected) and **unit-tested** (`test/unit/gate-trimmed-binary.test.mts`, 5
  tests): dropped-but-present FAILS, kept-but-absent FAILS, matches pass,
  intl/temporal (no importable specifier) skipped.
- **Registry fix surfaced by the gate:** `intl`'s detection signal was a bogus
  `node:intl` specifier (Intl is a global, not an importable builtin). Corrected
  to `Intl.` member + `toLocale*` string signals, so `featureBuiltinSpecifier`
  returns undefined for it and the gate doesn't probe a non-existent module.
- **Remaining for step 5:** the `--suite` app-test run + absence probes need a
  real trimmed binary to execute against (built by step 4's real run). The logic
  is complete and unit-verified; it just hasn't been run against a live trimmed
  binary yet.

### What landed for steps 1–3 (2026-05-31)

- **`patches/source-patched/004-node-gyp-smol-sources.patch`** — the unconditional
  `['1==1', {}]` source block now keeps only always-on core (vfs, http*binding,
  simd, util, primordial, versions, manifest, webstreams, temporal, power) and
  moves the 10 optional subsystems into a nested gyp `conditions` array, each
  gated `['node_use_smol_X=="true"', {}]`. Feature-specific gypi includes moved
  with their owner (`yoga.gypi`→tui, `lsquic.gypi`+`ls-qpack.gypi`→quic). Added
  `node_use_smol*_%`defaults (all`'true'`) to the top `variables`block,
mirroring`node_use_sqlite%`— this makes node.gyp self-sufficient on the
Windows`vcbuild.bat`path, which no-ops`--without-_` flags.
- **`patches/source-patched/018-configure-postgres-iouring.patch`** — added 7
  `--without-smol-{http,ffi,ilp,keymap,qrcode,markdown,treesitter}` argparse
  flags + a `configure_smol_extras()` that sets the matching `node_use_smol_*`
  vars (inverted from the `--without-*` flag), wired into the configure call list.
- **Validated:** both patches apply via the real applier (`patch -p1 --batch`) to
  pristine upstream; node.gyp parses as a Python literal; configure.py parses;
  and an automated audit confirms every gyp-referenced `node_use_smol_*` has both
  a gyp `%`-default and a configure.py setter, and every `--without-smol-*` the
  detector emits is accepted by configure.py (no silent-ignore drift). A unit
  test (`every emittable --without-smol-* flag maps to a wired gyp gate`) locks
  the registry↔gate invariant.
- **Editing technique:** patch bodies were regenerated via apply-to-pristine →
  edit the real file → `git diff` (correct hunk headers) → strip `diff --git`/
  `index` lines to match house style. Hand-editing unified-diff `+`/`-` bodies
  corrupts the `@@` line counts — see [[node-smol-patch-editing-workflow]].

Remaining net-new work is the **cached compile orchestration (4)**, the
**fail-closed gate (5)**, and the **flaggable test harness (6)** — all wiring
existing machinery (checkpoints, postject, skipIf) to the manifest the detector
already emits.

---

## Open questions

1. **Other node-smol consumers** beyond firewall + socket-cli? Each new consumer is
   just another bundle through the same detector — but confirms the system must be
   per-bundle, not a single global trim.
2. **Minification guarantees:** does the esbuild config preserve `node:` string
   literals (it should — they're require args), or could a future plugin rewrite
   them? If specifiers can be transformed, the detector must run **pre-minify** on
   the bundler's module graph instead of post-bundle. Worth pinning the detector to
   the pre-bundle source where available.
3. **Manifest location contract:** where does the build write `node.features.json`
   so both the gate and the test harness find it deterministically? (Propose:
   alongside the binary + embedded via `process.config.variables` for runtime probe.)
4. **Temporal/ICU policy:** confirm these stay default-keep (the detector marks
   `drop:false` unless an explicit override), given their blast radius.
