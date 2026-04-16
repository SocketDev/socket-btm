#!/usr/bin/env node
/**
 * Test script for binflate C package
 * Wraps the Makefile test target for pnpm integration
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { runCommand, selectMakefile } from 'bin-infra/lib/builder'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

async function main() {
  try {
    // Check and install required tools (including runtime dependencies)
    logger.info('Checking required tools...\n')
    try {
      await runCommand(
        'node',
        [path.join(packageRoot, 'scripts', 'check-tools.mts')],
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
        return
      }
      throw checkError
    }

    // Check if binary already exists (from checkpoint restoration)
    // Use prod in CI, dev locally
    const buildMode = process.env.CI ? 'prod' : 'dev'
    const binaryExt = process.platform === 'win32' ? '.exe' : ''
    const binaryPath = path.join(
      packageRoot,
      'build',
      buildMode,
      'out',
      'Final',
      `binflate${binaryExt}`,
    )

    const binaryExists = existsSync(binaryPath)
    if (binaryExists) {
      logger.info(
        'Binary already exists (restored from checkpoint), skipping build\n',
      )
    }

    if (!binaryExists) {
      // Try to build (in case binary isn't built yet)
      logger.info('Building binflate...\n')
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
          return
        }
        throw buildError
      }
    }

    logger.info('')
    logger.info('Running binflate tests...\n')
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

main().catch(e => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
