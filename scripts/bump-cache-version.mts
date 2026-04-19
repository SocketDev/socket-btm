#!/usr/bin/env node

/**
 * Bump cache version for a package.
 *
 * Usage:
 *   node scripts/bump-cache-version.mts <package-name>
 *   node scripts/bump-cache-version.mts onnxruntime
 *   node scripts/bump-cache-version.mts --all
 *
 * Examples:
 *   node scripts/bump-cache-version.mts node-smol       # v9 -> v10
 *   node scripts/bump-cache-version.mts --all            # Bump all packages
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PATH = path.join(__dirname, '../.github/cache-versions.json')

type CacheVersionsFile = {
  versions: Record<string, string>
}

type BumpResult = {
  from: string
  packageName: string
  to: string
}

function parseCacheVersionsFile(content: string): CacheVersionsFile {
  return JSON.parse(content) as CacheVersionsFile
}

async function bumpCacheVersion(packageName: string): Promise<BumpResult> {
  // Read config
  const configText = await fs.readFile(CONFIG_PATH, 'utf8')
  const config = parseCacheVersionsFile(configText)

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

  const currentNumber = Number.parseInt(match[1]!, 10)
  const next = `v${currentNumber + 1}`

  config.versions[packageName] = next

  // Write back with consistent formatting.
  await fs.writeFile(
    CONFIG_PATH,
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8',
  )

  logger.success(`Bumped ${packageName}: ${current} → ${next}`)
  return { from: current, packageName, to: next }
}

async function bumpAll(): Promise<BumpResult[]> {
  const configText = await fs.readFile(CONFIG_PATH, 'utf8')
  const config = parseCacheVersionsFile(configText)
  const packages = Object.keys(config.versions)

  logger.info(`Bumping cache versions for ${packages.length} packages...\n`)

  const results: BumpResult[] = []
  for (const pkg of packages) {
    const result = await bumpCacheVersion(pkg)
    results.push(result)
  }

  logger.success(`Bumped ${results.length} package(s)`)
  return results
}

// Main.
const argv: string[] = process.argv
const packageName: string | undefined = argv[2]

if (!packageName) {
  logger.fail('Usage: node scripts/bump-cache-version.mts <package-name>')
  logger.log('   or: node scripts/bump-cache-version.mts --all')
  logger.log('')
  logger.log('Available packages:')

  const configText = await fs.readFile(CONFIG_PATH, 'utf8')
  const config = parseCacheVersionsFile(configText)
  for (const [pkg, version] of Object.entries(config.versions)) {
    logger.log(`  - ${pkg} (${version})`)
  }

  process.exitCode = 1
} else {
  try {
    if (packageName === '--all') {
      await bumpAll()
    } else {
      await bumpCacheVersion(packageName)
    }
  } catch (e) {
    logger.fail(`Error: ${e instanceof Error ? e.message : String(e)}`)
    process.exitCode = 1
  }
}
