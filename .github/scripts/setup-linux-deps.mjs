#!/usr/bin/env node
/**
 * Install platform-specific build dependencies for binject.
 * - Windows: MinGW/gcc, CMake, make
 * - Linux/macOS: No additional dependencies (LZFSE compiled from submodule)
 */

import { platform } from 'node:os'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const currentPlatform = platform()
const isWindows = currentPlatform === 'win32'

async function runCommand(command, args, shellMode = false) {
  const result = await spawn(command, args, {
    stdio: 'inherit',
    shell: shellMode,
  })

  if (result.code !== 0) {
    throw new Error(`${command} exited with code ${result.code}`)
  }
}

async function setupWindows() {
  logger.info('Installing Windows build dependencies (MinGW/gcc, CMake)...')

  // Install MinGW for consistent ABI with LIEF library.
  // Using gcc/g++ avoids ABI mismatch issues with LIEF.
  await runCommand('choco', ['install', '-y', 'mingw'], true)

  // Install CMake (required for LIEF build).
  await runCommand('choco', ['install', '-y', 'cmake', '--installargs', 'ADD_CMAKE_TO_PATH=System'], true)

  // Verify installations.
  await runCommand('gcc', ['--version'], true)
  await runCommand('g++', ['--version'], true)
  await runCommand('cmake', ['--version'], true)

  // Ensure make is available.
  logger.info('Checking for make...')
  try {
    await runCommand('where', ['make'], true)
    logger.success('make is available')
  } catch {
    logger.info('Installing make...')
    await runCommand('choco', ['install', '-y', 'make'], true)
  }

  logger.success('Windows build tools configured')
  logger.log('  Installed: gcc/g++ (MinGW), CMake, make')
}

async function main() {
  try {
    if (isWindows) {
      await setupWindows()
    } else {
      logger.info(`No additional dependencies needed for ${currentPlatform}`)
    }
    process.exit(0)
  } catch (error) {
    logger.fail(`Failed to install dependencies: ${error?.message || 'Unknown error'}`)
    process.exit(1)
  }
}

main()
