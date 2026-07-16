#!/usr/bin/env node
/**
 * @file Entrypoint for the detect-bundle-features CLI.
 *   Drives the feature-detection pipeline for a consumer's SEA bundle and
 *   emits either a JSON manifest or a human-readable report. Split from
 *   detect-bundle-features.mts to keep each file under the 500-line soft cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'

import { errorMessage } from 'build-infra/lib/error-utils'

import { SMOL_FEATURES } from './lib/smol-features.mts'
import { detectBundleFeatures } from './detect-bundle-features.mts'

const logger = getDefaultLogger()

export function replacerStripProto(_key: string, value: unknown): unknown {
  return value
}

export function pathToFileURLString(p: string | undefined): string {
  if (!p) {
    return ''
  }
  return new URL(`file://${path.resolve(p)}`).href
}

async function main(): Promise<void> {
  // `pnpm run detect -- --bundle=…` forwards a literal `--` into argv, which
  // parseArgs treats as end-of-options. Drop a leading `--` so both the direct
  // `node scripts/…` form and the `pnpm run` form behave the same.
  const rawArgs = process.argv.slice(2)
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs
  const { values } = parseArgs({
    args,
    options: {
      bundle: { type: 'string' },
      vfs: { type: 'string' },
      overrides: { type: 'string' },
      'v8-lite': { type: 'boolean' },
      json: { type: 'boolean' },
    },
    strict: false,
  })

  const bundlePath = values['bundle'] as string | undefined
  if (!bundlePath || !existsSync(bundlePath)) {
    logger.fail(
      `--bundle is required and must exist (got: ${bundlePath ?? '<none>'})`,
    )
    process.exitCode = 1
    return
  }
  const vfsPath = values['vfs'] as string | undefined
  if (vfsPath && !existsSync(vfsPath)) {
    logger.fail(`--vfs path does not exist: ${vfsPath}`)
    process.exitCode = 1
    return
  }

  let overrides:
    | { keep?: string[] | undefined; drop?: string[] | undefined }
    | undefined
  const overridesPath = values['overrides'] as string | undefined
  if (overridesPath) {
    try {
      const pkg = JSON.parse(await fs.readFile(overridesPath, 'utf8'))
      overrides = pkg?.smol
        ? { keep: pkg.smol.keep, drop: pkg.smol.drop }
        : undefined
    } catch (e) {
      logger.warn(
        `could not read overrides from ${overridesPath}: ${errorMessage(e)}`,
      )
    }
  }

  const manifest = await detectBundleFeatures({
    bundlePath,
    vfsPath,
    overrides,
  })

  // The operator may force the V8-lite recommendation into the emitted flags.
  if (values['v8-lite'] && manifest.v8Lite.recommended) {
    manifest.configureFlags.push('--v8-lite-mode')
  }

  if (values['json']) {
    logger.log(JSON.stringify(manifest, replacerStripProto, 2))
    return
  }

  // Human report.
  logger.log(`Bundle: ${bundlePath}`)
  logger.log(`Hash:   ${manifest.bundleHash}`)
  logger.log('')
  logger.log('Feature          Use    Drop  Reason')
  logger.log('───────────────  ─────  ────  ──────')
  for (const f of SMOL_FEATURES) {
    const v = manifest.features[f.name]!
    logger.log(
      `${f.name.padEnd(15)}  ${v.use.padEnd(5)}  ${(v.drop ? 'yes' : 'no').padEnd(4)}  ${v.reason}`,
    )
  }
  logger.log('')
  const dropped = SMOL_FEATURES.filter(f => manifest.features[f.name]!.drop)
  const savedMb = dropped.reduce((s, f) => s + f.approxBinaryMb, 0)
  logger.log(
    `Dropping ${dropped.length} feature(s) — est. ~${savedMb.toFixed(1)}MB binary reduction`,
  )
  logger.log(
    `V8-lite: ${manifest.v8Lite.recommended ? 'RECOMMENDED' : 'no'} — ${manifest.v8Lite.reason}`,
  )
  if (manifest.ambiguous.length) {
    logger.warn(
      `Ambiguous (kept conservatively): ${manifest.ambiguous.join(', ')}`,
    )
  }
  logger.log('')
  logger.log(
    `Configure flags: ${manifest.configureFlags.join(' ') || '(none)'}`,
  )
}

// Run as a script (not when imported by tests).
if (import.meta.url === pathToFileURLString(process.argv[1])) {
  main().catch((e: unknown) => {
    logger.fail(errorMessage(e))
    process.exitCode = 1
  })
}
