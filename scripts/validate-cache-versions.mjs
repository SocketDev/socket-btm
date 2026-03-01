#!/usr/bin/env node

/**
 * Cache Version Cascade Validator
 *
 * Validates that cache versions are bumped correctly when source packages change.
 * This enforces the cascade dependencies documented in CLAUDE.md.
 *
 * Run in CI to ensure developers don't forget to bump dependent cache versions.
 */

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'

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
  'packages/bin-stubs/src/': ['stubs', 'binpress', 'node-smol'],
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

function getChangedFiles(baseBranch = 'origin/main') {
  try {
    // Validate branch name to prevent command injection
    const safeBranch = validateBranchName(baseBranch)
    // Get list of changed files between current HEAD and base branch
    const output = execSync(`git diff --name-only ${safeBranch}...HEAD`, {
      encoding: 'utf-8',
    }).trim()
    return output ? output.split('\n') : []
  } catch {
    // Fallback: compare to previous commit
    try {
      const output = execSync('git diff --name-only HEAD~1 HEAD', {
        encoding: 'utf-8',
      }).trim()
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

function main() {
  const baseBranchInput = process.argv[2] || 'origin/main'
  // Validate branch name early to prevent command injection
  const baseBranch = validateBranchName(baseBranchInput)
  console.log(`Validating cache version cascade (base: ${baseBranch})...\n`)

  const changedFiles = getChangedFiles(baseBranch)
  if (changedFiles.length === 0) {
    console.log('No changed files detected. Nothing to validate.')
    process.exit(0)
  }

  console.log(`Changed files (${changedFiles.length}):`)
  changedFiles.forEach(f => console.log(`  - ${f}`))
  console.log()

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
    console.log('No source package changes detected that require cache bumps.')
    process.exit(0)
  }

  console.log('Required cache version bumps:')
  requiredBumps.forEach(pkg => console.log(`  - ${pkg}`))
  console.log()

  // If cache-versions.json wasn't modified, that's an error
  if (!cacheVersionsChanged) {
    console.error(
      'ERROR: Source packages changed but .github/cache-versions.json was not modified.',
    )
    console.error('You must bump cache versions for the following packages:')
    requiredBumps.forEach(pkg => console.error(`  - ${pkg}`))
    console.error(
      '\nSee CLAUDE.md "Cache Version Cascade Dependencies" for details.',
    )
    process.exit(1)
  }

  // Get current and previous cache versions to verify bumps actually happened
  try {
    const currentVersions = getCacheVersions()

    // Get previous versions from base branch
    let previousVersions
    try {
      const prevContent = execSync(
        `git show ${baseBranch}:.github/cache-versions.json`,
        { encoding: 'utf-8' },
      )
      previousVersions = JSON.parse(prevContent).versions
    } catch {
      console.log(
        'Warning: Could not get previous cache versions from base branch.',
      )
      console.log(
        'Assuming this is a new addition or base branch is unavailable.',
      )
      process.exit(0)
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
      console.error('ERROR: Cache versions were not properly bumped:')
      missingBumps.forEach(({ current, package: pkg, previous }) => {
        console.error(`  - ${pkg}: ${previous} → ${current} (should increase)`)
      })
      console.error(
        '\nSee CLAUDE.md "Cache Version Cascade Dependencies" for details.',
      )
      process.exit(1)
    }

    console.log('✓ All required cache version bumps verified.')
    process.exit(0)
  } catch (error) {
    console.error(`Error validating cache versions: ${error.message}`)
    process.exit(1)
  }
}

main()
