#!/usr/bin/env node
/**
 * Normalize package.json property order across all packages.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')
const packagesDir = path.join(rootDir, 'packages')

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
 * Reorder object properties according to standard order.
 */
function reorderProperties(obj) {
  const ordered = { __proto__: null }
  const remaining = { __proto__: null }

  // First, add properties in standard order.
  for (const key of PROPERTY_ORDER) {
    if (key in obj) {
      ordered[key] = obj[key]
    }
  }

  // Then add remaining properties alphabetically.
  for (const key of Object.keys(obj).sort()) {
    if (!(key in ordered)) {
      remaining[key] = obj[key]
    }
  }

  return { ...ordered, ...remaining }
}

/**
 * Find all package.json files in packages/*.
 */
function findPackages() {
  const packages = []
  const entries = readdirSync(packagesDir)

  for (const entry of entries) {
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

  return packages.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Normalize a package.json file.
 */
function normalizePackageJson(pkgPath) {
  const content = readFileSync(pkgPath, 'utf8')
  const pkg = JSON.parse(content)

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
 * Run npm pkg fix on a package.
 */
async function runNpmPkgFix(pkgPath) {
  const pkgDir = path.dirname(pkgPath)
  try {
    await spawn('npm', ['pkg', 'fix'], { cwd: pkgDir, stdio: 'pipe' })
    return true
  } catch (e) {
    logger.error(`Error running npm pkg fix in ${pkgDir}:`, e.message)
    return false
  }
}

/**
 * Main.
 */
async function main() {
  const packages = findPackages()

  logger.info(`Found ${packages.length} packages\n`)

  let normalizedCount = 0
  let fixedCount = 0

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

main()
