#!/usr/bin/env node

/**
 * @fileoverview Assert a FULL-feature node-smol binary includes every gated
 * subsystem. The CI guard for the default (untrimmed) build.
 *
 * USAGE:
 *   pnpm --filter node-smol-builder run assert-full-features [--binary=PATH]
 *
 * The bundle feature detector + gates let per-bundle builds compile subsystems
 * out. The DEFAULT build must still ship them ALL — a gyp/configure regression
 * (e.g. a node_use_smol_* default flipped, or a gate condition mis-wired) would
 * silently drop a feature from the full build, and the per-feature test suites
 * would just `skipIf(!has(x))` past it. This script makes that a HARD failure:
 * for every feature with a `node:` specifier, assert it resolves on the binary.
 *
 * Wire into CI after the full build's smoke test. Exits non-zero on any missing
 * feature. With no binary built, exits 0 (nothing to assert) unless
 * --require-binary is passed.
 */

import { existsSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  SMOL_FEATURES,
  featureBuiltinSpecifier,
} from './lib/smol-features.mts'
import { getLatestFinalBinary, getLatestStrippedBinary } from '../test/paths.mts'

const __filename = fileURLToPath(import.meta.url)
const logger = getDefaultLogger()

export function probeBuiltin(binary: string, specifier: string): boolean {
  try {
    const r = spawnSync(
      binary,
      ['-e', `process.stdout.write(String(require("node:module").isBuiltin("${specifier}")))`],
      { encoding: 'utf8', timeout: 5000 },
    )
    return String(r.stdout ?? '').trim() === 'true'
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2)[0] === '--' ? process.argv.slice(3) : process.argv.slice(2),
    options: {
      binary: { type: 'string' },
      'require-binary': { type: 'boolean' },
    },
    strict: false,
  })

  const binary =
    (values['binary'] as string | undefined) ??
    getLatestFinalBinary() ??
    getLatestStrippedBinary()

  if (!binary || !existsSync(binary)) {
    if (values['require-binary']) {
      logger.fail('No node-smol binary found and --require-binary was set.')
      process.exitCode = 1
      return
    }
    logger.warn('No node-smol binary built — nothing to assert (pass --require-binary to fail).')
    return
  }

  // Every feature that has an importable node: specifier must resolve on a full
  // build. intl/temporal (globals, no specifier) are excluded — nothing to import.
  const gated = SMOL_FEATURES.filter(f => featureBuiltinSpecifier(f.name))
  const missing: string[] = []
  logger.log(`Asserting all gated features present in: ${binary}`)
  for (const f of gated) {
    const specifier = featureBuiltinSpecifier(f.name)!
    const present = probeBuiltin(binary, specifier)
    logger.log(`  [${present ? 'ok' : 'MISSING'}] ${specifier}`)
    if (!present) {
      missing.push(f.name)
    }
  }

  if (missing.length) {
    logger.fail(
      `Full build is MISSING gated feature(s): ${missing.join(', ')}. ` +
        'A node_use_smol_* default or gyp gate regressed — the default build must ship every subsystem.',
    )
    process.exitCode = 1
    return
  }
  logger.log(`All ${gated.length} gated features present.`)
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
