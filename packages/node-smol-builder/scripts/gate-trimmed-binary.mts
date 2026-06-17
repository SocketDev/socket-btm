#!/usr/bin/env node

/**
 * @file Fail-closed gate for a bundle-trimmed node-smol binary.
 *   USAGE:
 *   pnpm --filter node-smol-builder run gate --\
 *   --binary=path/to/trimmed/node --bundle=path/to/main.js\
 *   [--vfs=path/to/vfs.tar] [--overrides=package.json]\
 *   [--suite="<shell command that runs the app's tests against $SMOL_BINARY>"]
 *   The detector is ADVISORY; this gate is what makes dropping features safe. After
 *   compile-for-bundle.mts produces a trimmed binary, this verifies — and FAILS
 *   THE BUILD (non-zero exit) on any problem — three things:
 *
 *   1. Absence probes: every feature the manifest marked `drop:true` is genuinely
 *      gone — `isBuiltin('node:<specifier>')` returns false on the trimmed
 *      binary. Catches a wiring bug where a flag was emitted but the gate
 *      didn't fire.
 *   2. Presence probes: every feature the manifest KEPT is still importable.
 *      Catches over-trimming (a flag that dropped more than intended).
 *   3. Soft-use fallback: for `soft` features that were dropped, the app must run
 *      its fallback path with the binding absent (handled by the app suite +,
 *      if provided, a fallback assertion). Plus the app's own suite must pass
 *      against the trimmed binary — a missed dynamic require dies here, not in
 *      production. Probe logic (checkBinaryFeatures) is pure and unit-tested
 *      against stock Node. The app-suite run requires a real trimmed binary
 *      (built by compile-for-bundle).
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import {
  spawn,
  spawnSync,
} from '@socketsecurity/lib-stable/process/spawn/child'

import { detectBundleFeatures } from './detect-bundle-features.mts'
import { featureBuiltinSpecifier, SMOL_FEATURES } from './lib/smol-features.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

export type FeatureExpectation = {
  __proto__: null
  feature: string
  /**
   * What the manifest decided: true = should be ABSENT, false = should be
   * PRESENT.
   */
  expectDropped: boolean
}

export type ProbeFinding = {
  __proto__: null
  feature: string
  specifier: string
  expectedPresent: boolean
  actualPresent: boolean
  ok: boolean
}

/**
 * Probe a binary: for each expectation, run `isBuiltin('node:<specifier>')` and
 * compare to what the manifest expected. Pure except for spawning the binary
 * (injected via `probe` for testing). Returns one finding per feature that has
 * an importable specifier (intl/temporal have none → skipped, never gated out).
 *
 * `probe(binary, specifier)` returns whether `node:<specifier>` resolves.
 */
export function checkBinaryFeatures(
  binary: string,
  expectations: readonly FeatureExpectation[],
  probe: (binary: string, specifier: string) => boolean,
): ProbeFinding[] {
  const findings: ProbeFinding[] = []
  for (const exp of expectations) {
    const specifier = featureBuiltinSpecifier(exp.feature)
    if (!specifier) {
      continue // no importable module (intl/temporal) — nothing to probe
    }
    const actualPresent = probe(binary, specifier)
    const expectedPresent = !exp.expectDropped
    findings.push({
      __proto__: null,
      feature: exp.feature,
      specifier,
      expectedPresent,
      actualPresent,
      ok: actualPresent === expectedPresent,
    })
  }
  return findings
}

/**
 * Default probe: spawn the binary and test whether the module actually LOADS,
 * not merely whether isBuiltin() reports it. A trimmed feature's native binding
 * is gated out of the build, but its JS wrapper (lib/smol-*.js) can linger in
 * the builtins manifest — so isBuiltin('node:smol-quic') stays true while
 * require() throws ERR_INVALID_MODULE (the wrapper can't reach its missing
 * binding). Loadability is the truth: "present" = require() succeeds.
 *
 * Prints "1" on successful load, "0" otherwise. Fail-closed: any spawn error →
 * "present" so an unprobeable binary can't silently satisfy an expect-absent.
 */
