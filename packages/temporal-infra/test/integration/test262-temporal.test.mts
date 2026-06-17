/**
 * @fileoverview Test262 Temporal subset conformance gate (vitest wrapper).
 *
 * Spawns the rich CLI runner at test/scripts/test262-temporal-runner.mts
 * and asserts exit code 0. The runner walks the upstream test262 corpus,
 * runs each test through node-smol, classifies against
 * test262-config/test262.allowlist, and exits non-zero on regression OR
 * stale allowlist entry.
 *
 * Why spawn-and-check rather than inline `test.each`: the runner has
 * rich CLI flags (--include, --limit, --json, --binary, --no-intl) we
 * want preserved for dev debugging. Failures classify against an
 * allowlist; only unexpected regressions should fail the gate. Vitest's
 * per-test reporter doesn't compose with that classification cleanly;
 * the runner's own report does.
 */

import { describe, expect, it, test } from 'vitest'

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getNodeSmolFinalBinary } from '../../lib/paths.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.resolve(
  __dirname,
  '..',
  'scripts',
  'test262-temporal-runner.mts',
)

// Gate the suite on the node-smol Final/ binary being present — the
// runner spawns subprocesses against it for each test. CI / fresh
// checkouts without a build will skip.
const skipTests = !existsSync(getNodeSmolFinalBinary())

// Runner walks ~3k Temporal tests × multiple scenarios. Budget generous.
const TIMEOUT_MS = 30 * 60 * 1000

describe.skipIf(skipTests)('Test262 Temporal conformance', () => {
  it('no unexpected failures vs test262.allowlist', async () => {
    const result = await spawn('node', [RUNNER], { stdio: 'inherit' })
    expect(result.code).toBe(0)
  }, TIMEOUT_MS)
})
