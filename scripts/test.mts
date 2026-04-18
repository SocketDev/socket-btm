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

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn, spawnSync } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.dirname(__dirname)

/**
 * Check if a command exists
 * @param {string} command - Command to check
 * @returns {boolean} True if command exists
 */
function commandExists(command: string): boolean {
  try {
    let result
    if (WIN32) {
      result = spawnSync('where', [command], { stdio: 'ignore' })
    } else {
      result = spawnSync('sh', ['-c', `command -v "${command}"`], {
        stdio: 'ignore',
      })
    }
    return result.status === 0 && !result.error
  } catch {
    return false
  }
}

/**
 * Pre-flight check for common build tools
 * Warns if tools are missing but doesn't block (individual tests will skip gracefully)
 */
function preflightCheck(): void {
  const warnings: string[] = []

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
    logger.info(`\n${warnings.join('\n')}\n`)
  }
}

async function main(): Promise<void> {
  const argv: string[] = process.argv
  const isStaged = argv.includes('--staged')
  const isChanged = argv.includes('--changed')

  // Run pre-flight checks (warnings only, doesn't block)
  preflightCheck()

  if (isStaged) {
    // Get staged test files
    const { stdout } = await spawn(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
      {
        cwd: ROOT_DIR,
      },
    )
    const stagedFiles = String(stdout)
      .trim()
      .split('\n')
      .filter(Boolean)
      .filter(
        (file: string) =>
          file.endsWith('.test.js') ||
          file.endsWith('.test.mts') ||
          file.endsWith('.test.ts'),
      )
      .map((file: string) => path.resolve(ROOT_DIR, file))
      .filter((file: string) => existsSync(file))

    if (stagedFiles.length === 0) {
      logger.info('No staged test files to run')
      process.exitCode = 0
    } else {
      logger.info(
        `Running tests for ${stagedFiles.length} staged test file(s)...`,
      )

      // Run vitest with specific test files
      // Group files by package to run tests in each package context
      const filesByPackage = new Map<string, string[]>()
      for (const file of stagedFiles) {
        // Find the package directory (contains package.json)
        let pkgDir = path.dirname(file)
        const { root } = path.parse(pkgDir)
        while (pkgDir !== ROOT_DIR && pkgDir !== root) {
          if (existsSync(path.join(pkgDir, 'package.json'))) {
            break
          }
          pkgDir = path.dirname(pkgDir)
        }

        // Skip files not in a package
        if (pkgDir === ROOT_DIR || pkgDir === root) {
          continue
        }

        if (!filesByPackage.has(pkgDir)) {
          filesByPackage.set(pkgDir, [])
        }
        const pkgFiles = filesByPackage.get(pkgDir)
        if (pkgFiles) {
          pkgFiles.push(file)
        }
      }

      // Run tests for each package
      let exitCode = 0
      for (const [pkgDir, files] of filesByPackage) {
        const pkgName = path.relative(ROOT_DIR, pkgDir)
        logger.info(`\nTesting ${pkgName}:`)

        try {
          // --passWithNoTests: a scoped run where files don't resolve to
          // any test should succeed rather than error with "No test files
          // found". Keeps pre-commit hooks passing when a staged change
          // doesn't touch testable code.
          const result = spawnSync(
            'pnpm',
            ['exec', 'vitest', 'run', '--passWithNoTests', ...files],
            {
              cwd: pkgDir,
              stdio: 'inherit',
            },
          )
          if (result.error) {
            logger.error(`Failed to spawn vitest: ${result.error.message}`)
            exitCode = 1
          } else if (result.status !== 0) {
            exitCode = result.status || 1
          }
        } catch (e) {
          logger.error(
            `Unexpected error running tests: ${(e as Error).message}`,
          )
          exitCode = 1
        }
      }

      process.exitCode = exitCode
    }
  } else {
    // Run all tests
    // Supported flags: --all, --changed (both run all tests)
    // Default behavior (no flags): run all tests

    if (isChanged) {
      logger.info('Note: --changed flag currently runs all tests')
    }

    try {
      await spawn('pnpm', ['--recursive', 'test'], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      })
    } catch (e) {
      const exitCode =
        e &&
        typeof e === 'object' &&
        'exitCode' in e &&
        typeof (e as { exitCode: unknown }).exitCode === 'number'
          ? (e as { exitCode: number }).exitCode
          : 1
      process.exitCode = exitCode
    }
  }
}

main().catch((e: unknown) => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
