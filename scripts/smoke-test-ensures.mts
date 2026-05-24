#!/usr/bin/env node
/**
 * @fileoverview Smoke-test each lib/ensure-X.mts public-API helper.
 *
 * For every builder package that ships a lib/ensure-X.mts, verifies:
 *   - The module imports without crashing (catches eager-loaded
 *     transitive deps that have ESM/CJS interop issues).
 *   - Each expected export is present.
 *   - `getCurrentXPlatformArch()` returns a non-empty string.
 *   - `getXLocalBuildDir(arch)` returns a path containing the builder name.
 *   - `xExists()` returns a boolean (no throw).
 *   - `verifyXAt(packageRoot)` returns `{ valid, missing }` with
 *     missing-files list when no build artifacts are present.
 *
 * Does NOT call `ensureX()` itself — that would attempt a network
 * download. The factory's catch-around-import is exercised by the
 * lazy-load of logTransientErrorHelp, not the smoke-test path.
 *
 * Exit code: 0 on all pass, 1 on any failure.
 *
 * Usage:
 *   node scripts/smoke-test-ensures.mts
 *   node scripts/smoke-test-ensures.mts --json
 */

import path from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const logger = getDefaultLogger()

interface EnsureSpec {
  name: string
  builderPath: string
  helperPath: string
  helperName: string
  getCurrent: string
  getLocalBuildDir: string
  exists: string
  existsAt: string
  verifyAt: string
}

const SPECS: EnsureSpec[] = [
  {
    builderPath: 'packages/codet5-models-builder',
    exists: 'codet5Exists',
    existsAt: 'codet5ExistsAt',
    getCurrent: 'getCurrentCodet5PlatformArch',
    getLocalBuildDir: 'getCodet5LocalBuildDir',
    helperName: 'ensureCodet5',
    helperPath: 'lib/ensure-codet5.mts',
    name: 'codet5',
    verifyAt: 'verifyCodet5At',
  },
  {
    builderPath: 'packages/curl-builder',
    exists: 'curlExists',
    existsAt: 'curlExistsAt',
    getCurrent: 'getCurrentCurlPlatformArch',
    getLocalBuildDir: 'getCurlLocalBuildDir',
    helperName: 'ensureCurl',
    helperPath: 'lib/ensure-curl.mts',
    name: 'curl',
    verifyAt: 'verifyCurlAt',
  },
  {
    builderPath: 'packages/dawn-builder',
    exists: 'dawnExists',
    existsAt: 'dawnExistsAt',
    getCurrent: 'getCurrentDawnPlatformArch',
    getLocalBuildDir: 'getDawnLocalBuildDir',
    helperName: 'ensureDawn',
    helperPath: 'lib/ensure-dawn.mts',
    name: 'dawn',
    verifyAt: 'verifyDawnAt',
  },
  {
    builderPath: 'packages/libpq-builder',
    exists: 'libpqExists',
    existsAt: 'libpqExistsAt',
    getCurrent: 'getCurrentLibpqPlatformArch',
    getLocalBuildDir: 'getLibpqLocalBuildDir',
    helperName: 'ensureLibpq',
    helperPath: 'lib/ensure-libpq.mts',
    name: 'libpq',
    verifyAt: 'verifyLibpqAt',
  },
  {
    builderPath: 'packages/minilm-builder',
    exists: 'minilmExists',
    existsAt: 'minilmExistsAt',
    getCurrent: 'getCurrentMinilmPlatformArch',
    getLocalBuildDir: 'getMinilmLocalBuildDir',
    helperName: 'ensureMinilm',
    helperPath: 'lib/ensure-minilm.mts',
    name: 'minilm',
    verifyAt: 'verifyMinilmAt',
  },
  {
    builderPath: 'packages/onnxruntime-builder',
    exists: 'onnxruntimeExists',
    existsAt: 'onnxruntimeExistsAt',
    getCurrent: 'getCurrentOnnxruntimePlatformArch',
    getLocalBuildDir: 'getOnnxruntimeLocalBuildDir',
    helperName: 'ensureOnnxruntime',
    helperPath: 'lib/ensure-onnxruntime.mts',
    name: 'onnxruntime',
    verifyAt: 'verifyOnnxruntimeAt',
  },
  {
    builderPath: 'packages/opentui-builder',
    exists: 'opentuiExists',
    existsAt: 'opentuiExistsAt',
    getCurrent: 'getCurrentOpentuiPlatformArch',
    getLocalBuildDir: 'getOpentuiLocalBuildDir',
    helperName: 'ensureOpentui',
    helperPath: 'lib/ensure-opentui.mts',
    name: 'opentui',
    verifyAt: 'verifyOpentuiAt',
  },
  {
    builderPath: 'packages/ultraviolet-builder',
    exists: 'ultravioletExists',
    existsAt: 'ultravioletExistsAt',
    getCurrent: 'getCurrentUltravioletPlatformArch',
    getLocalBuildDir: 'getUltravioletLocalBuildDir',
    helperName: 'ensureUltraviolet',
    helperPath: 'lib/ensure-ultraviolet.mts',
    name: 'ultraviolet',
    verifyAt: 'verifyUltravioletAt',
  },
  {
    builderPath: 'packages/yoga-layout-builder',
    exists: 'yogaExists',
    existsAt: 'yogaExistsAt',
    getCurrent: 'getCurrentYogaPlatformArch',
    getLocalBuildDir: 'getYogaLocalBuildDir',
    helperName: 'ensureYoga',
    helperPath: 'lib/ensure-yoga.mts',
    name: 'yoga-layout',
    verifyAt: 'verifyYogaAt',
  },
]

