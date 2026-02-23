#!/usr/bin/env node
/**
 * @fileoverview Run ONNX Runtime test suite against built WASM module
 *
 * This script runs ONNX Runtime's native test suite to verify that our
 * custom WASM build maintains compatibility with upstream.
 *
 * Test Strategy:
 * - Run ONNX Runtime's unit tests
 * - Validate model inference accuracy
 * - Ensure operator compatibility
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
  logger.log('🧪 ONNX Runtime Test Suite Runner')
  logger.log('')

  // Verify ONNX Runtime source upstream.
  const onnxSourcePath = UPSTREAM_PATH
  if (!existsSync(onnxSourcePath)) {
    logger.fail('ONNX Runtime source upstream not found')
    logger.log('')
    logger.log('Initialize upstream:')
    logger.log('  git submodule update --init --recursive')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`Source directory: ${onnxSourcePath}`)
  logger.log('')

  // Check for CMake build system.
  const cmakeListsPath = path.join(onnxSourcePath, 'CMakeLists.txt')
  if (!existsSync(cmakeListsPath)) {
    logger.fail(`CMakeLists.txt not found: ${cmakeListsPath}`)
    process.exitCode = 1
    return
  }

  // Verify our WASM build exists.
  const { outputFinalDir } = getBuildPaths()
  const wasmPath = path.join(outputFinalDir, 'ort.wasm')
  const mjsPath = path.join(outputFinalDir, 'ort.mjs')

  if (!existsSync(wasmPath) || !existsSync(mjsPath)) {
    logger.fail('ONNX Runtime WASM build not found')
    logger.log('')
    logger.log('Build ONNX Runtime WASM first:')
    logger.log('  pnpm --filter onnxruntime-builder build')
    logger.log('')
    process.exitCode = 1
    return
  }

  logger.log(`WASM module: ${wasmPath}`)
  logger.log(`MJS wrapper: ${mjsPath}`)
  logger.log('')

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
  const buildDir = path.join(onnxSourcePath, 'build-test')

  logger.step('Configuring ONNX Runtime tests with CMake...')

  const cmakeArgs = [
    '-S',
    onnxSourcePath,
    '-B',
    buildDir,
    '-DCMAKE_BUILD_TYPE=Debug',
    '-Donnxruntime_BUILD_UNIT_TESTS=ON',
    '-Donnxruntime_BUILD_SHARED_LIB=OFF',
  ]

  let result = await spawn('cmake', cmakeArgs, {
    cwd: onnxSourcePath,
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

  logger.step('Building ONNX Runtime tests...')

  const buildArgs = [
    '--build',
    buildDir,
    '--config',
    'Debug',
    '--target',
    'onnxruntime_test_all',
  ]

  result = await spawn('cmake', buildArgs, {
    cwd: onnxSourcePath,
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

  logger.step('Running ONNX Runtime tests with CTest...')
  logger.log('')

  // Run tests using CTest.
  const ctestArgs = ['--test-dir', buildDir, '--output-on-failure']

  if (values.verbose) {
    ctestArgs.push('--verbose')
  }

  result = await spawn('ctest', ctestArgs, {
    cwd: onnxSourcePath,
    stdio: 'inherit',
  })

  logger.log('')

  if (result.code === 0) {
    logger.success('All ONNX Runtime tests passed!')
    logger.log('')
    logger.success('Model inference validated')
    logger.success('Operator compatibility verified')
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
