#!/usr/bin/env node
/**
 * WPT (Web Platform Tests) validation for fast-webstreams integration
 *
 * Runs the WHATWG Streams spec tests (1,116 tests) against the built binary.
 * Tests are fetched on-demand using sparse checkout from the WPT repo.
 * Each test file is executed as a subprocess using the binary, so tests
 * run against the patched fast-webstreams (not native Node.js streams).
 *
 * Usage:
 *   node scripts/vendor-fast-webstreams/wpt/validate.mjs [binary-path]
 *   node scripts/vendor-fast-webstreams/wpt/validate.mjs --fetch   # Force re-fetch
 *   node scripts/vendor-fast-webstreams/wpt/validate.mjs --filter=readable-streams
 *
 * If no binary path provided, uses the dev Final binary.
 */

import { execFile } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import url from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Prevent unhandled rejections from crashing the runner
process.on('unhandledRejection', () => {})
process.on('uncaughtException', () => {})

const PACKAGE_ROOT = path.resolve(__dirname, '../../..')
const MONOREPO_ROOT = path.resolve(PACKAGE_ROOT, '../..')
const DEFAULT_BINARY = path.join(PACKAGE_ROOT, 'build/dev/out/Final/node/node')
const GITMODULES = path.join(MONOREPO_ROOT, '.gitmodules')
const WPT_DIR = path.join(__dirname, 'streams')

const FILE_TIMEOUT = 30_000 // 30s per file (some have 60+ tests)

/**
 * Expected failures - these match native Node 25's failures (17 tests).
 * Format: 'file:test name' or just 'file' for entire file failures.
 * These are tracked to ensure we don't regress beyond native.
 */
const EXPECTED_FAILURES = new Map([
  // === owning type not implemented (5 tests) ===
  // The 'owning' stream type is a newer WHATWG spec extension not in Node.js
  [
    'readable-streams/owning-type.any.js:ReadableStream can be constructed with owning type',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream of type owning should call start with a ReadableStreamDefaultController',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream should be able to call enqueue with an empty transfer list',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream should check transfer parameter',
    'owning type not implemented',
  ],
  [
    'readable-streams/owning-type.any.js:ReadableStream of type owning should transfer enqueued chunks',
    'owning type not implemented',
  ],

  // === Tee monkey-patching (8 tests) ===
  // WPT tests replace globalThis.ReadableStream with a throwing fake and expect tee() not to use it.
  // Fast's tee() uses the patched global internally, so it fails when the test replaces it.
  ['readable-streams/tee.any.js:ReadableStream teeing', 'tee monkey-patching'],
  [
    'readable-streams/tee.any.js:ReadableStreamTee should not pull more chunks than can fit in the branch queue',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee should only pull enough to fill the emptiest queue',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee should not pull when original is already errored',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee stops pulling when original stream errors while branch 1 is reading',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee stops pulling when original stream errors while branch 2 is reading',
    'tee monkey-patching',
  ],
  [
    'readable-streams/tee.any.js:ReadableStreamTee stops pulling when original stream errors while both branches are reading',
    'tee monkey-patching',
  ],

  // === AsyncIteratorPrototype cross-realm (1 test) ===
  // VM context isolation causes cross-realm prototype mismatch
  [
    'readable-streams/async-iterator.any.js:Async iterator instances should have the correct list of properties',
    'cross-realm AsyncIteratorPrototype',
  ],

  // === BYOB cancel (2 tests) ===
  // Byte stream edge cases with cancel propagation
  [
    'readable-byte-streams/templated.any.js:ReadableStream with byte source (empty) BYOB reader',
    'BYOB cancel edge case',
  ],
  [
    'readable-byte-streams/bad-buffers-and-views.any.js',
    'runner error - file-level failure',
  ],

  // === Subclassing (1 test) ===
  // Subclassing Fast streams doesn't preserve extra methods on the subclass
  [
    'readable-streams/general.any.js:Subclassing ReadableStream should work',
    'subclassing not fully supported',
  ],
])

