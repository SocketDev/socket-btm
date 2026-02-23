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

import childProcess from 'node:child_process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { printFooter } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()
const quiet = process.argv.includes('--quiet')

const log = {
  error: msg => logger.error(msg),
  info: msg => !quiet && logger.info(msg),
  step: msg => !quiet && logger.substep(msg),
  success: msg => !quiet && logger.success(msg),
  warn: msg => logger.warn(msg),
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
    const result = childProcess.spawnSync('pnpm', ['--version'], {
      encoding: 'utf8',
      shell: WIN32,
    })
    if (result.status !== 0) {
      throw new Error('pnpm command failed')
    }
    const version = result.stdout.trim()
    log.success(`pnpm ${version} (required: >=${required})`)
    return true
  } catch {
    log.error(`pnpm not found (required: >=${required})`)
    log.info('Install from: https://pnpm.io/installation')
    return false
  }
}

async function checkBuildToolchain() {
  const tools = [
    { name: 'cmake', command: 'cmake --version' },
    { name: 'ninja', command: 'ninja --version' },
    { name: 'python3', command: 'python3 --version' },
    { name: 'cargo', command: 'cargo --version' },
  ]

  const missing = []
  const found = []

  for (const tool of tools) {
    try {
      // Split command into program and arguments
      const [cmd, ...args] = tool.command.split(' ')
      const result = childProcess.spawnSync(cmd, args, {
        encoding: 'utf8',
        stdio: 'ignore',
        shell: WIN32,
      })
      if (result.status === 0) {
        found.push(tool.name)
      } else {
        missing.push(tool.name)
      }
    } catch {
      missing.push(tool.name)
    }
  }

  if (found.length > 0) {
    log.success(`Build tools found: ${found.join(', ')}`)
  }

  if (missing.length > 0) {
    log.warn(`Build tools missing: ${missing.join(', ')}`)
    log.info('Run to install: node scripts/setup-build-toolchain.mjs')
    return false
  }

  return true
}

async function setup() {
  if (!quiet) {
    logger.step('socket-btm Setup')
  }

  const startTime = Date.now()
  let allGood = true

  // Check prerequisites
  log.step('Checking prerequisites...')
  allGood = (await checkNodeVersion()) && allGood
  allGood = (await checkPnpmVersion()) && allGood

  // Check build toolchain
  log.step('Checking build toolchain...')
  const toolchainOk = await checkBuildToolchain()
  allGood = toolchainOk && allGood

  if (!toolchainOk && !quiet) {
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

  process.exitCode = allGood ? 0 : 1
}

setup().catch(error => {
  logger.error('Setup failed')
  logger.error(error)
  process.exitCode = 1
})
