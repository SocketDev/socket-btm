#!/usr/bin/env node
/*
 * @file Temporary report renderer for the node-smol migration inventory.
 *
 *   Prints a repo-by-repo progress report from the live manifest, including
 *   the current extraction rows and the next tier-1b targets. Intended as a
 *   short-lived visibility aid while the extraction boundary is still moving.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isMainModule } from '../fleet/_shared/is-main-module.mts'
import { formatNodeSmolMigrationReport } from './check/node-smol-migration-manifest.mts'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

function parseOutputPath(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '--write') {
      return argv[i + 1]
    }
    if (arg.startsWith('--write=')) {
      return arg.slice('--write='.length)
    }
  }
  return undefined
}

function main(): void {
  const report = formatNodeSmolMigrationReport(repoRoot)
  const outputPath =
    parseOutputPath(process.argv.slice(2)) ??
    path.join(
      repoRoot,
      '.claude',
      'reports',
      'node-smol-extraction-progress.md',
    )
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, report)
  process.stdout.write(`${report}\n`)
}

if (isMainModule(import.meta.url)) {
  main()
}