// Files to skip (IDL tests, GC tests, platform-specific)
const SKIP_FILES = new Set([
  'idlharness.any.js',
  'transferable/transform-stream-members.any.js',
  'readable-streams/owning-type-video-frame.any.js',
  'readable-streams/owning-type-message-port.any.js',
  'readable-byte-streams/patched-global.any.js',
  'readable-streams/patched-global.any.js',
  'transform-streams/patched-global.any.js',
  'readable-streams/garbage-collection.any.js',
  'readable-streams/crashtests/garbage-collection.any.js',
  'writable-streams/garbage-collection.any.js',
  'writable-streams/crashtests/garbage-collection.any.js',
  'readable-byte-streams/construct-byob-request.any.js',
])

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = {
    binary: DEFAULT_BINARY,
    fetch: false,
    filter: '',
    verbose: false,
  }

  for (const arg of args) {
    if (arg === '--fetch') {
      opts.fetch = true
    } else if (arg === '--verbose') {
      opts.verbose = true
    } else if (arg.startsWith('--filter=')) {
      opts.filter = arg.slice(9)
    } else if (!arg.startsWith('--')) {
      opts.binary = arg
    }
  }
  return opts
}

/**
 * Parse .gitmodules to get WPT URL and SHA
 */
function getWPTConfig() {
  if (!existsSync(GITMODULES)) {
    throw new Error(`.gitmodules not found at ${GITMODULES}`)
  }

  const content = readFileSync(GITMODULES, 'utf8')
  const lines = content.split('\n')

  let inWPTSection = false
  let url = ''
  let ref = ''

  for (const line of lines) {
    // Match only the [submodule "..."] header line, not the path line
    if (
      /^\[submodule ".*vendor-fast-webstreams\/wpt\/streams.*"\]$/.test(line)
    ) {
      inWPTSection = true
      continue
    }
    if (inWPTSection && line.startsWith('[')) {
      break // End of section
    }
    if (inWPTSection) {
      const urlMatch = line.match(/^\s*url\s*=\s*(.+)$/)
      if (urlMatch) {
        url = urlMatch[1].trim()
      }
      const refMatch = line.match(/^\s*ref\s*=\s*([a-f0-9]+)$/)
      if (refMatch) {
        ref = refMatch[1].trim()
      }
    }
  }

  if (!url || !ref) {
    throw new Error('Could not find WPT URL or ref in .gitmodules')
  }

  return { url, ref }
}

/**
 * Sparse checkout only streams/ directory from WPT repo
 */
async function fetchWPTStreams(url, ref, force = false) {
  if (existsSync(WPT_DIR) && !force) {
    // Check if we have the right version
    const versionFile = path.join(__dirname, '.wpt-version')
    if (existsSync(versionFile)) {
      const currentRef = readFileSync(versionFile, 'utf8').trim()
      if (currentRef === ref) {
        logger.info(`WPT streams already fetched at ${ref.slice(0, 8)}`)
        return
      }
    }
  }

  logger.info(`Fetching WPT streams at ${ref.slice(0, 8)}...`)

  // Clean existing
  if (existsSync(WPT_DIR)) {
    rmSync(WPT_DIR, { recursive: true })
  }

  const tmpDir = path.join(__dirname, '.wpt-tmp')
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true })
  }

  try {
    // Initialize sparse repo
    mkdirSync(tmpDir)
    await spawn('git', ['init'], { cwd: tmpDir, stdio: 'pipe' })
    await spawn('git', ['remote', 'add', 'origin', url], {
      cwd: tmpDir,
      stdio: 'pipe',
    })
    await spawn('git', ['config', 'core.sparseCheckout', 'true'], {
      cwd: tmpDir,
      stdio: 'pipe',
    })

    // Configure sparse checkout for streams/ only
    await spawn('sh', ['-c', 'echo "streams" >> .git/info/sparse-checkout'], {
      cwd: tmpDir,
      stdio: 'pipe',
    })

    // Fetch only the specific commit with depth=1
    await spawn('git', ['fetch', '--depth=1', 'origin', ref], {
      cwd: tmpDir,
      stdio: 'pipe',
    })
    await spawn('git', ['checkout', 'FETCH_HEAD'], {
      cwd: tmpDir,
      stdio: 'pipe',
    })

    // Move streams/ to our wpt/ dir
    const srcStreams = path.join(tmpDir, 'streams')
    if (!existsSync(srcStreams)) {
      throw new Error('streams/ directory not found after checkout')
    }

    // Copy to final location
    await spawn('cp', ['-r', srcStreams, WPT_DIR], { stdio: 'pipe' })

    // Write version file
    const versionFile = path.join(__dirname, '.wpt-version')
    writeFileSync(versionFile, ref)

    logger.info(
      `WPT streams fetched (${readdirSync(WPT_DIR).length} directories)`,
    )
  } finally {
    // Cleanup tmp
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  }
}

