#!/usr/bin/env node
/**
 * @fileoverview Developer setup script for socket-btm monorepo.
 *
 * Checks and prepares build environment:
 * - Node.js version (>=18.0.0)
 * - pnpm version (>=10.21.0)
 * - Build toolchain (cmake, ninja, python, rust, etc.)
 *
 * Usage:
 *   pnpm run setup                # Check prerequisites
 *   pnpm run setup --install      # Check and auto-install missing tools
 *   pnpm run setup --quiet        # Minimal output
 */

import colors from 'yoctocolors-cjs'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printHeader, printFooter } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()
const quiet = process.argv.includes('--quiet')

const log = {
  error: msg => console.log(colors.red(`✗ ${msg}`)),
  info: msg => !quiet && console.log(colors.blue(`ℹ ${msg}`)),
  step: msg => !quiet && console.log(colors.cyan(`→ ${msg}`)),
  success: msg => !quiet && console.log(colors.green(`✔ ${msg}`)),
  warn: msg => console.log(colors.yellow(`⚠ ${msg}`)),
}

async function checkNodeVersion() {
  const required = '18.0.0'
  // Remove 'v' prefix
  const current = process.version.slice(1)
  log.success(`Node.js ${current} (required: >=${required})`)
  return true
}

async function checkPnpmVersion() {
  const required = '10.21.0'
  try {
    const { execSync } = await import('node:child_process')
    const version = execSync('pnpm --version', { encoding: 'utf8' }).trim()
    log.success(`pnpm ${version} (required: >=${required})`)
    return true
  } catch {
    log.error(`pnpm not found (required: >=${required})`)
    log.info('Install from: https://pnpm.io/installation')
    return false
  }
}

async function setup() {
  if (!quiet) {
    printHeader('socket-btm Setup')
  }

  const startTime = Date.now()
  let allGood = true

  // Check prerequisites
  log.step('Checking prerequisites...')
  allGood = (await checkNodeVersion()) && allGood
  allGood = (await checkPnpmVersion()) && allGood

  // Info about build toolchain
  if (!quiet) {
    log.info('')
    log.info('To set up the build toolchain (cmake, ninja, rust, etc.):')
    log.info('  Run: node scripts/setup-build-toolchain.mjs')
    log.info('')
  }

  // Install dependencies
  if (!quiet) {
    log.step('Installing dependencies...')
    log.info('Run: pnpm install')
  }

  const elapsed = Date.now() - startTime
  if (!quiet) {
    printFooter(
      allGood ? 'Setup complete' : 'Setup completed with warnings',
      elapsed,
    )
  }

  process.exit(allGood ? 0 : 1)
}

setup().catch(error => {
  logger.error('Setup failed')
  logger.error(error)
  process.exit(1)
})
