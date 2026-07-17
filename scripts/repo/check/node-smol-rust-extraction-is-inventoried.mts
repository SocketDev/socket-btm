/*
 * @file Asserts the Node Smol Rust-extraction manifest assigns every current
 *   socket-btm package directory exactly once before its implementation moves.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
)
const MANIFEST_PATH = '.config/node-smol-rust-extraction.json'

export interface MigrationEntry {
  sourcePath: string
}

export interface MigrationManifest {
  entries: MigrationEntry[]
  schemaVersion: number
}

export function findInventoryDrift(repoRoot: string): string[] {
  const manifestPath = path.join(repoRoot, MANIFEST_PATH)
  if (!existsSync(manifestPath)) {
    return [`missing ${MANIFEST_PATH}`]
  }
  const packagesPath = path.join(repoRoot, 'packages')
  if (!existsSync(packagesPath)) {
    return ['missing packages directory']
  }
  let manifest: MigrationManifest
  try {
    manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8'),
    ) as MigrationManifest
  } catch (error: unknown) {
    return [`invalid ${MANIFEST_PATH}: ${errorMessage(error)}`]
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.entries)) {
    return [`invalid ${MANIFEST_PATH} structure`]
  }
  const expected = readdirSync(packagesPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => `packages/${entry.name}`)
    .toSorted()
  const actual = manifest.entries.map(entry => entry.sourcePath).toSorted()
  const drift: string[] = []
  for (let i = 0, { length } = expected; i < length; i += 1) {
    const sourcePath = expected[i]!
    if (!actual.includes(sourcePath)) {
      drift.push(`missing entry: ${sourcePath}`)
    }
  }
  for (let i = 0, { length } = actual; i < length; i += 1) {
    const sourcePath = actual[i]!
    if (!expected.includes(sourcePath)) {
      drift.push(`unknown entry: ${sourcePath}`)
    }
    if (actual.indexOf(sourcePath) !== actual.lastIndexOf(sourcePath)) {
      drift.push(`duplicate entry: ${sourcePath}`)
    }
  }
  return [...new Set(drift)].toSorted()
}

export function main(): void {
  const drift = findInventoryDrift(REPO_ROOT)
  if (drift.length === 0) {
    logger.success(
      'node-smol-rust-extraction-is-inventoried: every packages/* directory has one migration entry',
    )
    return
  }
  logger.error(
    `node-smol-rust-extraction-is-inventoried: ${drift.length} inventory mismatch(es)`,
  )
  for (const finding of drift) {
    logger.error(`  ${finding}`)
  }
  logger.error(
    `Where: ${MANIFEST_PATH} | Saw: a package directory without one matching sourcePath | Fix: add or remove the matching manifest entry`,
  )
  process.exitCode = 1
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  main()
}