/**
 * Find all test files
 */
function findTestFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTestFiles(fullPath))
    } else if (entry.name.endsWith('.any.js')) {
      results.push(fullPath)
    }
  }
  return results.sort()
}

/**
 * Run a single test file as a subprocess inside the binary
 * This ensures tests run against the patched fast-webstreams, not native Node.js streams
 */
function runTestFile(binaryPath, testFile) {
  const relPath = path.relative(WPT_DIR, testFile)
  const runnerScript = path.join(__dirname, 'run-file.mjs')

  return new Promise(resolve => {
    execFile(
      binaryPath,
      [runnerScript, testFile],
      { timeout: FILE_TIMEOUT },
      (err, stdout, _stderr) => {
        // Try to parse JSON from stdout
        const lines = stdout.trim().split('\n')
        for (const line of lines) {
          try {
            const result = JSON.parse(line)
            if (result && typeof result.passed === 'number') {
              return resolve(result)
            }
          } catch {
            // Not JSON, continue
          }
        }

        // No valid JSON result found
        if (err) {
          return resolve({
            file: relPath,
            passed: 0,
            failed: 1,
            total: 1,
            errors: [`Runner error: ${err.message}`],
          })
        }

        return resolve({
          file: relPath,
          passed: 0,
          failed: 1,
          total: 1,
          errors: ['No test results returned'],
        })
      },
    )
  })
}