interface CheckResult {
  spec: EnsureSpec
  ok: boolean
  errors: string[]
}

export async function smokeTest(spec: EnsureSpec): Promise<CheckResult> {
  const errors: string[] = []
  const fullPath = path.join(repoRoot, spec.builderPath, spec.helperPath)
  let mod: Record<string, unknown>
  try {
    // oxlint-disable-next-line socket/no-dynamic-import-outside-bundle -- import path is computed from the SPECS table (one per builder); a static import per builder would defeat the purpose of the iterator pattern.
    mod = (await import(fullPath)) as Record<string, unknown>
  } catch (e) {
    return {
      errors: [`module import failed: ${e instanceof Error ? e.message : String(e)}`],
      ok: false,
      spec,
    }
  }
  const expected = [
    spec.exists,
    spec.existsAt,
    spec.getCurrent,
    spec.getLocalBuildDir,
    spec.helperName,
    spec.verifyAt,
  ]
  for (let i = 0, { length } = expected; i < length; i += 1) {
    const name = expected[i]!
    if (typeof mod[name] !== 'function') {
      errors.push(`missing export: ${name}`)
    }
  }
  if (errors.length > 0) {
    return { errors, ok: false, spec }
  }
  try {
    const arch = (mod[spec.getCurrent] as () => string)()
    if (typeof arch !== 'string' || arch.length === 0) {
      errors.push(`${spec.getCurrent}() returned ${JSON.stringify(arch)}`)
    }
    const dir = (mod[spec.getLocalBuildDir] as (a: string) => string)(arch)
    if (typeof dir !== 'string' || !dir.includes(spec.builderPath.split('/').pop()!)) {
      errors.push(
        `${spec.getLocalBuildDir}() returned ${JSON.stringify(dir)} (expected path under ${spec.builderPath})`,
      )
    }
    const exists = (mod[spec.exists] as () => boolean)()
    if (typeof exists !== 'boolean') {
      errors.push(`${spec.exists}() returned ${typeof exists}, expected boolean`)
    }
    const builderRoot = path.join(repoRoot, spec.builderPath)
    const verify = (
      mod[spec.verifyAt] as (d: string) => { valid: boolean; missing: string[] }
    )(builderRoot)
    if (typeof verify.valid !== 'boolean' || !Array.isArray(verify.missing)) {
      errors.push(
        `${spec.verifyAt}(builderRoot) returned malformed shape: ${JSON.stringify(verify)}`,
      )
    }
  } catch (e) {
    errors.push(
      `runtime error: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  return { errors, ok: errors.length === 0, spec }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      json: { type: 'boolean' },
    },
    strict: false,
  })

  const results: CheckResult[] = []
  for (let i = 0, { length } = SPECS; i < length; i += 1) {
    results.push(await smokeTest(SPECS[i]!))
  }

  if (values.json) {
    logger.log(JSON.stringify(results, null, 2))
    return
  }

  const passes = results.filter(r => r.ok)
  const failures = results.filter(r => !r.ok)

  for (let i = 0, { length } = results; i < length; i += 1) {
    const r = results[i]!
    if (r.ok) {
      logger.success(`${r.spec.name}`)
    } else {
      logger.fail(`${r.spec.name}`)
      for (let j = 0, { length: jLen } = r.errors; j < jLen; j += 1) {
        logger.fail(`  ${r.errors[j]!}`)
      }
    }
  }

  logger.log('')
  logger.log(`${passes.length} passed, ${failures.length} failed`)

  if (failures.length > 0) {
    process.exitCode = 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    logger.fail(`smoke-test failed: ${err}`)
    process.exitCode = 1
  })
}
