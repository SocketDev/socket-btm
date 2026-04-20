#!/usr/bin/env node

/**
 * Cache Version Cascade Validator
 *
 * Validates that cache versions are bumped correctly when source packages change.
 * This enforces the cascade dependencies documented in CLAUDE.md.
 *
 * Run in CI to ensure developers don't forget to bump dependent cache versions.
 */
import process from 'node:process'

import { existsSync, readFileSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { errorMessage } from 'build-infra/lib/error-utils'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

type CacheVersions = Record<string, string>

type CacheVersionsFile = {
  versions: CacheVersions
}

type MissingBump = {
  current: string | undefined
  package: string
  previous: string | undefined
}

// Cache version cascade rules per CLAUDE.md
// Key: Source path prefix, Value: Cache keys that must be bumped when that path changes.
// `src/` mirrors the C++ canonical sources (copied into additions/ during
// build). `lib/` holds the TypeScript helpers every builder imports from
// (`checkpoint-manager`, `platform-mappings`, etc.). Both must cascade
// downstream — a bug fix in checkpoint-manager.mts affects every package
// that builds via it, not just the ones that embed the C++ source.
const ALL_DOWNSTREAM = [
  'binflate',
  'binject',
  'binpress',
  'curl',
  'ink',
  'iocraft',
  'lief',
  'models',
  'node-smol',
  'onnxruntime',
  'opentui',
  'stubs',
  'yoga-layout',
]

const CASCADE_RULES = {
  'packages/bin-infra/lib/': ALL_DOWNSTREAM,
  'packages/bin-infra/src/socketsecurity/bin-infra/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  // binflate runtime is embedded in node-smol's compressed binary via the
  // self-extracting stub — an edit to binflate/src must bump node-smol too.
  'packages/binflate/src/': ['binflate', 'node-smol'],
  'packages/binject/src/socketsecurity/binject/': ['binject', 'node-smol'],
  'packages/binpress/src/': ['binpress', 'node-smol'],
  'packages/build-infra/lib/': ALL_DOWNSTREAM,
  'packages/build-infra/src/socketsecurity/build-infra/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  'packages/stubs-builder/src/': ['stubs', 'binpress', 'node-smol'],
}

function validateBranchName(branchName: string): string {
  // Validate branch name to prevent command injection
  // Allow: alphanumeric, slashes, hyphens, underscores, dots
  if (!/^[\w./-]+$/.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`)
  }
  return branchName
}

async function getChangedFiles(baseBranch = 'origin/main'): Promise<string[]> {
  try {
    // Validate branch name to prevent command injection
    const safeBranch = validateBranchName(baseBranch)
    // Get list of changed files between current HEAD and base branch
    const { stdout } = await spawn('git', [
      'diff',
      '--name-only',
      `${safeBranch}...HEAD`,
    ])
    const output = String(stdout).trim()
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
      const output = String(stdout).trim()
      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }
}

function getCacheVersions(): CacheVersions {
  const cacheVersionsPath = '.github/cache-versions.json'
  if (!existsSync(cacheVersionsPath)) {
    throw new Error(`Cache versions file not found: ${cacheVersionsPath}`)
  }
  const content = readFileSync(cacheVersionsPath, 'utf8')
  return (JSON.parse(content) as CacheVersionsFile).versions
}

function parseVersion(versionString: string): number {
  // Parse "v123" → 123
  const match = versionString.match(/^v(\d+)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

async function main(): Promise<void> {
  const argv: string[] = process.argv
  const baseBranchInput = argv[2] || 'origin/main'
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
  const requiredBumps = new Set<string>()

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
    let previousVersions: CacheVersions
    try {
      const { stdout } = await spawn('git', [
        'show',
        `${baseBranch}:.github/cache-versions.json`,
      ])
      previousVersions = (JSON.parse(String(stdout)) as CacheVersionsFile).versions
    } catch {
      logger.warn('Could not get previous cache versions from base branch.')
      logger.warn(
        'Assuming this is a new addition or base branch is unavailable.',
      )
      process.exitCode = 0
      return
    }

    // Check each required bump actually happened
    const missingBumps: MissingBump[] = []
    for (const pkg of requiredBumps) {
      const current = parseVersion(currentVersions[pkg] || 'v0')
      const previous = parseVersion(previousVersions[pkg] || 'v0')

      if (current <= previous) {
        missingBumps.push({
          current: currentVersions[pkg],
          package: pkg,
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
  } catch (e) {
    logger.error(`Error validating cache versions: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
