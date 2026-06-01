#!/usr/bin/env node

/**
 * @fileoverview Bundle-driven node-smol compile orchestrator (plan + invoke).
 *
 * USAGE:
 *   pnpm --filter node-smol-builder run compile-for-bundle -- \
 *     --bundle=path/to/main.js [--vfs=path/to/vfs.tar] [--overrides=package.json] \
 *     [--v8-lite] [--prod] [--dry-run]
 *
 * Pipeline (see docs/plans/bundle-driven-module-detection.md):
 *   1. Run the static detector on the SEA bundle → feature manifest + flags.
 *   2. Compute a cache key = sha256(SOURCE_PATCHED id + sorted flags + platform).
 *      Two bundles with the same feature set hit the same compiled cache entry.
 *   3. Invoke the existing build, resuming from the shared SOURCE_PATCHED
 *      checkpoint (clone + patch are done once and shared), passing the detector's
 *      --without-smol-* flags via `build.mts --without-smol=…`. Only configure +
 *      make + strip run per distinct flag set — the expensive clone/patch prefix
 *      is reused.
 *
 * --dry-run prints the resolved plan (manifest summary, flags, cache key, the
 * exact build command) WITHOUT building. The detector + flag mapping are fully
 * exercised; only the 30–60 min compile is skipped.
 *
 * This orchestrator does NOT itself trim the binary — it hands flags to the
 * build, whose output is then gated by the fail-closed step (run the app suite
 * + absence/fallback probes against the trimmed binary) before it ships.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { detectBundleFeatures } from './detect-bundle-features.mts'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

const SOURCE_PATCHED = 'source-patched'

/**
 * Cache key for the compiled output of a given flag set. The shared prefix
 * (clone → patch) is keyed by Node version + patch set elsewhere; this keys the
 * configure+make+strip layer so identical flag sets on the same platform reuse
 * one compiled binary. Sorted so flag order doesn't matter.
 */
export function computeCacheKey(opts: {
  configureFlags: string[]
  platformArch: string
  buildMode: string
}): string {
  const sorted = [...opts.configureFlags].toSorted()
  const material = JSON.stringify({
    sourceStage: SOURCE_PATCHED,
    flags: sorted,
    platformArch: opts.platformArch,
    buildMode: opts.buildMode,
  })
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}


async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2)[0] === '--' ? process.argv.slice(3) : process.argv.slice(2),
    options: {
      bundle: { type: 'string' },
      vfs: { type: 'string' },
      overrides: { type: 'string' },
      'v8-lite': { type: 'boolean' },
      prod: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
    },
    strict: false,
  })

  const bundlePath = values['bundle'] as string | undefined
  if (!bundlePath || !existsSync(bundlePath)) {
    logger.fail(`--bundle is required and must exist (got: ${bundlePath ?? '<none>'})`)
    process.exitCode = 1
    return
  }
  const vfsPath = values['vfs'] as string | undefined

  let overrides: { keep?: string[] | undefined; drop?: string[] | undefined } | undefined
  const overridesPath = values['overrides'] as string | undefined
  if (overridesPath) {
    try {
      const { promises: fs } = await import('node:fs')
      const pkg = JSON.parse(await fs.readFile(overridesPath, 'utf8'))
      overrides = pkg?.smol ? { keep: pkg.smol.keep, drop: pkg.smol.drop } : undefined
    } catch (e) {
      logger.warn(`could not read overrides: ${errorMessage(e)}`)
    }
  }

  // 1. Detect.
  const manifest = await detectBundleFeatures({ bundlePath, vfsPath, overrides })
  const wantV8Lite = Boolean(values['v8-lite']) && manifest.v8Lite.recommended
  const allFlags = [...manifest.configureFlags]
  if (wantV8Lite && !allFlags.includes('--v8-lite-mode')) {
    allFlags.push('--v8-lite-mode')
  }

  // 2. Cache key.
  const platformArch = await getCurrentPlatformArch()
  const buildMode = values['prod'] ? 'prod' : 'dev'
  const cacheKey = computeCacheKey({
    configureFlags: allFlags,
    platformArch,
    buildMode,
  })

  // 3. Build command. build.mts's --without-smol accepts bare feature names OR
  // raw `--…` flags verbatim, so the whole flag set (including --v8-lite-mode)
  // forwards through the one channel.
  const v8Lite = allFlags.includes('--v8-lite-mode')
  const buildArgs = [
    path.join(__dirname, 'common/shared/build.mts'),
    `--from-checkpoint=${SOURCE_PATCHED}`,
    buildMode === 'prod' ? '--prod' : '--dev',
  ]
  if (allFlags.length) {
    buildArgs.push(`--without-smol=${allFlags.join(',')}`)
  }

  const dropped = Object.entries(manifest.features)
    .filter(([, v]) => v.drop)
    .map(([k]) => k)

  logger.log(`Bundle:      ${bundlePath}`)
  logger.log(`Hash:        ${manifest.bundleHash}`)
  logger.log(`Platform:    ${platformArch} (${buildMode})`)
  logger.log(`Dropping:    ${dropped.join(', ') || '(none)'}`)
  logger.log(`V8-lite:     ${v8Lite ? 'yes' : `no${manifest.v8Lite.recommended ? ' (recommended; pass --v8-lite to apply)' : ''}`}`)
  logger.log(`Flags:       ${allFlags.join(' ') || '(none)'}`)
  logger.log(`Cache key:   ${cacheKey}`)
  logger.log(`Build cmd:   node ${buildArgs.join(' ')}`)

  if (values['dry-run']) {
    logger.log('')
    logger.log('--dry-run: detection + plan only, not building.')
    return
  }

  // Invoke the build, resuming from the shared SOURCE_PATCHED checkpoint.
  logger.log('')
  logger.log('Starting build (resume from source-patched)…')
  const r = await spawn('node', buildArgs, { stdio: 'inherit' })
  if (r.code !== 0) {
    logger.fail(`build failed (exit ${r.code})`)
    process.exitCode = r.code ?? 1
  }
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
