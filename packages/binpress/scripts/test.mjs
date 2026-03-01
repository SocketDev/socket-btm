#!/usr/bin/env node
/**
 * Test script for binpress C package
 * Wraps the Makefile test target for pnpm integration
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureLief } from 'bin-infra/lib/build-lief'
import { getBuildMode } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const WIN32 = process.platform === 'win32'

async function runCommand(command, args, cwd) {
  logger.info(`Running: ${command} ${args.join(' ')}`)

  const result = await spawn(command, args, {
    cwd,
    stdio: 'inherit',
    shell: WIN32,
  })

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}`)
  }
}

/**
 * Select platform-specific Makefile.
 *
 * @returns {string} Makefile name
 */
function selectMakefile() {
  if (process.platform === 'linux') {
    return 'Makefile.linux'
  }
  if (process.platform === 'win32') {
    return 'Makefile.windows'
  }
  return 'Makefile.macos'
}

async function main() {
  try {
    // Check and install required tools (including runtime dependencies)
    logger.info('Checking required tools...\n')
    try {
      await runCommand(
        'node',
        [path.join(packageRoot, 'scripts', 'check-tools.mjs')],
        packageRoot,
      )
    } catch (checkError) {
      // If tool check fails in CI, skip tests gracefully
      if (process.env.CI) {
        logger.warn(
          'Tool check failed in CI environment (likely missing system dependencies)',
        )
        logger.warn(
          'Skipping tests - this is expected for packages requiring native build tools',
        )
        logger.info('')
        logger.success('Tests skipped (dependencies not available)')
        process.exitCode = 0
      }
      throw checkError
    }

    // Ensure LIEF library is available for tests
    logger.info('Ensuring LIEF library is available...\n')
    const buildMode = getBuildMode()
    await ensureLief({ buildMode })

    // Check if binary already exists (from checkpoint restoration)
    // Use prod in CI, dev locally
    const binaryBuildMode = process.env.CI ? 'prod' : 'dev'
    const binaryExt = process.platform === 'win32' ? '.exe' : ''
    const binaryPath = path.join(
      packageRoot,
      'build',
      binaryBuildMode,
      'out',
      'Final',
      `binpress${binaryExt}`,
    )

    const binaryExists = existsSync(binaryPath)
    if (binaryExists && !process.env.CI) {
      logger.info(
        'Binary already exists (restored from checkpoint), skipping build\n',
      )
    }

    // In CI, always rebuild to ensure embedded stubs are fresh (checkpoint may have stale stubs)
    const shouldBuild = !binaryExists || process.env.CI

    if (shouldBuild) {
      // Try to build (in case binary isn't built yet)
      if (process.env.CI && binaryExists) {
        logger.info(
          'Rebuilding binpress in CI to ensure fresh embedded stubs...\n',
        )
      } else {
        logger.info('Building binpress...\n')
      }
      try {
        const makefile = selectMakefile()
        await runCommand('make', ['-f', makefile, 'all'], packageRoot)
      } catch (buildError) {
        // If build fails in CI due to missing system dependencies, skip tests gracefully
        if (process.env.CI) {
          logger.warn(
            'Build failed in CI environment (likely missing system dependencies)',
          )
          logger.warn(
            'Skipping tests - this is expected for packages requiring native build tools',
          )
          logger.info('')
          logger.success('Tests skipped (build dependencies not available)')
          process.exitCode = 0
        }
        throw buildError
      }
    }

    logger.info('')
    logger.info('Running binpress tests...\n')
    const makefile = selectMakefile()
    await runCommand('make', ['-f', makefile, 'test'], packageRoot)
    logger.info('')
    logger.success('Tests passed!')
  } catch (error) {
    logger.info('')
    logger.fail(`Tests failed: ${error.message}`)
    process.exitCode = 1
  }
}

main()
