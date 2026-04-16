#!/usr/bin/env node
/**
 * @fileoverview Check runner - runs code quality checks.
 * Runs linting checks for socket-btm.
 *
 * Usage:
 *   node scripts/check.mts [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --fix      Auto-fix issues where possible
 */
import process from 'node:process'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()

async function runLint(
  fix = false,
  all = false,
  staged = false,
): Promise<number> {
  const args = fix ? ['run', 'lint:fix'] : ['run', 'lint']
  if (all) {
    args.push('--all')
  }
  if (staged) {
    args.push('--staged')
  }

  logger.step(fix ? 'Auto-fixing lint issues' : 'Running lint checks')

  const pnpm = await which('pnpm')
  if (!pnpm || Array.isArray(pnpm)) {
    logger.error('pnpm not found')
    return 1
  }

  const result = await spawn(pnpm, args, {
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

async function runTypeCheck(): Promise<number> {
  logger.step('Running type checks')

  const tsgoResult = await which('tsgo').catch(() => null)
  if (!tsgoResult || Array.isArray(tsgoResult)) {
    logger.warn('tsgo not found — skipping type checks')
    return 0
  }

  const result = await spawn(tsgoResult, ['--noEmit'], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error('Type checks failed')
    return result.code
  }

  logger.success('Type checks passed')
  return 0
}

async function main(): Promise<void> {
  const argv: string[] = process.argv
  const quiet = argv.includes('--quiet')
  const fix = argv.includes('--fix')
  const all = argv.includes('--all')
  const staged = argv.includes('--staged')
  const help = argv.includes('--help')

  if (help) {
    logger.log('Socket BTM Check Runner')
    logger.log('\nUsage: node scripts/check.mts [options]')
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

    // Run lint checks
    const exitCode = await runLint(fix, all, staged)
    if (exitCode !== 0) {
      process.exitCode = exitCode
      return
    }

    // Run type checks
    const typeCode = await runTypeCheck()
    if (typeCode !== 0) {
      process.exitCode = typeCode
      return
    }

    if (!quiet) {
      logger.log('')
      logger.success('All checks passed')
      printFooter('Checks complete')
    }
  } catch (e) {
    logger.error(`Check runner failed: ${(e as Error).message}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
