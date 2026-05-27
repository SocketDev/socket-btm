/**
 * @fileoverview WHATWG Streams WPT conformance gate (vitest wrapper).
 *
 * Spawns the rich CLI runner at test/scripts/wpt-streams-runner.mts
 * as a subprocess and asserts exit code 0. The runner does the actual
 * spec test execution (73 .any.js files × subprocess each), tracks
 * the EXPECTED_FAILURES list, and prints the human-readable report.
 *
 * Why not run the suite inline as `test.each`? Two reasons:
 *   1. The runner already has a rich CLI surface (--filter, --verbose,
 *      --force) we want preserved for dev debugging — running it as a
 *      subprocess keeps that contract intact.
 *   2. WPT failures classify against an EXPECTED_FAILURES Map; only
 *      UNEXPECTED regressions should fail the gate. Vitest's per-test
 *      reporter doesn't compose with that classification cleanly; the
 *      runner's own report does. Single pass/fail signal is cleaner.
 *
 * The runner exits non-zero only when it finds unexpected regressions;
 * expected-but-still-failing tests don't fail the gate. So a non-zero
 * exit from this test == a real spec regression that needs eyes.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { resolveFinalBinary } from '../helpers/smol-builtin.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const RUNNER = path.resolve(__dirname, '..', 'scripts', 'wpt-streams-runner.mts')

// Gate the suite on the dev Final/ binary being present — the runner
// spawns subprocesses against it for each test file. CI / fresh checkout
// without a build will skip.
const finalBinary = resolveFinalBinary()
const skipTests = !finalBinary

// Match the runner's own per-file timeout × estimated file count, with
// headroom. 73 files × 30s = ~37 min in the worst case; budget 45 min.
const WPT_TIMEOUT_MS = 45 * 60 * 1_000

describe.skipIf(skipTests)('WPT streams conformance', () => {
  it(
    'no unexpected failures vs EXPECTED_FAILURES list',
    async () => {
      const result = await spawn('node', [RUNNER], {
        stdio: 'inherit',
      })
      expect(result.code).toBe(0)
    },
    WPT_TIMEOUT_MS,
  )
})
