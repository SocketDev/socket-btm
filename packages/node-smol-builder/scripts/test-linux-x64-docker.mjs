#!/usr/bin/env node
/**
 * @fileoverview Test linux-x64 Docker build integration.
 *
 * This script:
 * 1. Builds node-smol, binject, binpress, and stubs in Docker (linux-x64)
 * 2. Runs integration tests to verify:
 *    - node-smol extraction to ~/.socket/_dlx/<hash>/node
 *    - Basic execution (--version, --eval)
 *    - SEA creation with binject
 *    - Repacking without errors
 *
 * Usage:
 *   node scripts/test-linux-x64-docker.mjs [options]
 *
 * Options:
 *   --glibc     Use glibc Dockerfile (default)
 *   --musl      Use musl Dockerfile
 *   --dev       Build in dev mode (default)
 *   --prod      Build in prod mode
 *   --depot     Use depot for faster builds (default if available)
 *   --docker    Use docker buildx (slower but always available)
 */

import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(__dirname, '..')
const rootDir = path.resolve(packageDir, '../..')

// Parse command line arguments
const args = process.argv.slice(2)
const useMusl = args.includes('--musl')
const useProd = args.includes('--prod')
const forceDocker = args.includes('--docker')

const libc = useMusl ? 'musl' : 'glibc'
const buildMode = useProd ? 'prod' : 'dev'

logger.info(`Testing linux-x64 Docker build (${libc}, ${buildMode} mode)`)

// Check if depot is available
const depotAvailable = !forceDocker && existsSync('/usr/local/bin/depot')
const buildTool = depotAvailable ? 'depot' : 'docker'

if (buildTool === 'depot') {
  logger.info('Using depot for faster builds')
} else {
  logger.info('Using docker buildx (depot not available or --docker flag used)')
}

// Determine Dockerfile
const dockerfile = path.join(packageDir, 'docker', `Dockerfile.${libc}`)

if (!existsSync(dockerfile)) {
  throw new Error(`Dockerfile not found: ${dockerfile}`)
}

logger.info(`Using Dockerfile: ${dockerfile}`)

/**
 * Build in Docker and extract artifacts.
 */
async function buildInDocker() {
  logger.info('Building node-smol in Docker...')

  const buildArgs = [
    '--build-arg',
    `BUILD_MODE=${buildMode}`,
    '--build-arg',
    'TARGETARCH=amd64',
    '--build-arg',
    'MATRIX_PLATFORM=linux',
    '--build-arg',
    'MATRIX_ARCH=x64',
    '--platform',
    'linux/amd64',
    '--output',
    path.join(packageDir, 'build'),
  ]

  let result
  if (buildTool === 'depot') {
    result = await spawn(
      'depot',
      ['build', '-f', dockerfile, ...buildArgs, rootDir],
      { cwd: rootDir },
    )
  } else {
    result = await spawn(
      'docker',
      ['buildx', 'build', '-f', dockerfile, ...buildArgs, rootDir],
      { cwd: rootDir },
    )
  }

  if (result.code !== 0) {
    logger.error('Docker build failed')
    logger.error(result.stderr)
    throw new Error('Docker build failed')
  }

  logger.info('Docker build completed successfully')
}

/**
 * Run integration tests.
 */
async function runTests() {
  logger.info('Running linux-x64 Docker integration tests...')

  // Check if binary exists
  const binaryPath = path.join(
    packageDir,
    'build',
    buildMode,
    'out',
    'Final',
    'node',
  )

  if (!existsSync(binaryPath)) {
    logger.error(`Binary not found: ${binaryPath}`)
    logger.error('Run the build step first')
    throw new Error('Binary not found')
  }

  logger.info(`Binary found: ${binaryPath}`)

  // Run vitest with the specific test file
  const testFile = 'test/integration/linux-x64-docker.test.mjs'
  const result = await spawn('pnpm', ['vitest', 'run', testFile], {
    cwd: packageDir,
  })

  if (result.code !== 0) {
    logger.error('Tests failed')
    throw new Error('Tests failed')
  }

  logger.info('All tests passed!')
}

/**
 * Main execution.
 */
async function main() {
  try {
    // Note: Only build if on Linux or if using Docker/depot
    // On macOS/Windows, we can only test if binary already exists from CI
    if (
      os.platform() === 'linux' ||
      buildTool === 'depot' ||
      buildTool === 'docker'
    ) {
      await buildInDocker()
    } else {
      logger.warn('Skipping build on non-Linux platform without Docker')
      logger.info('Checking if binary exists from previous build...')
    }

    await runTests()
  } catch (error) {
    logger.error('Error:', error.message)
    process.exitCode = 1
  }
}

main()
