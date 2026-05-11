/**
 * @fileoverview Integration tests for the prepatched ink bundle.
 *
 * The build collapses ink + ~25 runtime deps + yoga-layout-builder's
 * sync yoga-sync.mjs into a single ESM file at `dist/index.js`. The
 * tests below verify the bundle's contract by static-analyzing the
 * bundle text + the colocated `.d.ts` files. They deliberately do
 * NOT import the bundle at runtime — `react`, `react-reconciler`, and
 * `scheduler` are externals, and ink-builder has no React in its own
 * tree. Importing would force a fragile peer-install setup just for
 * the test surface.
 *
 * The shape of these assertions follows socket-wheelhouse's
 * `validate-bundle-deps` / `validate-no-link-deps` style: read the
 * dist file, assert structural properties, fail on drift.
 *
 * Tests skip gracefully when `dist/` is absent so a recursive
 * `pnpm run test` before any build doesn't hard-fail. Same shape as
 * yoga-layout-builder's `skipIfNotBuilt`.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(__dirname, '..')
const DIST_DIR = path.join(PACKAGE_ROOT, 'dist')
const BUNDLE_PATH = path.join(DIST_DIR, 'index.js')
const TYPES_DIR = path.join(DIST_DIR, 'build')

const HAS_DIST = existsSync(BUNDLE_PATH)

// React and its singletons must come from the consumer's tree to
// preserve the React-singleton invariant. The bundle declares them
// external; bundling any of these would create two React copies in
// the consumer's process and break hooks.
const EXPECTED_EXTERNALS = new Set([
  'react',
  'react-devtools-core',
  'react-reconciler',
  'react-reconciler/constants.js',
  'scheduler',
])

// Packages we explicitly want INLINED. If any of these appears as a
// bare import in the bundle, the externals list drifted — fail. List
// kept short on purpose: it's a representative sample of ink's
// runtime deps that have caused singleton confusion in past
// regressions, not the full ~25-dep list.
const MUST_BE_INLINED = [
  'chalk',
  'cli-cursor',
  'signal-exit',
  'stack-utils',
  'wrap-ansi',
  'yoga-layout',
]

describe.skipIf(!HAS_DIST)('ink-builder bundle', () => {
  describe('dist output structure', () => {
    it('produces a single ESM bundle at dist/index.js', () => {
      expect(existsSync(BUNDLE_PATH)).toBe(true)
    })

    it('ships a build/ directory with .d.ts files for type resolution', async () => {
      expect(existsSync(TYPES_DIR)).toBe(true)
      const entries = await fs.readdir(TYPES_DIR)
      const dts = entries.filter(e => e.endsWith('.d.ts'))
      // ink ships ~30 .d.ts files; we tolerate variation by checking
      // for a representative subset rather than an exact list.
      expect(dts).toContain('index.d.ts')
      expect(dts).toContain('ink.d.ts')
      expect(dts).toContain('dom.d.ts')
      expect(dts).toContain('reconciler.d.ts')
      expect(dts.length).toBeGreaterThan(20)
    })

    it('bundle is non-trivial in size', async () => {
      // oxlint-disable-next-line socket/prefer-exists-sync -- need stat.size for the bundle-size regression bounds.
      const stat = await fs.stat(BUNDLE_PATH)
      // Empirical: ~585 KB. The lower bound here catches a bundling
      // regression where externals leak (yoga-sync alone is ~200 KB
      // of base64'd WASM; if it weren't inlined the bundle would be
      // dramatically smaller).
      expect(stat.size).toBeGreaterThan(400_000)
      // Upper bound: catches accidental React inclusion (~60+ KB),
      // bundling more of node_modules than expected, or a full
      // sourcemap leaking in.
      expect(stat.size).toBeLessThan(2_000_000)
    })
  })

  describe('externals discipline', () => {
    it('only externalizes the React family', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // Bare-spec imports = anything that isn't relative (`./...`,
      // `../...`) and isn't a `node:` builtin. Each match represents
      // an external the bundle leaves to the consumer.
      const matches = bundle.match(/from\s+"([^."][^"]*)"/g) ?? []
      const bareSpecs = new Set(
        matches
          .map(m => m.slice(m.indexOf('"') + 1, -1))
          .filter(s => !s.startsWith('node:')),
      )
      for (const spec of bareSpecs) {
        expect(EXPECTED_EXTERNALS).toContain(spec)
      }
    })

    it('does not externalize ink runtime deps', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      for (const pkg of MUST_BE_INLINED) {
        // Bare `from "<pkg>"` would mean the bundle imports it at
        // runtime — i.e. it leaked out of the inlining instead of
        // being bundled in.
        const bareRe = new RegExp(`from\\s+"${pkg}"`)
        expect(bundle).not.toMatch(bareRe)
      }
    })

    it('uses node: protocol for every Node.js builtin import', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // The known ink-reachable builtins (smaller than Node's full
      // builtin list — ink doesn't use crypto or net).
      const builtins = [
        'child_process',
        'events',
        'fs',
        'os',
        'process',
        'stream',
        'tty',
      ]
      for (const builtin of builtins) {
        // Reject the bare form. The plugin we ship in
        // `.config/esbuild/node-protocol.mts` rewrites these to the
        // `node:` prefix; finding any bare form is a regression.
        const bareRe = new RegExp(`from\\s+"${builtin}"`)
        expect(bundle).not.toMatch(bareRe)
      }
    })
  })

  describe('shorten-paths plugin output', () => {
    it('strips pnpm .pnpm/<package>@<version> path segments from the bundle', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // pnpm hard-links every package into `node_modules/.pnpm/<name>@<version>/...`.
      // The shorten-paths plugin rewrites those long paths in
      // bundled comments + string literals to `<name>/<subpath>`.
      // Any leakage means the plugin failed to apply or a new code
      // path bypassed it.
      expect(bundle).not.toContain('node_modules/.pnpm')
    })
  })

  describe('patches applied', () => {
    it('signal-exit is imported by name (patch 001)', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // Upstream ink imports signal-exit as default: `import sig from
      // 'signal-exit'`. The fix flips it to the named export
      // `onExit`. The bundle inlines signal-exit, so the named
      // function name surfaces in the bundle text.
      expect(bundle).toContain('onExit')
    })

    it('does not contain top-level await for devtools (patch 002)', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // Upstream ink has a top-level `await import('react-devtools-core')`
      // at the head of devtools.js. The patch removes it (devtools is
      // a dev-only opt-in; TLA breaks SEA + sync-only consumers). The
      // patched form should not reach for react-devtools-core via
      // top-level dynamic import. We check the absence of the
      // specific TLA form rather than dynamic imports in general
      // (esbuild may emit other dynamic imports for code-splitting
      // boundaries).
      expect(bundle).not.toMatch(
        /^\s*await\s+import\(['"]react-devtools-core['"]/m,
      )
    })
  })

  describe('yoga-sync inlining', () => {
    it('inlines the WASM blob as base64', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // yoga-sync.mjs ships its WebAssembly module embedded as a
      // base64 string. After bundling, that string lives inside the
      // bundle (no separate yoga-sync.mjs file anymore). A
      // sufficiently long base64 sequence is a reliable proxy for
      // "the WASM landed in the bundle". We check for any run of
      // 1000+ base64 chars on a single line — empirical floor for
      // yoga's WASM blob without false-positives from other base64
      // strings.
      expect(bundle).toMatch(/[A-Za-z0-9+/=]{1000,}/)
    })

    it('inlines the WebAssembly instantiate path', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // yoga-sync's wrapAssembly bootstrap calls
      // `WebAssembly.Module` + `WebAssembly.Instance` (the sync
      // form, not `WebAssembly.instantiate` — that's async). Their
      // presence in the bundle proves yoga's runtime, not just its
      // type stubs, is inlined.
      expect(bundle).toContain('WebAssembly.Module')
      expect(bundle).toContain('WebAssembly.Instance')
    })

    it('inlines the YGEnums layout-direction constants', async () => {
      const bundle = await fs.readFile(BUNDLE_PATH, 'utf8')
      // YGEnums exposes flexbox layout enum names that ink's `styles`
      // module references. They're string keys in the bundled
      // map — checking a pair catches the case where yoga's enum
      // table got tree-shaken away.
      expect(bundle).toContain('FLEX_DIRECTION_ROW')
      expect(bundle).toContain('JUSTIFY_FLEX_START')
    })
  })

  describe('public API surface (via .d.ts)', () => {
    it('declares the canonical ink exports', async () => {
      // We read the .d.ts to verify the public API contract instead
      // of importing the bundle (which would require react +
      // react-reconciler in our test tree). The .d.ts files are
      // copied verbatim from upstream ink, so any drift here means
      // ink itself changed shape.
      const indexDts = await fs.readFile(
        path.join(TYPES_DIR, 'index.d.ts'),
        'utf8',
      )
      // Components.
      expect(indexDts).toMatch(/\bBox\b/)
      expect(indexDts).toMatch(/\bText\b/)
      // Renderer.
      expect(indexDts).toMatch(/\brender\b/)
      // Hooks.
      expect(indexDts).toMatch(/\buseInput\b/)
      expect(indexDts).toMatch(/\buseFocus\b/)
    })
  })
})
