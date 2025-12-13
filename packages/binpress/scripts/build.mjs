#!/usr/bin/env node
/**
 * Build script for binpress C package
 * Wraps the Makefile build target for pnpm integration
 */

import { spawn as spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Determine build mode from environment or default to dev
const BUILD_MODE = process.env.BUILD_MODE || (process.env.CI ? 'prod' : 'dev')

const buildDir = path.join(packageRoot, 'build', BUILD_MODE)

const WIN32 = process.platform === 'win32'

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    logger.info(`Running: ${command} ${args.join(' ')}`)

    const proc = spawnSync(command, args, {
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

async function main() {
  try {
    // Check if build is needed
    const forceRebuild = process.argv.includes('--force')
    if (!(await shouldRun(buildDir, '', 'finalized', forceRebuild))) {
      logger.success('binpress already built (checkpoint exists)')
      return
    }

    logger.info('🔨 Building binpress...\n')

    // Check required build tools
    logger.info('Checking required build tools...')
    await runCommand(
      'node',
      [path.join(packageRoot, 'scripts', 'check-tools.mjs')],
      packageRoot,
    )
    logger.info('')

    // Select platform-specific Makefile
    let makefile = 'Makefile'
    if (process.platform === 'linux') {
      makefile = 'Makefile.linux'
    } else if (process.platform === 'win32') {
      makefile = 'Makefile.windows'
    }

    await runCommand('make', ['-f', makefile, 'all'], packageRoot)
    logger.info('')
    logger.success('Build completed successfully!')

    // Determine binary name based on platform
    const binaryName =
      process.platform === 'win32' ? 'binpress.exe' : 'binpress'
    const binaryPath = path.join(buildDir, 'out', binaryName)

    // Create checkpoint after successful build with smoke test
    if (existsSync(binaryPath)) {
      const binarySize = await getFileSize(binaryPath)
      await createCheckpoint(
        buildDir,
        'finalized',
        async () => {
          // Smoke test: verify binary exists and has reasonable size
          const stats = await fs.stat(binaryPath)
          if (stats.size < 1000) {
            throw new Error(
              `Binary too small: ${stats.size} bytes (expected >1KB)`,
            )
          }

          // Run --version to ensure binary is functional
          const result = await spawn(binaryPath, ['--version'])
          if (result.code !== 0) {
            throw new Error(
              `Binary --version check failed with exit code ${result.code}`,
            )
          }
          if (!result.stdout.includes('binpress')) {
            throw new Error(
              `Binary --version output missing 'binpress': ${result.stdout}`,
            )
          }

          logger.info('Binary validated')
        },
        {
          binarySize,
          binaryPath: path.relative(buildDir, binaryPath),
          artifactPath: path.join(buildDir, 'out'),
          checkpointChain: ['finalized'],
        },
      )
    }
  } catch (error) {
    logger.info('')
    logger.fail(`Build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
