/**
 * Equivalence harness for the smol-manifest C++ binding.
 *
 * Spawns the built smol Node binary (out/Release/node) on the live
 * verifier script (test/smol-manifest-binding-live.mjs), which
 * exercises every sdxgen-bug-regressions fixture through the C++
 * binding and exits non-zero on any mismatch.
 *
 * Why a subprocess instead of in-process: vitest runs under stock
 * Node, where the `node:smol-manifest` module / `internalBinding`
 * surface isn't exposed. The subprocess approach lets the same
 * vitest CI lane catch binding regressions without requiring a
 * smol-Node-aware test runner.
 *
 * Behavior:
 *  - When build/<mode>/<platform-arch>/source/out/Release/node exists,
 *    spawn it on the verifier and assert exit 0 + verify the output
 *    enumerates every expected fixture as PASS.
 *  - When it doesn't exist (clean checkout, CI lane that hasn't run
 *    `pnpm build`), skip the suite with a clear message.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { describe, expect, it } from 'vitest'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures/sdxgen-bug-regressions')
const LIVE_VERIFIER = join(__dirname, 'smol-manifest-binding-live.mjs')
const REAL_FIXTURE_VERIFIER = join(__dirname, 'smol-manifest-real-fixture.mjs')

// The build pipeline emits the smol Node binary at
// build/<mode>/<platform-arch>/source/out/Release/node. We only
// support darwin-arm64 dev for local iteration; CI builds populate
// the same shape on linux-x64 / linux-arm64.
//
// Pick the first existing path. The list is intentionally short —
// we don't want to silently exercise stale binaries from past
// platform-arch builds.
const PLATFORM_ARCH = `${process.platform}-${process.arch}`
const SMOL_BINARY_CANDIDATES = [
  join(
    __dirname,
    '..',
    'build',
    'dev',
    PLATFORM_ARCH,
    'source',
    'out',
    'Release',
    'node',
  ),
  join(
    __dirname,
    '..',
    'build',
    'dev',
    PLATFORM_ARCH,
    'out',
    'Final',
    'node',
    'node',
  ),
]

export function findSmolBinary(): string | undefined {
  for (let i = 0, { length } = SMOL_BINARY_CANDIDATES; i < length; i += 1) {
    const candidate = SMOL_BINARY_CANDIDATES[i]
    if (existsSync(candidate)) {
      return candidate
    }
  }
  return undefined
}

const smolBinary = findSmolBinary()

// Every fixture that should appear in the verifier output. Kept in
// lock-step with FIXTURES in smol-manifest-binding-live.mjs.
const EXPECTED_FIXTURE_NAMES = [
  'fix1-npm-v1-alias',
  'fix2a-npm-v3-workspace-name',
  'fix2b-npm-v3-alias-name',
  'fix3a-pnpm-v9-empty-version',
  'fix3b-pnpm-v9-workspace-file-filter',
  'fix4-yarn-depsmeta-inversion',
  'fix5-pnpm-v9-isdev-derivation',
  'cargo-patch-unused-no-leak',
]

describe('smol_manifest_native binding — sdxgen-bug-regressions equivalence', () => {
  // The fixture register cross-check runs even without a smol
  // binary — catches "added a fixture dir but forgot to wire it
  // into the live verifier" before the smol-only assertions
  // would fail with a less specific error.
  it('every fixture directory is wired into EXPECTED_FIXTURE_NAMES', () => {
    const onDisk = readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .toSorted()
    expect(onDisk).toEqual([...EXPECTED_FIXTURE_NAMES].toSorted())
  })

  it.skipIf(!smolBinary)('live binding verifies all fixtures PASS', () => {
    const result = spawnSync(smolBinary!, [LIVE_VERIFIER], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output = String(result.stdout ?? '')
    // Confirm every expected fixture name appears with PASS.
    for (let i = 0, { length } = EXPECTED_FIXTURE_NAMES; i < length; i += 1) {
      const name = EXPECTED_FIXTURE_NAMES[i]
      expect(output).toContain(`PASS  ${name}`)
    }
    // Confirm zero failures in the trailing summary.
    expect(output).toMatch(/\b0 fail\b/)
    // Confirm zero skips (all parsers ported).
    expect(output).toMatch(/\b0 skip\b/)
  })

  it.skipIf(!smolBinary)(
    "parses socket-btm's own pnpm-lock.yaml without malformed entries",
    () => {
      const result = spawnSync(smolBinary!, [REAL_FIXTURE_VERIFIER], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const output = String(result.stdout ?? '')
      expect(output).toContain('PASS')
      expect(output).not.toContain('FAIL')
    },
  )
})
