#!/usr/bin/env node
/**
 * @fileoverview Test runner with flag-based configuration.
 *
 * Supports:
 * - --all: Run all tests
 * - --staged: Run tests for staged files only
 * - --changed: Run tests for changed files (not yet implemented, falls back to --all)
 *
 * Default behavior (no flags): runs all tests
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.dirname(__dirname)

/**
 * Check if a command exists
 * @param {string} command - Command to check
 * @returns {boolean} True if command exists
 */
function commandExists(command) {
  try {
    execSync(`command -v ${command}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Pre-flight check for common build tools
 * Warns if tools are missing but doesn't block (individual tests will skip gracefully)
 */
function preflightCheck() {
  const warnings = []

  // Check common build tools
  const tools = ['make', 'gcc', 'cmake', 'python3']
  const missing = tools.filter(tool => !commandExists(tool))

  if (missing.length > 0) {
    warnings.push(
      `Warning: Some build tools are missing: ${missing.join(', ')}`,
    )
    warnings.push(
      'Native package tests may skip or fail. Install build tools for full test coverage.',
    )
  }

  if (warnings.length > 0) {
    console.log(`\n${warnings.join('\n')}\n`)
  }
}

const isStaged = process.argv.includes('--staged')
const _isAll = process.argv.includes('--all')
const isChanged = process.argv.includes('--changed')

// Run pre-flight checks (warnings only, doesn't block)
preflightCheck()

if (isStaged) {
  // Get staged test files
  const stagedFiles = execSync(
    'git diff --cached --name-only --diff-filter=ACM',
    {
      encoding: 'utf8',
      cwd: ROOT_DIR,
    },
  )
    .trim()
    .split('\n')
    .filter(Boolean)
    .filter(
      file =>
        file.endsWith('.test.js') ||
        file.endsWith('.test.mjs') ||
        file.endsWith('.test.ts'),
    )
    .map(file => path.resolve(ROOT_DIR, file))
    .filter(file => existsSync(file))

  if (stagedFiles.length === 0) {
    console.log('No staged test files to run')
    process.exit(0)
  }

  console.log(`Running tests for ${stagedFiles.length} staged test file(s)...`)

  // Run vitest with specific test files
  // Group files by package to run tests in each package context
  const filesByPackage = new Map()
  for (const file of stagedFiles) {
    // Find the package directory (contains package.json)
    let pkgDir = path.dirname(file)
    while (pkgDir !== ROOT_DIR && pkgDir !== '/') {
      if (existsSync(path.join(pkgDir, 'package.json'))) {
        break
      }
      pkgDir = path.dirname(pkgDir)
    }

    // Skip files not in a package
    if (pkgDir === ROOT_DIR || pkgDir === '/') {
      continue
    }

    if (!filesByPackage.has(pkgDir)) {
      filesByPackage.set(pkgDir, [])
    }
    filesByPackage.get(pkgDir).push(file)
  }

  // Run tests for each package
  let exitCode = 0
  for (const [pkgDir, files] of filesByPackage) {
    const pkgName = path.relative(ROOT_DIR, pkgDir)
    console.log(`\nTesting ${pkgName}:`)

    try {
      execSync(`npx vitest run ${files.join(' ')}`, {
        cwd: pkgDir,
        stdio: 'inherit',
      })
    } catch {
      exitCode = 1
    }
  }

  process.exit(exitCode)
} else {
  // Run all tests
  // Supported flags: --all, --changed (both run all tests)
  // Default behavior (no flags): run all tests

  if (isChanged) {
    console.log('Note: --changed flag currently runs all tests')
  }

  try {
    execSync('pnpm --recursive test', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    })
  } catch (error) {
    process.exit(error.status || 1)
  }
}
