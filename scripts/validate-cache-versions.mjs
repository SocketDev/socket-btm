#!/usr/bin/env node

/**
 * Cache Version Cascade Validator
 *
 * Validates that cache versions are bumped correctly when source packages change.
 * This enforces the cascade dependencies documented in CLAUDE.md.
 *
 * Run in CI to ensure developers don't forget to bump dependent cache versions.
 */

import { existsSync, readFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

// Cache version cascade rules per CLAUDE.md
// Key: Source path prefix, Value: Cache keys that must be bumped when that path changes
const CASCADE_RULES = {
  'packages/build-infra/src/socketsecurity/build-infra/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  'packages/bin-infra/src/socketsecurity/bin-infra/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  'packages/binject/src/socketsecurity/binject/': ['binject', 'node-smol'],
  'packages/stubs-builder/src/': ['stubs', 'binpress', 'node-smol'],
  'packages/binpress/src/': ['binpress', 'node-smol'],
  'packages/binflate/src/': ['binflate'],
}

function validateBranchName(branchName) {
  // Validate branch name to prevent command injection
  // Allow: alphanumeric, slashes, hyphens, underscores, dots
  if (!/^[\w./-]+$/.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`)
  }
  return branchName
}

async function getChangedFiles(baseBranch = 'origin/main') {
  try {
    // Validate branch name to prevent command injection
    const safeBranch = validateBranchName(baseBranch)
    // Get list of changed files between current HEAD and base branch
    const { stdout } = await spawn('git', [
      'diff',
      '--name-only',
      `${safeBranch}...HEAD`,
    ])
    const output = stdout.trim()
    return output ? output.split('\n') : []
  } catch {
    // Fallback: compare to previous commit
    try {
      const { stdout } = await spawn('git', [
        'diff',
        '--name-only',
        'HEAD~1',
        'HEAD',
      ])
      const output = stdout.trim()
      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }
}

function getCacheVersions() {
  const cacheVersionsPath = '.github/cache-versions.json'
  if (!existsSync(cacheVersionsPath)) {
    throw new Error(`Cache versions file not found: ${cacheVersionsPath}`)
  }
  const content = readFileSync(cacheVersionsPath, 'utf-8')
  return JSON.parse(content).versions
}

function parseVersion(versionString) {
  // Parse "v123" → 123
  const match = versionString.match(/^v(\d+)$/)
  return match ? Number.parseInt(match[1], 10) : 0
}

async function main() {
  const baseBranchInput = process.argv[2] || 'origin/main'
  // Validate branch name early to prevent command injection
  const baseBranch = validateBranchName(baseBranchInput)
  logger.info(`Validating cache version cascade (base: ${baseBranch})...`)

  const changedFiles = await getChangedFiles(baseBranch)
  if (changedFiles.length === 0) {
    logger.info('No changed files detected. Nothing to validate.')
    process.exitCode = 0
    return
  }

  logger.info(`Changed files (${changedFiles.length}):`)
  changedFiles.forEach(f => logger.info(`  - ${f}`))

  // Check if cache-versions.json was modified
  const cacheVersionsChanged = changedFiles.includes(
    '.github/cache-versions.json',
  )

  // Determine which packages need cache bumps based on changed source files
  const requiredBumps = new Set()

  for (const file of changedFiles) {
    for (const [pathPrefix, packages] of Object.entries(CASCADE_RULES)) {
      if (file.startsWith(pathPrefix)) {
        packages.forEach(pkg => requiredBumps.add(pkg))
      }
    }
  }

  if (requiredBumps.size === 0) {
    logger.info('No source package changes detected that require cache bumps.')
    process.exitCode = 0
    return
  }

  logger.info('Required cache version bumps:')
  requiredBumps.forEach(pkg => logger.info(`  - ${pkg}`))

  // If cache-versions.json wasn't modified, that's an error
  if (!cacheVersionsChanged) {
    logger.error(
      'Source packages changed but .github/cache-versions.json was not modified.',
    )
    logger.error('You must bump cache versions for the following packages:')
    requiredBumps.forEach(pkg => logger.error(`  - ${pkg}`))
    logger.error(
      'See CLAUDE.md "Cache Version Cascade Dependencies" for details.',
    )
    process.exitCode = 1
    return
  }

  // Get current and previous cache versions to verify bumps actually happened
  try {
    const currentVersions = getCacheVersions()

    // Get previous versions from base branch
    let previousVersions
    try {
      const { stdout } = await spawn('git', [
        'show',
        `${baseBranch}:.github/cache-versions.json`,
      ])
      previousVersions = JSON.parse(stdout).versions
    } catch {
      logger.warn('Could not get previous cache versions from base branch.')
      logger.warn(
        'Assuming this is a new addition or base branch is unavailable.',
      )
      process.exitCode = 0
      return
    }

    // Check each required bump actually happened
    const missingBumps = []
    for (const pkg of requiredBumps) {
      const current = parseVersion(currentVersions[pkg] || 'v0')
      const previous = parseVersion(previousVersions[pkg] || 'v0')

      if (current <= previous) {
        missingBumps.push({
          package: pkg,
          current: currentVersions[pkg],
          previous: previousVersions[pkg],
        })
      }
    }

    if (missingBumps.length > 0) {
      logger.error('Cache versions were not properly bumped:')
      missingBumps.forEach(({ current, package: pkg, previous }) => {
        logger.error(`  - ${pkg}: ${previous} → ${current} (should increase)`)
      })
      logger.error(
        'See CLAUDE.md "Cache Version Cascade Dependencies" for details.',
      )
      process.exitCode = 1
      return
    }

    logger.success('All required cache version bumps verified.')
    process.exitCode = 0
  } catch (error) {
    logger.error(`Error validating cache versions: ${error.message}`)
    process.exitCode = 1
  }
}

main()
