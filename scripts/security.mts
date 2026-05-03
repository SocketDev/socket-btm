/**
 * @fileoverview Canonical fleet security-scan runner.
 *
 * Runs the two static-analysis tools the fleet uses for local security
 * checks before push:
 *
 *   1. AgentShield — scans `.claude/` config for prompt-injection,
 *      leaked secrets, and overly-permissive tool permissions.
 *   2. zizmor      — static analysis for `.github/workflows/*.yml`
 *      (unpinned actions, secret exposure, template injection,
 *      permission issues).
 *
 * If zizmor isn't installed, prints a "run pnpm run setup" hint
 * (which downloads + verifies the pinned binary via the
 * setup-security-tools hook) and skips the zizmor scan rather than
 * failing the entire run.
 *
 * Wired in via `package.json`:
 *
 *   "security": "node scripts/security.mts"
 *
 * Byte-identical across every fleet repo. Sync-scaffolding flags
 * drift.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

function isInstalled(cmd: string): boolean {
  // `command -v` returns 0 if the binary is on PATH, non-zero otherwise.
  const result = spawnSync('command', ['-v', cmd], {
    shell: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  return result.status === 0
}

function run(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

let exitCode = 0

logger.info('AgentShield: scanning .claude/ ...')
if (!run('agentshield', ['scan'])) {
  exitCode = 1
}

if (isInstalled('zizmor')) {
  logger.info('zizmor: scanning .github/ ...')
  if (!run('zizmor', ['.github/'])) {
    exitCode = 1
  }
} else {
  logger.warn(
    'zizmor not installed — run `pnpm run setup` to install. Skipping zizmor scan.',
  )
}

process.exit(exitCode)
