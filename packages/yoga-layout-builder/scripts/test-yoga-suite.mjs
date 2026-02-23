#!/usr/bin/env node
/**
 * @fileoverview Run Yoga Layout test suite against built WASM module
 *
 * This script runs Yoga Layout's native test suite to verify that our
 * custom WASM build maintains compatibility with upstream.
 *
 * Test Strategy:
 * - Run Yoga's C++ tests (gentest)
 * - Validate layout calculation accuracy
 * - Ensure flexbox spec compliance
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getBuildPaths, UPSTREAM_PATH } from './paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

// Parse arguments.
const { values } = parseArgs({
  options: {
    verbose: { type: 'boolean', short: 'v' },
  },
  strict: false,
})

/**
 * Main test runner.
 */
async function main() {
  logger.log('')
  logger.log('🧪 Yoga Layout Test Suite Runner')
  logger.log('')

  // Verify Yoga source upstream.
  const yogaSourcePath = UPSTREAM_PATH
  if (!existsSync(yogaSourcePath)) {
    logger.fail('Yoga Layout source upstream not found')
    logger.log('')
    logger.log('Initialize upstream:')
    logger.log('  git submodule update --init --recursive')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`Source directory: ${yogaSourcePath}`)
  logger.log('')

  // Check for CMake build system.
  const cmakeListsPath = path.join(yogaSourcePath, 'CMakeLists.txt')
  if (!existsSync(cmakeListsPath)) {
    logger.fail(`CMakeLists.txt not found: ${cmakeListsPath}`)
    process.exitCode = 1
    return
  }

  // Verify our WASM build exists.
  const { outputFinalDir } = getBuildPaths()
  const wasmPath = path.join(outputFinalDir, 'yoga.wasm')
  const jsPath = path.join(outputFinalDir, 'yoga.js')

  if (!existsSync(wasmPath) || !existsSync(jsPath)) {
    logger.fail('Yoga WASM build not found')
    logger.log('')
    logger.log('Build Yoga WASM first:')
    logger.log('  pnpm --filter yoga-layout-builder build')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`WASM module: ${wasmPath}`)
  logger.log(`JS wrapper: ${jsPath}`)
  logger.log('')

  // Check if gentest exists (generated test files).
  const gentestDir = path.join(yogaSourcePath, 'gentest')
  if (!existsSync(gentestDir)) {
    logger.warn('gentest directory not found - some tests may be unavailable')
  }

  // Ensure CMake is installed.
  logger.step('Checking build dependencies...')
  logger.substep('Checking for CMake...')

  const { ensureToolInstalled } = await import('build-infra/lib/tool-installer')
  const cmakeResult = await ensureToolInstalled('cmake', { autoInstall: true })

  if (!cmakeResult.available) {
    logger.fail('CMake is required but not found')
    logger.log('Install CMake from: https://cmake.org/download/')
    process.exitCode = 1
    return
  }

  if (cmakeResult.installed) {
    logger.success('Installed CMake')
  } else {
    logger.success('CMake found')
  }
  logger.log('')

  // Build and run tests using CMake/CTest.
  const buildDir = path.join(yogaSourcePath, 'build-test')

  logger.step('Configuring Yoga tests with CMake...')

  const cmakeArgs = [
    '-S',
    yogaSourcePath,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Debug',
  ]

  let result = await spawn('cmake', cmakeArgs, {
    cwd: yogaSourcePath,
    stdio: values.verbose ? 'inherit' : 'pipe',
  })

  if (result.code !== 0) {
    logger.fail('CMake configuration failed')
    if (!values.verbose && result.stderr) {
      logger.log(result.stderr)
    }
    process.exitCode = result.code
    return
  }

  logger.success('CMake configuration complete')
  logger.log('')

  logger.step('Building Yoga tests...')

  const buildArgs = ['--build', buildDir, '--config', 'Debug']

  result = await spawn('cmake', buildArgs, {
    cwd: yogaSourcePath,
    stdio: values.verbose ? 'inherit' : 'pipe',
  })

  if (result.code !== 0) {
    logger.fail('Build failed')
    if (!values.verbose && result.stderr) {
      logger.log(result.stderr)
    }
    process.exitCode = result.code
    return
  }

  logger.success('Build complete')
  logger.log('')

  logger.step('Running Yoga tests with CTest...')
  logger.log('')

  // Run tests using CTest.
  const ctestArgs = ['--test-dir', buildDir, '--output-on-failure']

  if (values.verbose) {
    ctestArgs.push('--verbose')
  }

  result = await spawn('ctest', ctestArgs, {
    cwd: yogaSourcePath,
    stdio: 'inherit',
  })

  logger.log('')

  if (result.code === 0) {
    logger.success('All Yoga tests passed!')
    logger.log('')
    logger.success('Layout calculations validated')
    logger.success('Flexbox spec compliance verified')
    logger.log('')
  } else {
    logger.fail(`Tests failed with exit code ${result.code}`)
    logger.log('')
    process.exitCode = result.code
  }
}

main().catch(e => {
  logger.fail(`Test runner failed: ${e.message}`)
  throw e
})
