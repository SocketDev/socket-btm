#!/usr/bin/env node
/**
 * Test the wasm-sync-wrapper generation with the fixes
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { generateWasmSyncWrapper } from './wasm-synced/wasm-sync-wrapper.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

// Test ONNX Runtime
const wasmFile = path.join(
  __dirname,
  '../onnxruntime-builder/build/dev/wasm/ort.wasm',
)
const mjsFile = path.join(
  __dirname,
  '../onnxruntime-builder/build/dev/wasm/ort.mjs',
)
const outputSyncJs = path.join(
  __dirname,
  '../onnxruntime-builder/build/dev/out/Sync-test2/ort-sync.js',
)

logger.step('Testing WASM Sync Wrapper Generation')

if (!existsSync(wasmFile)) {
  logger.error(`WASM file not found: ${wasmFile}`)
  throw new Error(`WASM file not found: ${wasmFile}`)
}

if (!existsSync(mjsFile)) {
  logger.error(`MJS file not found: ${mjsFile}`)
  throw new Error(`MJS file not found: ${mjsFile}`)
}

logger.info(`WASM file: ${wasmFile}`)
logger.info(`MJS file: ${mjsFile}`)
logger.info(`Output: ${outputSyncJs}`)

try {
  await generateWasmSyncWrapper({
    wasmFile,
    mjsFile,
    outputSyncJs,
    packageName: 'onnxruntime',
    initFunctionName: 'ortWasmThreaded',
    exportName: 'ort',
    description:
      'Built with WASM threading + SIMD for synchronous instantiation.',
    logger,
    customSmokeTest: async (syncJsFilePath, logger) => {
      // Just check file exists
      if (!existsSync(syncJsFilePath)) {
        throw new Error('Sync JS file not found')
      }
      logger.substep('Sync JS file generated')
    },
  })

  logger.success('✅ Generation successful!')
  logger.info('')
  logger.info('Now testing if it can be loaded...')

  // Try to require it
  const { createRequire } = await import('node:module')
  const _require = createRequire(import.meta.url)

  try {
    const syncModule = _require(outputSyncJs)
    logger.success('✅ Module loaded successfully!')
    logger.info(`Module type: ${typeof syncModule}`)
    if (typeof syncModule === 'object') {
      const keys = Object.keys(syncModule).slice(0, 10)
      logger.info(`Keys (first 10): ${keys.join(', ')}`)
    }
  } catch (e) {
    logger.error('❌ Failed to load module:')
    logger.error(`  Error: ${e.message}`)
    logger.error(`  Stack: ${e.stack}`)
    throw e
  }
} catch (e) {
  logger.error('❌ Generation failed:')
  logger.error(`  Error: ${e.message}`)
  logger.error(`  Stack: ${e.stack}`)
  throw e
}

logger.success('All tests passed!')
