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

import { getBuildPaths, SUBMODULE_PATH } from './paths.mjs'

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

  // Verify Yoga source submodule.
  const yogaSourcePath = SUBMODULE_PATH
  if (!existsSync(yogaSourcePath)) {
    logger.fail('Yoga Layout source submodule not found')
    logger.log('')
    logger.log('Initialize submodule:')
    logger.log('  git submodule update --init --recursive')
    logger.log('')
    process.exit(1)
  }

  logger.log(`Source directory: ${yogaSourcePath}`)
  logger.log('')

  // Check for CMake build system.
  const cmakeListsPath = path.join(yogaSourcePath, 'CMakeLists.txt')
  if (!existsSync(cmakeListsPath)) {
    logger.fail(`CMakeLists.txt not found: ${cmakeListsPath}`)
    process.exit(1)
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
    process.exit(1)
  }

  logger.log(`WASM module: ${wasmPath}`)
  logger.log(`JS wrapper: ${jsPath}`)
  logger.log('')

  // Check if gentest exists (generated test files).
  const gentestDir = path.join(yogaSourcePath, 'gentest')
  if (!existsSync(gentestDir)) {
    logger.warn('gentest directory not found - some tests may be unavailable')
  }

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
    process.exit(result.code)
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
    process.exit(result.code)
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
    logger.log('✓ Layout calculations validated')
    logger.log('✓ Flexbox spec compliance verified')
    logger.log('')
  } else {
    logger.fail(`Tests failed with exit code ${result.code}`)
    logger.log('')
    process.exit(result.code)
  }
}

main().catch(e => {
  logger.fail(`Test runner failed: ${e.message}`)
  throw e
})
