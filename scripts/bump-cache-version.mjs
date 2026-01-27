#!/usr/bin/env node

/**
 * Bump cache version for a package.
 *
 * Usage:
 *   node scripts/bump-cache-version.mjs <package-name>
 *   node scripts/bump-cache-version.mjs onnxruntime
 *   node scripts/bump-cache-version.mjs --all
 *
 * Examples:
 *   node scripts/bump-cache-version.mjs node-smol       # v9 -> v10
 *   node scripts/bump-cache-version.mjs --all            # Bump all packages
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '../.github/cache-versions.json')

async function bumpCacheVersion(packageName) {
  // Read config
  const configText = await readFile(CONFIG_PATH, 'utf-8')
  const config = JSON.parse(configText)

  if (!config.versions) {
    throw new Error('Missing versions object in cache-versions.json')
  }

  if (!config.versions[packageName]) {
    throw new Error(
      `Package '${packageName}' not found in cache-versions.json. ` +
        `Available packages: ${Object.keys(config.versions).join(', ')}`,
    )
  }

  const current = config.versions[packageName]
  const match = current.match(/^v(\d+)$/)

  if (!match) {
    throw new Error(
      `Invalid version format '${current}' for ${packageName}. Expected format: v<number>`,
    )
  }

  const currentNumber = Number.parseInt(match[1], 10)
  const next = `v${currentNumber + 1}`

  config.versions[packageName] = next

  // Write back with consistent formatting.
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8')

  logger.success(`Bumped ${packageName}: ${current} → ${next}`)
  return { packageName, from: current, to: next }
}

async function bumpAll() {
  const configText = await readFile(CONFIG_PATH, 'utf-8')
  const config = JSON.parse(configText)
  const packages = Object.keys(config.versions)

  logger.info(`Bumping cache versions for ${packages.length} packages...\n`)

  const results = []
  for (const pkg of packages) {
    const result = await bumpCacheVersion(pkg)
    results.push(result)
  }

  logger.success(`Bumped ${results.length} package(s)`)
  return results
}

// Main.
const [, , packageName] = process.argv

if (!packageName) {
  logger.fail('Usage: node scripts/bump-cache-version.mjs <package-name>')
  logger.log('   or: node scripts/bump-cache-version.mjs --all')
  logger.log('')
  logger.log('Available packages:')

  const configText = await readFile(CONFIG_PATH, 'utf-8')
  const config = JSON.parse(configText)
  for (const [pkg, version] of Object.entries(config.versions)) {
    logger.log(`  - ${pkg} (${version})`)
  }

  process.exit(1)
}

try {
  if (packageName === '--all') {
    await bumpAll()
  } else {
    await bumpCacheVersion(packageName)
  }
} catch (error) {
  logger.fail(`Error: ${error?.message || 'Unknown error'}`)
  process.exit(1)
}
