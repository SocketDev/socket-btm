#!/usr/bin/env node
/**
 * @file Run Node.js test suite against node-smol binary
 *   node-smol is built with these flags:
 *
 *   - --with-intl=small-icu (limited ICU, English-only)
 *   - --without-npm (no npm)
 *   - --without-amaro (no TypeScript stripping)
 *   - --without-node-options (no NODE_OPTIONS)
 *   - --without-inspector (prod builds only, no debugger)
 *   - --experimental-enable-pointer-compression (reduced memory usage)
 *   - corepack not bundled in Node.js v25+ by default This script runs a curated
 *     subset of Node.js tests that should work with the node-smol feature set.
 *     Filtering Strategy:
 *
 *   1. Expand TEST_PATTERNS using glob to get candidate test files
 *   2. Filter out files matching SKIP_PATTERNS
 *   3. Pass filtered list to Node.js test.py
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib-stable/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { errorMessage } from 'build-infra/lib/error-utils'

import {
  getBuildPaths,
  getDefaultPlatformArch,
  UPSTREAM_PATH,
} from './paths.mts'
import { SKIP_PATTERNS, TEST_PATTERNS } from './test-node-suite-patterns.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

// Parse arguments.
const { values } = parseArgs({
  options: {
    binary: { type: 'string' },
    dev: { type: 'boolean' },
    jobs: { type: 'string' },
    'platform-arch': { type: 'string' },
    prod: { type: 'boolean' },
    verbose: { short: 'v', type: 'boolean' },
  },
  strict: false,
})

const IS_CI = 'CI' in process.env || 'CONTINUOUS_INTEGRATION' in process.env
const BUILD_MODE = values['prod'] || (!values['dev'] && IS_CI) ? 'prod' : 'dev'

/**
 * Compile skip patterns once for efficient reuse.
 * Pre-computes regex and stripped patterns to avoid repeated string operations.
 *
 * @param {string[]} skipPatterns - Raw skip patterns.
 *
 * @returns {{ regex: RegExp; stripped: string }[]} Compiled patterns
 */
export function compileSkipPatterns(skipPatterns) {
  return skipPatterns.map(pattern => {
    const lowerPattern = pattern.toLowerCase()
    return {
      regex: new RegExp(
        `^${lowerPattern.replaceAll('*', '.*').replaceAll('?', '.')}$`,
      ),
      stripped: lowerPattern.replaceAll('*', ''),
    }
  })
}

/**
 * Expand glob patterns into actual test file paths.
 *
 * @param {string} testDir - Node.js test directory.
 * @param {string[]} patterns - Glob patterns to expand.
 *
 * @returns {Promise<string[]>} Array of absolute test file paths
 */
export async function expandTestPatterns(testDir, patterns) {
  const matchedFiles = new Set()
  const checkedDirs = new Set()
  const dirEntryCache = new Map()

  for (let i = 0, { length } = patterns; i < length; i += 1) {
    const pattern = patterns[i]
    const fullPattern = path.join(testDir, pattern)
    const dir = path.dirname(fullPattern)
    const filePattern = path.basename(fullPattern)

    // Check if directory exists (cached to avoid repeated existsSync calls).
    if (!checkedDirs.has(dir)) {
      checkedDirs.add(dir)
      if (!existsSync(dir)) {
        continue
      }
    } else if (!dirEntryCache.has(dir)) {
      // Previously checked and didn't exist
      continue
    }

    // Convert glob pattern to regex.
    const regex = new RegExp(
      `^${filePattern.replaceAll('*', '.*').replaceAll('?', '.')}$`,
    )

    try {
      // Use cached directory entries or read with withFileTypes to avoid stat calls.
      let entries = dirEntryCache.get(dir)
      if (!entries) {
        entries = await fs.readdir(dir, { withFileTypes: true })
        dirEntryCache.set(dir, entries)
      }

      for (
        let j = 0, { length: entriesLength } = entries;
        j < entriesLength;
        j += 1
      ) {
        const entry = entries[j]
        if (entry.isFile() && regex.test(entry.name)) {
          matchedFiles.add(path.join(dir, entry.name))
        }
      }
    } catch {
      // Ignore errors reading directory.
    }
  }

  return [...matchedFiles].toSorted()
}

/**
 * Filter test files based on skip patterns.
 *
 * @param {string[]} testFiles - Array of test file paths.
 * @param {string[]} skipPatterns - Patterns to skip.
 *
 * @returns {object} Filtered tests and statistics
 */
export function filterTests(testFiles, skipPatterns) {
  const filtered = []
  const skipped = []

  // Pre-compile patterns once for efficient reuse across all test files.
  const compiledPatterns = compileSkipPatterns(skipPatterns)

  for (let i = 0, { length } = testFiles; i < length; i += 1) {
    const testFile = testFiles[i]
    if (shouldSkipTest(testFile, compiledPatterns)) {
      skipped.push(testFile)
    } else {
      filtered.push(testFile)
    }
  }

  return {
    filtered,
    skipped,
    stats: {
      filtered: filtered.length,
      skipped: skipped.length,
      total: testFiles.length,
    },
  }
}

