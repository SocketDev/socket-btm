/**
 * Live smol_manifest_native binding verification.
 *
 * Runs the sdxgen-bug-regressions fixtures through the actual C++
 * binding inside the built smol Node binary. Unlike
 * test/smol-manifest-native.test.mts (which is vitest-driven and
 * skipped on stock Node where internalBinding is unavailable), this
 * script invokes node:smol-manifest directly and exits non-zero on
 * mismatch.
 *
 * Run with:
 *   build/dev/<platform-arch>/source/out/Release/node \
 *     test/smol-manifest-binding-live.mjs
 *
 * Wired into the equivalence-harness gate per step 4 of
 * docs/plans/smol-manifest-native-full.md.
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseLockfile } from 'node:smol-manifest'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, 'fixtures/sdxgen-bug-regressions')

// Fixture register — keep in sync with smol-manifest-native.test.mts.
// `enabled: false` fixtures are pending later parser-implementation
// commits (steps 5-7 for yarn / npm / cargo).
const FIXTURES = [
  { dir: 'fix1-npm-v1-alias', input: 'input.json', fmt: 'npm', enabled: true },
  { dir: 'fix2a-npm-v3-workspace-name', input: 'input.json', fmt: 'npm', enabled: true },
  { dir: 'fix2b-npm-v3-alias-name', input: 'input.json', fmt: 'npm', enabled: true },
  { dir: 'fix3a-pnpm-v9-empty-version', input: 'input.yaml', fmt: 'pnpm', enabled: true },
  { dir: 'fix3b-pnpm-v9-workspace-file-filter', input: 'input.yaml', fmt: 'pnpm', enabled: true },
  { dir: 'fix4-yarn-depsmeta-inversion', input: 'input.lock', fmt: 'yarn', enabled: true },
  { dir: 'fix5-pnpm-v9-isdev-derivation', input: 'input.yaml', fmt: 'pnpm', enabled: true },
  { dir: 'cargo-patch-unused-no-leak', input: 'input.toml', fmt: 'cargo', enabled: false },
]

// Cross-check on-disk dirs match the table.
{
  const onDisk = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .sort()
  const inTable = FIXTURES.map(f => f.dir).sort()
  if (JSON.stringify(onDisk) !== JSON.stringify(inTable)) {
    console.error('FIXTURE-TABLE-MISMATCH')
    console.error('  on disk:', onDisk)
    console.error('  in table:', inTable)
    process.exit(1)
  }
}

let pass = 0
let fail = 0
let skip = 0
const failures = []

for (const fixture of FIXTURES) {
  if (!fixture.enabled) {
    console.log(`SKIP  ${fixture.dir} (parser not yet ported)`)
    skip += 1
    continue
  }
  const content = readFileSync(
    join(FIXTURES_DIR, fixture.dir, fixture.input),
    'utf8',
  )
  const expected = JSON.parse(
    readFileSync(join(FIXTURES_DIR, fixture.dir, 'expected.json'), 'utf8'),
  )
  const actual = parseLockfile(content, 'npm', fixture.fmt)
  const ja = JSON.parse(JSON.stringify(actual))
  const jaStr = JSON.stringify(ja)
  const jeStr = JSON.stringify(expected)
  if (jaStr === jeStr) {
    console.log(`PASS  ${fixture.dir}`)
    pass += 1
  } else {
    console.log(`FAIL  ${fixture.dir}`)
    failures.push({ dir: fixture.dir, actual: jaStr, expected: jeStr })
    fail += 1
  }
}

console.log(`\n${pass} pass, ${fail} fail, ${skip} skip`)

if (fail > 0) {
  console.log('\nFailure details:')
  for (const f of failures) {
    console.log(`  ${f.dir}`)
    console.log(`    actual  : ${f.actual}`)
    console.log(`    expected: ${f.expected}`)
  }
  process.exit(1)
}
process.exit(0)
