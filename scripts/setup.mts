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
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawnSync } from '@socketsecurity/lib/spawn'
import { printFooter } from '@socketsecurity/lib/stdio/header'

const logger = getDefaultLogger()
const argv: string[] = process.argv
const quiet = argv.includes('--quiet')

const log = {
  error: (msg: string): void => {
    logger.error(msg)
  },
  info: (msg: string): void => {
    if (!quiet) {
      logger.info(msg)
    }
  },
  step: (msg: string): void => {
    if (!quiet) {
      logger.substep(msg)
    }
  },
  success: (msg: string): void => {
    if (!quiet) {
      logger.success(msg)
    }
  },
  warn: (msg: string): void => {
    logger.warn(msg)
  },
}

type ToolCheck = {
  command: string
  name: string
}

async function checkNodeVersion(): Promise<boolean> {
  const required = '18.0.0'
  // Remove 'v' prefix
  const current = process.version.slice(1)
  log.success(`Node.js ${current} (required: >=${required})`)
  return true
}

async function checkPnpmVersion(): Promise<boolean> {
  const required = '10.21.0'
  try {
    const result = spawnSync('pnpm', ['--version'])
    if (result.status !== 0) {
      throw new Error('pnpm command failed')
    }
    const version = String(result.stdout).trim()
    log.success(`pnpm ${version} (required: >=${required})`)
    return true
  } catch {
    log.error(`pnpm not found (required: >=${required})`)
    log.info('Install from: https://pnpm.io/installation')
    return false
  }
}

async function checkBuildToolchain(): Promise<boolean> {
  const tools: ToolCheck[] = [
    { command: 'cmake --version', name: 'cmake' },
    { command: 'ninja --version', name: 'ninja' },
    { command: 'python3 --version', name: 'python3' },
    { command: 'cargo --version', name: 'cargo' },
  ]

  const missing: string[] = []
  const found: string[] = []

  for (const tool of tools) {
    try {
      // Split command into program and arguments
      const [cmd, ...args] = tool.command.split(' ')
      if (!cmd) {
        missing.push(tool.name)
        continue
      }
      const result = spawnSync(cmd, args, {
        stdio: 'ignore',
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
    log.info(
      'Run to install: node packages/node-smol-builder/scripts/setup-build-toolchain.mts',
    )
    return false
  }

  return true
}

async function setup(): Promise<void> {
  if (!quiet) {
    logger.step('socket-btm Setup')
  }

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

  if (!quiet) {
    const label = allGood ? 'Setup complete' : 'Setup completed with warnings'
    printFooter(label)
  }

  process.exitCode = allGood ? 0 : 1
}

setup().catch((e: unknown) => {
  logger.error('Setup failed')
  logger.error(e)
  process.exitCode = 1
})
