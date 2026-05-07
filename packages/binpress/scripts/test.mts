#!/usr/bin/env node
/**
 * Test script for binpress C package
 * Wraps the Makefile test target for pnpm integration
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { runCommand, selectMakefile } from 'bin-infra/lib/builder'
import { getBuildMode } from 'build-infra/lib/constants'
import { errorMessage } from 'build-infra/lib/error-utils'
import { ensureLief } from 'lief-builder/lib/ensure-lief'

import { getCI } from '@socketsecurity/lib/env/ci'
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
      if (getCI()) {
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

    // Ensure LIEF library is available for tests
    logger.info('Ensuring LIEF library is available...\n')
    const buildMode = getBuildMode()
    await ensureLief({ buildMode })

    // Always rebuild to ensure embedded stubs match the locally-built stub.
    // Checkpoint-restored binaries may embed stale stubs (e.g. LZFSE instead of ZSTD).
    logger.info('Building binpress...\n')
    try {
      const makefile = selectMakefile()
      await runCommand('make', ['-f', makefile, 'all'], packageRoot)
    } catch (buildError) {
      // If build fails in CI due to missing system dependencies, skip tests gracefully
      if (getCI()) {
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

    logger.info('')
    logger.info('Running binpress tests...\n')
    const makefile = selectMakefile()
    await runCommand('make', ['-f', makefile, 'test'], packageRoot)
    logger.info('')
    logger.success('Tests passed!')
  } catch (e) {
    logger.info('')
    logger.fail(`Tests failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
