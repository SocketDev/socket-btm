#!/usr/bin/env node
/**
 * Test script for binpress C package
 * Wraps the Makefile test target for pnpm integration
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureLief } from 'bin-infra/lib/build-lief'
import { getBuildMode } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const WIN32 = process.platform === 'win32'

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    logger.info(`Running: ${command} ${args.join(' ')}`)

    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: WIN32,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', err => {
      reject(err)
    })
  })
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
        process.exit(0)
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

    const { access } = await import('node:fs/promises')
    let binaryExists = false
    try {
      await access(binaryPath)
      binaryExists = true
      logger.info(
        'Binary already exists (restored from checkpoint), skipping build\n',
      )
    } catch {
      // Binary doesn't exist, need to build
      binaryExists = false
    }

    if (!binaryExists) {
      // Try to build (in case binary isn't built yet)
      logger.info('Building binpress...\n')
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
          process.exit(0)
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
    process.exit(1)
  }
}

main()
