#!/usr/bin/env node
/**
 * Update checksums from GitHub releases to release-assets.json.
 *
 * This script fetches checksums.txt from the latest release of each tool
 * and updates the embedded checksums in release-assets.json.
 *
 * Usage:
 *   node scripts/update-checksums.mjs [--tool=<tool>] [--force]
 *
 * Options:
 *   --tool=<name>  Only sync specific tool (lief, curl, stubs, binpress, binflate, binject)
 *   --force        Force update even if checksums haven't changed
 *   --dry-run      Show what would be updated without writing
 */

import { existsSync, readFileSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  SOCKET_BTM_REPO,
  downloadReleaseAsset,
  getLatestRelease,
} from '@socketsecurity/lib/releases/github'

import { parseChecksums } from '../lib/release-checksums.mjs'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const CHECKSUMS_FILE = path.join(packageRoot, 'release-assets.json')

/** Tools to sync checksums for. */
const TOOLS = ['lief', 'curl', 'stubs', 'libpq', 'binpress', 'binflate', 'binject']

/**
 * Fetch checksums for a tool from GitHub release.
 *
 * @param {string} tool - Tool name.
 * @returns {Promise<{tag: string, checksums: Record<string, string>} | null>}
 */
async function fetchToolChecksums(tool) {
  const toolPrefix = `${tool}-`

  try {
    // Get latest release tag.
    const tag = await getLatestRelease(toolPrefix, SOCKET_BTM_REPO, { quiet: true })
    if (!tag) {
      logger.warn(`No release found for ${tool}`)
      return null
    }

    // Download checksums.txt to temp location.
    const tempDir = path.join(packageRoot, 'build', 'temp')
    await fs.mkdir(tempDir, { recursive: true })
    const checksumPath = path.join(tempDir, `${tool}-checksums-${tag}.txt`)

    // Download checksums.txt.
    await downloadReleaseAsset(
      tag,
      'checksums.txt',
      checksumPath,
      SOCKET_BTM_REPO,
      { quiet: true },
    )

    // Parse checksums.
    const content = await fs.readFile(checksumPath, 'utf8')
    const checksums = parseChecksums(content)

    // Clean up temp file.
    await fs.unlink(checksumPath).catch(() => {})

    return { checksums, tag }
  } catch (error) {
    logger.warn(`Failed to fetch checksums for ${tool}: ${error.message}`)
    return null
  }
}

/**
 * Main sync function.
 */
async function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force')
  const dryRun = args.includes('--dry-run')
  const toolArg = args.find(arg => arg.startsWith('--tool='))
  const toolFilter = toolArg ? toolArg.split('=')[1] : undefined

  // Validate tool filter.
  if (toolFilter && !TOOLS.includes(toolFilter)) {
    logger.fail(`Unknown tool: ${toolFilter}`)
    logger.info(`Valid tools: ${TOOLS.join(', ')}`)
    process.exitCode = 1
    return
  }

  const toolsToSync = toolFilter ? [toolFilter] : TOOLS

  // Load current checksums file.
  let currentData = { __proto__: null }
  if (existsSync(CHECKSUMS_FILE)) {
    try {
      currentData = JSON.parse(readFileSync(CHECKSUMS_FILE, 'utf8'))
    } catch (error) {
      logger.warn(`Failed to parse ${CHECKSUMS_FILE}: ${error.message}`)
    }
  }

  logger.info(`Syncing checksums for ${toolsToSync.length} tool(s)...`)
  logger.info('')

  let updated = 0
  let unchanged = 0
  let failed = 0

  for (const tool of toolsToSync) {
    logger.info(`Fetching checksums for ${tool}...`)

    const result = await fetchToolChecksums(tool)
    if (!result) {
      failed++
      continue
    }

    const { checksums, tag } = result
    const checksumCount = Object.keys(checksums).length

    if (checksumCount === 0) {
      logger.warn(`  No checksums found in release ${tag}`)
      failed++
      continue
    }

    // Check if update is needed.
    const current = currentData[tool]
    const currentTag = current?.githubRelease
    const currentChecksums = current?.checksums || {}
    const currentCount = Object.keys(currentChecksums).length

    const tagChanged = currentTag !== tag
    const checksumsChanged = JSON.stringify(checksums) !== JSON.stringify(currentChecksums)

    if (!force && !tagChanged && !checksumsChanged) {
      logger.info(`  ${tool}: unchanged (${tag}, ${checksumCount} checksums)`)
      unchanged++
      continue
    }

    // Update the data.
    if (!currentData[tool]) {
      currentData[tool] = { __proto__: null }
    }
    currentData[tool].description = current?.description || `${tool} binaries`
    currentData[tool].githubRelease = tag
    currentData[tool].checksums = checksums

    if (tagChanged) {
      logger.success(`  ${tool}: ${currentTag || '(none)'} -> ${tag} (${checksumCount} checksums)`)
    } else {
      logger.success(`  ${tool}: updated checksums (${currentCount} -> ${checksumCount})`)
    }
    updated++
  }

  logger.info('')

  // Write updated file.
  if (updated > 0 && !dryRun) {
    // Preserve schema comments.
    const output = {
      $schema: 'Release checksums for Socket BTM build dependencies',
      $comment: "SHA-256 checksums for GitHub release assets. Run 'pnpm --filter build-infra update-checksums' to update.",
      ...currentData,
    }
    // Remove $schema and $comment from spread to avoid duplication.
    delete output[Symbol.for('$schema')]
    delete output[Symbol.for('$comment')]

    await fs.writeFile(
      CHECKSUMS_FILE,
      JSON.stringify(output, null, 2) + '\n',
      'utf8',
    )
    logger.success(`Updated ${CHECKSUMS_FILE}`)
  } else if (dryRun && updated > 0) {
    logger.info('Dry run - no changes written')
  }

  // Summary.
  logger.info('')
  if (failed > 0) {
    logger.warn(`Summary: ${updated} updated, ${unchanged} unchanged, ${failed} failed`)
  } else {
    logger.success(`Summary: ${updated} updated, ${unchanged} unchanged`)
  }

  if (failed > 0) {
    process.exitCode = 1
  }
}

main().catch(error => {
  logger.fail(`Sync failed: ${error.message}`)
  process.exitCode = 1
})
