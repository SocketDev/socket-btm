#!/usr/bin/env node
/**
 * @file Package-scoped Vitest entrypoint for the three smol-ai workspaces. The
 *   pinned llama.cpp tree contains its own frontend tests, so each package must
 *   pass an exact owned test list instead of relying on recursive discovery.
 */

import { readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

const packageRoots = new Map([
  ['@node-smol/ai', path.join(repoRoot, 'packages', 'npm', '@node-smol', 'ai')],
  ['ai-infra', path.join(repoRoot, 'packages', 'ai-infra')],
  ['smol-ai-builder', path.join(repoRoot, 'packages', 'smol-ai-builder')],
])

function main(): void {
  const packageName = process.argv[2]
  const packageRoot = packageName ? packageRoots.get(packageName) : undefined
  if (!packageRoot) {
    throw new Error(
      `Unknown smol-ai test package: ${packageName ?? '<missing>'}`,
    )
  }
  const testDir = path.join(packageRoot, 'test')
  const testFiles = readdirSync(testDir)
    .filter(file => file.endsWith('.test.mts'))
    .map(file => path.join('test', file))
    .toSorted()
  if (testFiles.length === 0) {
    throw new Error(`No owned test files found under ${testDir}`)
  }
  const vitest = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    WIN32 ? 'vitest.cmd' : 'vitest',
  )
  const result = spawnSync(vitest, ['run', ...testFiles], {
    cwd: packageRoot,
    shell: WIN32,
    stdio: 'inherit',
  })
  process.exitCode = result.status ?? 1
}

main()
