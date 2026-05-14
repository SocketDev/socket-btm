/**
 * Equivalence harness for the smol-manifest C++ binding.
 *
 * This test file is the gate for the native port (steps 4-7 of
 * docs/plans/smol-manifest-native-full.md). Each fixture under
 * test/fixtures/sdxgen-bug-regressions/ is loaded, fed to the
 * native binding, and the result is compared to expected.json
 * via toEqual.
 *
 * STATUS:
 *   - If `internalBinding('smol_manifest_native')` is not present
 *     (stock Node, or a smol build before the binding lands), the
 *     entire describe block is skipped via `describe.skipIf`.
 *   - Each fixture's it.todo flips to it as the corresponding
 *     parser implementation lands in the C++ port:
 *       - npm parser → fix1, fix2a, fix2b enabled
 *       - pnpm parser → fix3a, fix3b, fix5 enabled
 *       - yarn parser → fix4 enabled
 *       - cargo parser → cargo-patch-unused-no-leak enabled
 *
 * The binding shape is defined in
 * docs/plans/smol-manifest-native-full.md "V8 binding surface":
 *   parseLockfile(content: Buffer | string, ecosystem: number,
 *                 format: number) -> ParsedLockfile
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures/sdxgen-bug-regressions')

// Try to resolve the native binding. On stock Node + on smol builds
// that don't yet have the smol_manifest_native binding registered,
// this is undefined and the entire suite is skipped.
//
// internalBinding is exposed only inside the smol Node binary's
// internal modules, NOT to userland test files. The harness uses
// `process._smolManifestNative` as a publicly-accessible alias the
// smol startup code wires up; until then, this is always undefined.
const native = (globalThis as { process?: { _smolManifestNative?: unknown } })
  .process?._smolManifestNative as
  | {
      parseLockfile: (
        content: string | Buffer,
        ecosystem: number,
        format: number,
      ) => unknown
    }
  | undefined

// Per the binding contract — ecosystem + format are passed as numeric
// enum values to avoid string-marshal cost on every call. These
// constants match the C++ enum values defined in
// src/socketsecurity/manifest/manifest.h.
const ECO_NPM = 0
const ECO_CARGO = 1

const FMT_NPM = 0
const FMT_PNPM = 1
const FMT_YARN = 2
const FMT_CARGO = 3

interface Fixture {
  dir: string
  input: string
  ecosystem: number
  format: number
  // When `enabled: false`, the parser for this fixture's
  // ecosystem/format pair has not yet landed in the C++ port.
  // Test is registered as it.todo. Flip to true when the
  // corresponding parser_<format>.cc is wired up.
  enabled: boolean
}

const FIXTURES: Fixture[] = [
  {
    dir: 'fix1-npm-v1-alias',
    input: 'input.json',
    ecosystem: ECO_NPM,
    format: FMT_NPM,
    enabled: false,
  },
  {
    dir: 'fix2a-npm-v3-workspace-name',
    input: 'input.json',
    ecosystem: ECO_NPM,
    format: FMT_NPM,
    enabled: false,
  },
  {
    dir: 'fix2b-npm-v3-alias-name',
    input: 'input.json',
    ecosystem: ECO_NPM,
    format: FMT_NPM,
    enabled: false,
  },
  {
    dir: 'fix3a-pnpm-v9-empty-version',
    input: 'input.yaml',
    ecosystem: ECO_NPM,
    format: FMT_PNPM,
    enabled: false,
  },
  {
    dir: 'fix3b-pnpm-v9-workspace-file-filter',
    input: 'input.yaml',
    ecosystem: ECO_NPM,
    format: FMT_PNPM,
    enabled: false,
  },
  {
    dir: 'fix4-yarn-depsmeta-inversion',
    input: 'input.lock',
    ecosystem: ECO_NPM,
    format: FMT_YARN,
    enabled: false,
  },
  {
    dir: 'fix5-pnpm-v9-isdev-derivation',
    input: 'input.yaml',
    ecosystem: ECO_NPM,
    format: FMT_PNPM,
    enabled: false,
  },
  {
    dir: 'cargo-patch-unused-no-leak',
    input: 'input.toml',
    ecosystem: ECO_CARGO,
    format: FMT_CARGO,
    enabled: false,
  },
]

describe.skipIf(!native)(
  'smol_manifest_native binding — sdxgen-bug-regressions equivalence',
  () => {
    it('binding exposes parseLockfile()', () => {
      expect(native).toBeDefined()
      expect(typeof native!.parseLockfile).toBe('function')
    })

    // Fixture register cross-check — independent of binding presence.
    // (Pulled into this describe so the skipIf gates it too; the
    // fixture-register sanity check in smol-manifest.test.mts runs
    // regardless of binding state.)
    it('every fixture directory is wired into the table', () => {
      const onDisk = readdirSync(FIXTURES_DIR, { withFileTypes: true })
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort()
      const inTable = FIXTURES.map(f => f.dir).sort()
      expect(onDisk).toEqual(inTable)
    })

    for (const fixture of FIXTURES) {
      const title = `${fixture.dir} (C++ binding matches expected.json)`
      if (!fixture.enabled) {
        it.todo(title)
        continue
      }
      it(title, () => {
        const content = readFileSync(
          join(FIXTURES_DIR, fixture.dir, fixture.input),
          'utf8',
        )
        const expected = JSON.parse(
          readFileSync(
            join(FIXTURES_DIR, fixture.dir, 'expected.json'),
            'utf8',
          ),
        )
        const actual = native!.parseLockfile(
          content,
          fixture.ecosystem,
          fixture.format,
        )
        // Round-trip through JSON to normalize the frozen-null-proto
        // shape so toEqual compares structural value, not prototype
        // chain. This mirrors the matching pattern in
        // smol-manifest.test.mts.
        expect(JSON.parse(JSON.stringify(actual))).toEqual(expected)
      })
    }
  },
)
