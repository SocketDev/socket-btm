/**
 * @file Asserts every checkpoint-consuming package routes through the
 *   canonical chain surface: a package whose scripts import
 *   `checkpoint-manager` must own a `scripts/get-checkpoint-chain.mts`
 *   (the one place its stage list lives — the resume/cache tooling and the
 *   setup-checkpoints action read chains from there, never from ad-hoc
 *   stage lists). REPORT-ONLY until the backlog clears; `--strict` exits
 *   non-zero on findings. Runs under `check --all` via the
 *   scripts/repo/check/ seam.
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)

export function findChainlessConsumers(repoRoot: string): string[] {
  const packagesDir = path.join(repoRoot, 'packages')
  if (!existsSync(packagesDir)) {
    return []
  }
  const findings: string[] = []
  const pkgs = readdirSync(packagesDir).toSorted()
  for (let i = 0, { length } = pkgs; i < length; i += 1) {
    const pkg = pkgs[i]!
    const scriptsDir = path.join(packagesDir, pkg, 'scripts')
    if (!existsSync(scriptsDir)) {
      continue
    }
    // A consumer imports checkpoint-manager somewhere under its scripts/.
    const grep = spawnSync(
      'grep',
      ['-rl', '--include=*.mts', 'checkpoint-manager', scriptsDir],
      { stdio: 'pipe' },
    )
    if (grep.status !== 0) {
      continue
    }
    if (!existsSync(path.join(scriptsDir, 'get-checkpoint-chain.mts'))) {
      findings.push(pkg)
    }
  }
  return findings
}

export function main(): void {
  const strict = process.argv.includes('--strict')
  const findings = findChainlessConsumers(REPO_ROOT)
  if (findings.length === 0) {
    logger.success(
      'checkpoint-consumers-own-a-chain: every checkpoint-manager consumer owns scripts/get-checkpoint-chain.mts',
    )
    return
  }
  logger.warn(
    `checkpoint-consumers-own-a-chain: ${findings.length} package(s) import checkpoint-manager without a get-checkpoint-chain.mts`,
  )
  logger.group()
  for (const pkg of findings) {
    logger.warn(`packages/${pkg} — add scripts/get-checkpoint-chain.mts`)
  }
  logger.warn(
    'Where: packages/<pkg>/scripts | Saw: checkpoint-manager import, no chain file | Fix: define the stage chain in scripts/get-checkpoint-chain.mts (copy a sibling builder)',
  )
  logger.groupEnd()
  if (strict) {
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main()
}
