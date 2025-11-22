#!/usr/bin/env node
/**
 * @fileoverview Test runner that handles --staged flag for pre-commit hooks.
 *
 * When --staged is passed:
 * - Gets list of staged test files
 * - Runs vitest only on those files
 *
 * When --staged is NOT passed:
 * - Runs all tests via pnpm --recursive test
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.dirname(__dirname)

const isStaged = process.argv.includes('--staged')

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
  // --all flag explicitly runs all tests, otherwise default behavior
  try {
    execSync('pnpm --recursive test', {
      cwd: ROOT_DIR,
      stdio: 'inherit',
    })
  } catch (error) {
    process.exit(error.status || 1)
  }
}