/**
 * Check if a test file path matches any skip pattern.
 *
 * @param {string} testPath - Absolute test file path.
 * @param {{ regex: RegExp; stripped: string }[]} compiledPatterns -
 *   Pre-compiled patterns.
 *
 * @returns {boolean} True if should be skipped
 */
export function shouldSkipTest(testPath, compiledPatterns) {
  const testName = path.basename(testPath).toLowerCase()
  const testRelPath = testPath.toLowerCase()

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const { regex, stripped } of compiledPatterns) {
    // Match against filename.
    if (regex.test(testName)) {
      return true
    }

    // Match against relative path.
    if (testRelPath.includes(stripped)) {
      return true
    }
  }

  return false
}

/**
 * Main test runner.
 */
async function main() {
  logger.log('')
  logger.log('🧪 Node.js Test Suite Runner for node-smol')
  logger.log('')

  // Determine binary path.
  // Use provided platform-arch or auto-detect from current system.
  const platformArch = values['platform-arch'] || getDefaultPlatformArch()
  const { outputFinalBinary } = getBuildPaths(
    BUILD_MODE,
    process.platform,
    platformArch,
  )
  const binaryPath = values['binary'] || outputFinalBinary

  if (!existsSync(binaryPath)) {
    logger.fail(`Binary not found: ${binaryPath}`)
    logger.log('')
    logger.log('Build node-smol first:')
    logger.log('  pnpm build')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`Binary: ${binaryPath}`)
  logger.log(`Build mode: ${BUILD_MODE}`)
  logger.log('')

  // Verify Node.js source upstream.
  const nodeSourcePath = UPSTREAM_PATH
  if (!existsSync(nodeSourcePath)) {
    logger.fail('Node.js source upstream not found')
    logger.log('')
    logger.log('Initialize upstream:')
    logger.log('  git submodule update --init --recursive')
    logger.log('')
    process.exitCode = 1
    return
  }

  const testDir = path.join(nodeSourcePath, 'test')
  if (!existsSync(testDir)) {
    logger.fail(`Test directory not found: ${testDir}`)
    process.exitCode = 1
    return
  }

  logger.log(`Test directory: ${testDir}`)
  logger.log('')

  // Expand test patterns into actual file paths.
  logger.step('Expanding test patterns…')
  const candidateTests = await expandTestPatterns(testDir, TEST_PATTERNS)
  logger.log(`Found ${candidateTests.length} candidate tests`)
  logger.log('')

  // Filter tests based on skip patterns.
  logger.step('Filtering tests…')
  const { filtered, skipped, stats } = filterTests(
    candidateTests,
    SKIP_PATTERNS,
  )

  logger.log(`Total matched: ${stats.total}`)
  logger.log(`Filtered (will run): ${stats.filtered}`)
  logger.log(`Skipped (excluded): ${stats.skipped}`)
  logger.log('')

  if (values['verbose'] && skipped.length > 0) {
    logger.log('Skipped tests (first 10):')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
    for (const test of skipped.slice(0, 10)) {
      logger.log(`  - ${path.basename(test)}`)
    }
    if (skipped.length > 10) {
      logger.log(`  ... and ${skipped.length - 10} more`)
    }
    logger.log('')
  }

  if (filtered.length === 0) {
    logger.fail('No tests to run after filtering')
    process.exitCode = 1
    return
  }

  // Determine number of parallel jobs.
  const jobs = values['jobs'] || Math.max(1, os.cpus().length - 1)

  logger.log('Test configuration:')
  logger.log(`  Parallel jobs: ${jobs}`)
  logger.log(`  Verbose: ${values['verbose'] ? 'yes' : 'no'}`)
  logger.log('')

  // Build test command.
  // Use Node.js's test.py runner with our binary.
  const pythonBin = 'python3'
  const testScript = path.join(nodeSourcePath, 'tools', 'test.py')

  if (!existsSync(testScript)) {
    logger.fail(`Test runner not found: ${testScript}`)
    process.exitCode = 1
    return
  }

  // Pass filtered test files (relative to test dir) to test.py.
  const relativeTests = filtered.map(t => path.relative(testDir, t))

  const args = [
    testScript,
    `--shell=${binaryPath}`,
    `-j${jobs}`,
    ...relativeTests,
  ]

  if (values['verbose']) {
    args.push('--verbose')
  }

  logger.step('Running Node.js tests…')
  logger.log('')

  // Run tests.
  const result = await spawn(pythonBin, args, {
    cwd: nodeSourcePath,
    stdio: 'inherit',
  })

  logger.log('')

  if (result.code === 0) {
    logger.success('All tests passed!')
    logger.log('')
  } else {
    logger.fail(`Tests failed with exit code ${result.code}`)
    logger.log('')
    process.exitCode = result.code
  }
}

main().catch(error => {
  logger.fail(`Test runner failed: ${errorMessage(error)}`)
  throw error
})
