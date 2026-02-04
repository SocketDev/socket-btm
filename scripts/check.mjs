#!/usr/bin/env node
/**
 * @fileoverview Check runner - runs code quality checks.
 * Runs linting and formatting checks for socket-btm.
 *
 * Usage:
 *   node scripts/check.mjs [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --fix      Auto-fix issues where possible
 */

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()

async function runLint(fix = false, all = false, staged = false) {
  const args = fix ? ['run', 'lint:fix'] : ['run', 'lint']
  if (all) {
    args.push('--all')
  }
  if (staged) {
    args.push('--staged')
  }

  logger.step(fix ? 'Auto-fixing lint issues' : 'Running lint checks')

  const result = await spawn(await which('pnpm'), args, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error('Lint checks failed')
    return result.code
  }

  logger.success('Lint checks passed')
  return 0
}

async function runFormat(write = false) {
  const _args = ['run', write ? 'format' : 'format:check']

  logger.step(write ? 'Formatting code' : 'Checking code formatting')

  // Check if format:check script exists, if not use biome directly
  const checkArgs = write
    ? ['exec', 'biome', 'format', '--write', '.']
    : ['exec', 'biome', 'format', '.']

  const result = await spawn(await which('pnpm'), checkArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    if (!write) {
      logger.error('Code formatting issues found')
      logger.info('Run: pnpm run format (or pnpm check --fix)')
    } else {
      logger.error('Formatting failed')
    }
    return result.code
  }

  logger.success(write ? 'Code formatted' : 'Code formatting OK')
  return 0
}

async function main() {
  const quiet = process.argv.includes('--quiet')
  const fix = process.argv.includes('--fix')
  const all = process.argv.includes('--all')
  const staged = process.argv.includes('--staged')
  const help = process.argv.includes('--help')

  if (help) {
    logger.log('Socket BTM Check Runner')
    logger.log('\nUsage: node scripts/check.mjs [options]')
    logger.log('\nOptions:')
    logger.log('  --help    Show this help message')
    logger.log('  --fix     Auto-fix issues where possible')
    logger.log('  --all     Run checks on all files')
    logger.log('  --staged  Run checks on staged files only')
    logger.log('  --quiet   Suppress progress messages')
    logger.log('\nExamples:')
    logger.log('  pnpm check             # Run all checks')
    logger.log('  pnpm check --fix       # Run checks and auto-fix')
    logger.log('  pnpm check --staged    # Run checks on staged files')
    logger.log(
      '  pnpm check --all --fix # Run checks on all files and auto-fix',
    )
    process.exitCode = 0
    return
  }

  try {
    if (!quiet) {
      logger.step('Socket BTM Check Runner')
      logger.log('')
    }

    const startTime = Date.now()
    let exitCode = 0

    // Run lint checks
    exitCode = await runLint(fix, all, staged)
    if (exitCode !== 0) {
      process.exitCode = exitCode
      return
    }

    // Run format checks
    exitCode = await runFormat(fix)
    if (exitCode !== 0) {
      process.exitCode = exitCode
      return
    }

    const elapsed = Date.now() - startTime

    if (!quiet) {
      logger.log('')
      logger.success('All checks passed')
      printFooter('Checks complete', elapsed)
    }
  } catch (error) {
    logger.error(`Check runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(e)
  process.exitCode = 1
})