export function spawnProbe(binary: string, specifier: string): boolean {
  try {
    const r = spawnSync(
      binary,
      [
        '-e',
        `try { require(${JSON.stringify(specifier)}); process.stdout.write("1") } ` +
          `catch { process.stdout.write("0") }`,
      ],
      { encoding: 'utf8', timeout: 5000 },
    )
    return String(r.stdout ?? '').trim() === '1'
  } catch {
    return true
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args:
      process.argv.slice(2)[0] === '--'
        ? process.argv.slice(3)
        : process.argv.slice(2),
    options: {
      binary: { type: 'string' },
      bundle: { type: 'string' },
      vfs: { type: 'string' },
      overrides: { type: 'string' },
      suite: { type: 'string' },
    },
    strict: false,
  })

  const binary = values['binary'] as string | undefined
  const bundlePath = values['bundle'] as string | undefined
  if (!binary || !existsSync(binary)) {
    logger.fail(
      `--binary is required and must exist (got: ${binary ?? '<none>'})`,
    )
    process.exitCode = 1
    return
  }
  if (!bundlePath || !existsSync(bundlePath)) {
    logger.fail(
      `--bundle is required and must exist (got: ${bundlePath ?? '<none>'})`,
    )
    process.exitCode = 1
    return
  }

  let overrides:
    | { keep?: string[] | undefined; drop?: string[] | undefined }
    | undefined
  const overridesPath = values['overrides'] as string | undefined
  if (overridesPath) {
    try {
      const { promises: fs } = await import('node:fs')
      const pkg = JSON.parse(await fs.readFile(overridesPath, 'utf8'))
      overrides = pkg?.smol
        ? { keep: pkg.smol.keep, drop: pkg.smol.drop }
        : undefined
    } catch (e) {
      logger.warn(`could not read overrides: ${errorMessage(e)}`)
    }
  }

  // Re-derive the manifest the trimmed binary was built from (same inputs).
  const manifest = await detectBundleFeatures({
    bundlePath,
    vfsPath: values['vfs'] as string | undefined,
    overrides,
  })

  const expectations: FeatureExpectation[] = SMOL_FEATURES.map(f => ({
    __proto__: null,
    feature: f.name,
    expectDropped: manifest.features[f.name]?.drop === true,
  }))

  let failed = false

  // 1 + 2. Absence / presence probes.
  const findings = checkBinaryFeatures(binary, expectations, spawnProbe)
  logger.log('Feature probes (expected vs actual presence):')
  for (const f of findings) {
    const tag = f.ok ? 'ok' : 'FAIL'
    logger.log(
      `  [${tag}] ${f.feature.padEnd(12)} expect ${f.expectedPresent ? 'present' : 'absent '} → ${f.actualPresent ? 'present' : 'absent'}`,
    )
    if (!f.ok) {
      failed = true
    }
  }

  // 3. Soft-use features that were dropped — flag for the operator; the app suite
  // is what actually exercises the fallback path.
  const droppedSoft = SMOL_FEATURES.filter(
    f => f.policy === 'soft' && manifest.features[f.name]?.drop,
  )
  if (droppedSoft.length) {
    logger.log(
      `Soft-use features dropped (app suite must exercise fallback): ${droppedSoft.map(f => f.name).join(', ')}`,
    )
  }

  // App suite against the trimmed binary — the real backstop for dynamic requires.
  const suite = values['suite'] as string | undefined
  if (suite) {
    logger.log(`Running app suite against trimmed binary:\n  ${suite}`)
    const r = await spawn('sh', ['-c', suite], {
      stdio: 'inherit',
      env: { ...process.env, SMOL_BINARY: binary },
    })
    if (r.code !== 0) {
      logger.fail(`app suite FAILED against trimmed binary (exit ${r.code})`)
      failed = true
    }
  } else {
    logger.warn(
      'No --suite provided: skipping the app-suite backstop. Absence/presence ' +
        'probes ran, but a missed dynamic require() would NOT be caught. Pass ' +
        '--suite to run the consumer tests against the trimmed binary.',
    )
  }

  if (failed) {
    logger.fail(
      'GATE FAILED — trimmed binary did not pass. Build must not ship.',
    )
    process.exitCode = 1
    return
  }
  logger.log('GATE PASSED — trimmed binary verified.')
}

if (import.meta.url === toFileUrl(process.argv[1])) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}

export function toFileUrl(p: string | undefined): string {
  return p ? new URL(`file://${path.resolve(p)}`).href : ''
}
