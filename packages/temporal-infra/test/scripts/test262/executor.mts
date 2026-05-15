/**
 * @fileoverview Test262 binary resolver, allowlist loader, and per-
 * test executor.
 *
 * The only module here that actually spawns the binary. Pure I/O +
 * spawn — no classification logic.
 */

import { existsSync, readFileSync } from 'node:fs'

// Per fleet convention (CLAUDE.md "Spawn helpers"): use
// `@socketsecurity/lib/spawn`'s exports, not `node:child_process`. The
// lib's `spawnSync` is signature-compatible with node's — drop-in
// replacement. `spawn` (async) would also work here but `runOneTest`
// is called from a sync corpus walker, so the sync variant is the
// right pick.
import { spawnSync } from '@socketsecurity/lib-stable/spawn'

import { getNodeSmolFinalBinary } from '../../../lib/paths.mts'

import { composeScript } from './harness.mts'
import type { Test, TestCase } from './types.mts'

export function loadAllowlist(filePath: string): string[] {
  if (!existsSync(filePath)) {
    return []
  }
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
}

export function resolveBinary(override?: string): string {
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`Binary not found at --binary ${override}`)
    }
    return override
  }
  const candidate = getNodeSmolFinalBinary()
  if (!existsSync(candidate)) {
    throw new Error(
      `Built node-smol binary not found at ${candidate}\n` +
        `Run \`pnpm --filter node-smol-builder run build\` first, ` +
        `or pass --binary <path>.`,
    )
  }
  return candidate
}

export function runOneTest(
  test: TestCase,
  scenario: 'strict' | 'sloppy' | 'raw',
  binary: string,
): Test {
  const script =
    scenario === 'raw'
      ? test.source
      : composeScript(test, scenario as 'strict' | 'sloppy')
  const result = spawnSync(binary, ['-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const stderr = result.stderr ?? ''
  const stdout = result.stdout ?? ''
  // Non-zero exit OR Test262Error in stdout (sta.js's throwing
  // assertion writes the error to stdout via Test262Error.toString).
  const actualError =
    result.status !== 0 || stderr.length > 0 || stdout.includes('Test262Error')

  const expectedError = test.attrs.negative !== undefined

  // Build detail only when we'd want to inspect — saves memory on
  // long runs. Allowlist matching doesn't read .detail.
  let detail: string | undefined
  if (expectedError !== actualError) {
    detail = (stderr || stdout).slice(0, 400)
  }

  return {
    file: test.file,
    scenario,
    expectedError,
    actualError,
    detail,
  }
}

export function shouldSkip(test: TestCase): string | undefined {
  if (test.attrs.async) {
    return 'async (not yet supported)'
  }
  if (test.attrs.module) {
    return 'module (not yet supported via -e)'
  }
  return undefined
}