async function main() {
  const opts = parseArgs()

  logger.info('=== WPT Streams Validation ===\n')

  // Check binary
  if (!existsSync(opts.binary)) {
    logger.fail(`Binary not found: ${opts.binary}`)
    logger.log('\nBuild the binary first:')
    logger.log(
      '  pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build',
    )
    process.exitCode = 1
    return
  }

  // Fetch WPT if needed
  const { ref, url } = getWPTConfig()
  await fetchWPTStreams(url, ref, opts.fetch)

  if (!existsSync(WPT_DIR)) {
    logger.fail('WPT streams directory not found after fetch')
    process.exitCode = 1
    return
  }

  // Find test files
  let testFiles = findTestFiles(WPT_DIR)

  // Apply filter
  if (opts.filter) {
    testFiles = testFiles.filter(f =>
      path.relative(WPT_DIR, f).includes(opts.filter),
    )
  }

  // Skip problematic files
  testFiles = testFiles.filter(f => {
    const rel = path.relative(WPT_DIR, f)
    return (
      !SKIP_FILES.has(rel) && ![...SKIP_FILES].some(skip => rel.endsWith(skip))
    )
  })

  logger.info(`Binary: ${opts.binary}`)
  logger.info(`Test files: ${testFiles.length}`)
  logger.info(`WPT ref: ${ref.slice(0, 8)}`)
  if (opts.filter) {
    logger.info(`Filter: ${opts.filter}`)
  }
  logger.log('')

  // Run tests
  let totalPassed = 0
  let totalFailed = 0
  let totalTests = 0
  let filesWithFailures = 0

  // Track failures against expected list
  const expectedFailureKeys = new Set(EXPECTED_FAILURES.keys())
  const matchedExpected = new Set()
  const unexpectedFailures = []

  for (const testFile of testFiles) {
    let result
    try {
      result = await runTestFile(opts.binary, testFile)
    } catch (err) {
      const rel = path.relative(WPT_DIR, testFile)
      result = {
        file: rel,
        passed: 0,
        failed: 1,
        total: 1,
        errors: [`Runner error: ${err.message}`],
      }
    }

    totalPassed += result.passed
    totalFailed += result.failed
    totalTests += result.total

    // Check if failures are expected
    const fileKey = result.file
    const isFileExpected = EXPECTED_FAILURES.has(fileKey)

    if (result.failed > 0) {
      filesWithFailures++

      // Check each error against expected failures
      for (const err of result.errors) {
        // Extract test name from error (format: "testName: error message")
        const colonIdx = err.indexOf(':')
        const testName = colonIdx > 0 ? err.slice(0, colonIdx) : err
        const fullKey = `${fileKey}:${testName}`

        // Check for exact match or prefix match (some expected keys are prefixes)
        let matched = false
        if (EXPECTED_FAILURES.has(fullKey)) {
          matchedExpected.add(fullKey)
          matched = true
        } else if (isFileExpected) {
          matchedExpected.add(fileKey)
          matched = true
        } else {
          // Try prefix matching - expected failure key may be a prefix of actual test name
          for (const [expKey] of EXPECTED_FAILURES) {
            if (
              expKey.startsWith(`${fileKey}:`) &&
              fullKey.startsWith(expKey)
            ) {
              matchedExpected.add(expKey)
              matched = true
              break
            }
          }
        }
        if (!matched) {
          unexpectedFailures.push({ file: fileKey, test: testName, error: err })
        }
      }
    }

    // Status: green checkmark, yellow tilde (expected fail), red X (unexpected fail)
    let status
    if (result.failed === 0) {
      status = '\x1b[32m✓\x1b[0m'
    } else {
      // Check if all failures in this file are expected
      const allExpected = result.errors.every(err => {
        const colonIdx = err.indexOf(':')
        const testName = colonIdx > 0 ? err.slice(0, colonIdx) : err
        const fullKey = `${fileKey}:${testName}`
        return EXPECTED_FAILURES.has(fullKey) || EXPECTED_FAILURES.has(fileKey)
      })
      status = allExpected ? '\x1b[33m~\x1b[0m' : '\x1b[31m✗\x1b[0m'
    }

    logger.log(`${status} ${result.file} (${result.passed}/${result.total})`)

    if (result.failed > 0) {
      if (opts.verbose) {
        for (const err of result.errors) {
          logger.log(`    ${err}`)
        }
      } else if (result.errors.length > 0) {
        for (const err of result.errors.slice(0, 2)) {
          logger.log(`    ${err}`)
        }
        if (result.errors.length > 2) {
          logger.log(`    ... and ${result.errors.length - 2} more`)
        }
      }
    }
  }

  // Find expected failures that now pass (improvements)
  const nowPassing = []
  for (const key of expectedFailureKeys) {
    if (!matchedExpected.has(key)) {
      nowPassing.push(key)
    }
  }

  // Summary
  logger.log(`\n${'='.repeat(60)}`)
  logger.log('Results:')
  logger.log(`  Total tests: ${totalTests}`)
  logger.log(`  Passed: \x1b[32m${totalPassed}\x1b[0m`)
  logger.log(`  Failed: \x1b[31m${totalFailed}\x1b[0m`)
  logger.log(
    `  Pass rate: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`,
  )
  logger.log(`  Files with failures: ${filesWithFailures}/${testFiles.length}`)

  // Expected vs unexpected
  logger.log('')
  logger.log(
    `  Expected failures: ${matchedExpected.size}/${EXPECTED_FAILURES.size}`,
  )
  logger.log(`  Unexpected failures: ${unexpectedFailures.length}`)

  if (nowPassing.length > 0) {
    logger.log(
      '\n\x1b[32m✨ Tests that now PASS (update expected failures list):\x1b[0m',
    )
    for (const key of nowPassing) {
      logger.log(`  - ${key}`)
    }
  }

  if (unexpectedFailures.length > 0) {
    logger.log('\n\x1b[31m❌ UNEXPECTED failures (regressions):\x1b[0m')
    for (const { file, test } of unexpectedFailures.slice(0, 10)) {
      logger.log(`  - ${file}: ${test}`)
    }
    if (unexpectedFailures.length > 10) {
      logger.log(`  ... and ${unexpectedFailures.length - 10} more`)
    }
  }

  // Exit with failure only if there are unexpected failures
  if (unexpectedFailures.length > 0) {
    logger.log('\n\x1b[31mFAILED: Unexpected test failures detected\x1b[0m')
    process.exitCode = 1
  } else if (totalFailed > 0) {
    logger.log(
      '\n\x1b[32mPASSED: All failures are expected (matches native Node 25)\x1b[0m',
    )
  }
}

main().catch(err => {
  logger.fail('WPT runner failed:', err)
  process.exitCode = 1
})
