#!/usr/bin/env node
/**
 * WPT Streams runner entrypoint — orchestrates the full validation run.
 *
 * Imports the reusable runner primitives from wpt-streams-runner.mts and
 * drives the end-to-end pipeline (gather → validate → report). Split from
 * wpt-streams-runner.mts to keep each file under the 500-line soft cap.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { errorMessage } from 'build-infra/lib/error-utils'

import {
  classifyResult,
  findStaleAllowlistEntries,
} from './wpt-streams/classifier.mts'
import type { TestResult, UnexpectedFailure } from './wpt-streams/types.mts'
import {
  ensureWptStreams,
  EXPECTED_FAILURES,
  findTestFiles,
  parseArgs,
  resolveDefaultBinary,
  runTestFile,
  SKIP_FILES,
  WPT_DIR,
  WPT_SUBMODULE_DIR,
} from './wpt-streams-runner.mts'

const logger = getDefaultLogger()

async function main(): Promise<void> {
  const opts = parseArgs()
  // Fill the default dev binary when none was passed (async platform-arch
  // lookup, so it can't be a module-scope const).
  if (!opts.binary) {
    opts.binary = await resolveDefaultBinary()
  }

  logger.info('=== WPT Streams Validation ===')
  logger.error('')

  // Check binary
  if (!existsSync(opts.binary)) {
    logger.fail(`Binary not found: ${opts.binary}`)
    logger.log('')
    logger.log('Build the binary first:')
    logger.substep(
      'pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build',
    )
    process.exitCode = 1
    return
  }

  // Ensure WPT streams is on disk. The submodule's recorded SHA
  // (.gitmodules gitlink) is the version pointer; sparse-checkout =
  // streams/ in .gitmodules is honored by
  // scripts/git-partial-submodule.mts.
  await ensureWptStreams(opts.force)

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
  // Surface the submodule SHA — the version pointer post-migration.
  // Best-effort; if `git -C` fails we just skip the line.
  try {
    const shaResult = await spawn(
      'git',
      ['-C', WPT_SUBMODULE_DIR, 'rev-parse', 'HEAD'],
      { stdio: ['inherit', 'pipe', 'pipe'] },
    )
    const sha = String(shaResult.stdout ?? '').trim()
    if (sha) {
      logger.info(`WPT ref: ${sha.slice(0, 8)}`)
    }
  } catch {
    // Silent — informational only.
  }
  if (opts.filter) {
    logger.info(`Filter: ${opts.filter}`)
  }
  logger.log('')

  // Run tests
  let totalPassed = 0
  let totalFailed = 0
  let totalTests = 0
  let filesWithFailures = 0

  // Track failures against expected list. `matchedExpected` accumulates
  // across files; `unexpectedFailures` collects regressions.
  const matchedExpected = new Set<string>()
  const unexpectedFailures: UnexpectedFailure[] = []

  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier
  for (const testFile of testFiles) {
    let result: TestResult
    try {
      result = await runTestFile(opts.binary, testFile)
    } catch (e) {
      const rel = path.relative(WPT_DIR, testFile)
      result = {
        file: rel,
        passed: 0,
        failed: 1,
        total: 1,
        errors: [`Runner error: ${errorMessage(e)}`],
      }
    }

    totalPassed += result.passed
    totalFailed += result.failed
    totalTests += result.total

    // Classify this file's failures against the allowlist. The
    // classifier is pure + unit-tested at
    // test/unit/wpt-streams-classifier.test.mts.
    const classification = classifyResult(result, EXPECTED_FAILURES)
    if (result.failed > 0) {
      filesWithFailures++
    }
    for (const key of classification.matchedExpected) {
      matchedExpected.add(key)
    }
    for (const u of classification.unexpected) {
      unexpectedFailures.push(u)
    }

    // Status: green checkmark, yellow tilde (expected fail), red X (unexpected fail)
    let status
    if (result.failed === 0) {
      // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
      status = '\x1b[32m✓\x1b[0m'
    } else {
      // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
      status = classification.allExpected
        ? '\x1b[33m~\x1b[0m'
        : '\x1b[31m✗\x1b[0m'
    }

    logger.log(`${status} ${result.file} (${result.passed}/${result.total})`)

    if (result.failed > 0) {
      if (opts.verbose) {
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const err of result.errors) {
          logger.substep(err)
        }
      } else if (result.errors.length > 0) {
        // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
        for (const err of result.errors.slice(0, 2)) {
          logger.substep(err)
        }
        if (result.errors.length > 2) {
          logger.substep(`... and ${result.errors.length - 2} more`)
        }
      }
    }
  }

  // Find expected failures that now pass (improvements) — stale
  // allowlist entries. Surfaced to the user so they can prune.
  const nowPassing = findStaleAllowlistEntries(
    EXPECTED_FAILURES,
    matchedExpected,
  )

  // Summary
  logger.log('')
  logger.log(`${'='.repeat(60)}`)
  logger.log('Results:')
  logger.substep(`Total tests: ${totalTests}`)
  logger.substep(`Passed: \x1b[32m${totalPassed}\x1b[0m`)
  logger.substep(`Failed: \x1b[31m${totalFailed}\x1b[0m`)
  logger.substep(
    `Pass rate: ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`,
  )
  logger.substep(
    `Files with failures: ${filesWithFailures}/${testFiles.length}`,
  )

  // Expected vs unexpected
  logger.log('')
  logger.substep(
    `Expected failures: ${matchedExpected.size}/${EXPECTED_FAILURES.size}`,
  )
  logger.substep(`Unexpected failures: ${unexpectedFailures.length}`)

  if (nowPassing.length > 0) {
    logger.log('')
    logger.log('[32m✨ Tests that now PASS (update expected failures list):[0m')
    for (let i = 0, { length } = nowPassing; i < length; i += 1) {
      const key = nowPassing[i]
      logger.substep(`- ${key}`)
    }
  }

  if (unexpectedFailures.length > 0) {
    logger.error('')
    // oxlint-disable-next-line socket/no-status-emoji -- WPT validator emits ANSI-colored status markers ("\x1b[32m✓\x1b[0m" etc.) in column-aligned table rows; logger.success() would lose the colorization required by the WPT result format.
    logger.fail('[31m❌ UNEXPECTED failures (regressions):[0m')
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const { file, test } of unexpectedFailures.slice(0, 10)) {
      logger.substep(`- ${file}: ${test}`)
    }
    if (unexpectedFailures.length > 10) {
      logger.substep(`... and ${unexpectedFailures.length - 10} more`)
    }
  }

  // Exit with failure only if there are unexpected failures
  if (unexpectedFailures.length > 0) {
    logger.log('')
    logger.log('[31mFAILED: Unexpected test failures detected[0m')
    process.exitCode = 1
  } else if (totalFailed > 0) {
    logger.log('')
    logger.log(
      '[32mPASSED: All failures are expected (matches native Node 25)[0m',
    )
  }
}

main().catch(err => {
  logger.fail(`WPT runner failed: ${errorMessage(err)}`)
  process.exitCode = 1
})
