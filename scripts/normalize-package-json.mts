#!/usr/bin/env node
/**
 * Normalize package.json property order across all packages.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const packagesDir = path.join(rootDir, 'packages')

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

type JsonObject = { [key: string]: JsonValue }

type PackageEntry = {
  name: string
  path: string
}

// Standard property order.
const PROPERTY_ORDER = [
  'name',
  'version',
  'description',
  'private',
  'license',
  'main',
  'module',
  'bin',
  'type',
  'exports',
  'files',
  'os',
  'cpu',
  'scripts',
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
  'engines',
  'repository',
  'author',
  'homepage',
  'bugs',
  'keywords',
  'publishConfig',
]

/**
 * Find all package.json files in packages/*.
 */
export function findPackages(): PackageEntry[] {
  const packages: PackageEntry[] = []
  const entries = readdirSync(packagesDir)

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const pkgPath = path.join(packagesDir, entry)
    if (!statSync(pkgPath).isDirectory()) {
      continue
    }

    const pkgJsonPath = path.join(pkgPath, 'package.json')
    try {
      statSync(pkgJsonPath)
      packages.push({ name: entry, path: pkgJsonPath })
    } catch {
      // No package.json in this directory.
    }
  }

  return packages.toSorted((a, b) => a.name.localeCompare(b.name))
}

/**
 * Normalize a package.json file.
 */
export function normalizePackageJson(pkgPath: string): boolean {
  const content = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(content) as JsonObject

  // Reorder properties.
  const normalized = reorderProperties(pkg)

  // Write back with 2-space indentation and trailing newline.
  const newContent = `${JSON.stringify(normalized, null, 2)}\n`

  // Only write if changed.
  if (content !== newContent) {
    writeFileSync(pkgPath, newContent, 'utf8')
    return true
  }

  return false
}

/**
 * Reorder object properties according to standard order.
 */
export function reorderProperties(obj: JsonObject): JsonObject {
  const ordered: JsonObject = { __proto__: null } as JsonObject
  const remaining: JsonObject = { __proto__: null } as JsonObject

  // First, add properties in standard order.
  for (let i = 0, { length } = PROPERTY_ORDER; i < length; i += 1) {
    const key = PROPERTY_ORDER[i]!
    if (key in obj) {
      ordered[key] = obj[key]!
    }
  }

  // Then add remaining properties alphabetically.
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const key of Object.keys(obj).toSorted()) {
    if (!(key in ordered)) {
      remaining[key] = obj[key]!
    }
  }

  return { ...ordered, ...remaining }
}

/**
 * Run npm pkg fix on a package.
 */
export async function runNpmPkgFix(pkgPath: string): Promise<boolean> {
  const pkgDir = path.dirname(pkgPath)
  try {
    await spawn('npm', ['pkg', 'fix'], {
      cwd: pkgDir,
      shell: WIN32,
      stdio: 'pipe',
    })
    return true
  } catch (e) {
    logger.error(`Error running npm pkg fix in ${pkgDir}:`, errorMessage(e))
    return false
  }
}

/**
 * Main.
 */
async function main(): Promise<void> {
  const packages = findPackages()

  logger.info(`Found ${packages.length} packages\n`)

  let normalizedCount = 0
  let fixedCount = 0

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const { name, path: pkgPath } of packages) {
    process.stdout.write(`${name.padEnd(40)} `)

    // Normalize property order.
    const wasNormalized = normalizePackageJson(pkgPath)
    if (wasNormalized) {
      normalizedCount++
      process.stdout.write('normalized ')
    } else {
      process.stdout.write('           ')
    }

    // Run npm pkg fix.
    const wasFixed = await runNpmPkgFix(pkgPath)
    if (wasFixed) {
      fixedCount++
      process.stdout.write('fixed')
    }

    process.stdout.write('\n')
  }

  logger.info(`\n${normalizedCount} normalized, ${fixedCount} fixed`)
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
