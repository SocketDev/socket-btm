/**
 * Test script to verify that generated sync wrappers can be loaded in CommonJS
 */

import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const _require = createRequire(import.meta.url)

async function testSyncWrapper(packageName, syncJsPath, executionTest) {
  console.log(`\nTesting ${packageName} sync wrapper...`)
  console.log(`Path: ${syncJsPath}`)

  if (!existsSync(syncJsPath)) {
    console.error(`❌ File not found: ${syncJsPath}`)
    return false
  }

  console.log('✓ File exists')

  try {
    // Try to require the sync wrapper
    const syncModulePromise = _require(syncJsPath)

    if (!syncModulePromise) {
      console.error('❌ Module loaded but is null/undefined')
      return false
    }

    console.log('✓ Module loaded successfully')
    console.log(`  Type: ${typeof syncModulePromise}`)
    console.log(`  Constructor: ${syncModulePromise.constructor?.name}`)

    // Await the promise to get the actual module
    console.log('✓ Awaiting module initialization...')
    const syncModule = await syncModulePromise

    if (typeof syncModule === 'object') {
      const keys = Object.keys(syncModule).slice(0, 10)
      console.log(`  Keys (first 10): ${keys.join(', ')}`)
    }

    // Run execution test if provided
    if (executionTest) {
      console.log('✓ Running execution test...')
      executionTest(syncModule)
      console.log('✓ Execution test passed')
    }

    return true
  } catch (e) {
    console.error('❌ Failed to load/execute module:')
    console.error(`  Error: ${e.message}`)
    console.error(`  Stack: ${e.stack}`)
    return false
  }
}

// Test paths
const yogaSyncPath = path.join(
  __dirname,
  '../yoga-layout-builder/build/dev/out/Sync/yoga-sync.js',
)
const onnxSyncPath = path.join(
  __dirname,
  '../onnxruntime-builder/build/dev/out/Sync/ort-sync.js',
)

;(async () => {
  console.log('='.repeat(60))
  console.log('Testing WASM Sync Wrappers')
  console.log('='.repeat(60))

  const yogaResult = await testSyncWrapper(
    'yoga-layout',
    yogaSyncPath,
    yoga => {
      // Test basic Yoga functionality - using low-level YogaNode API
      if (typeof yoga.YogaNode !== 'function') {
        throw new Error('yoga.YogaNode is not a function')
      }

      const node = new yoga.YogaNode()
      node.setWidth(100)
      node.setHeight(100)

      // Note: Computed values may be NaN without proper layout calculation
      // The key test is that the module loads and methods execute without error
      console.log('  ✓ Yoga YogaNode created and configured successfully')
    },
  )

  const onnxResult = await testSyncWrapper('onnxruntime', onnxSyncPath, ort => {
    // Test basic ONNX Runtime functionality - low-level Emscripten API
    // The module exposes WASM memory views and low-level functions
    if (typeof ort.HEAP8 === 'undefined') {
      throw new Error('ort.HEAP8 is not defined')
    }

    if (typeof ort.wasmBinary === 'undefined') {
      throw new Error('ort.wasmBinary is not defined')
    }

    // Verify basic memory access works
    if (!ort.HEAP8 || !ort.HEAPU8) {
      throw new Error('Memory views not available')
    }

    console.log('  ✓ ONNX Runtime WASM module loaded with memory views')
  })

  console.log(`\n${'='.repeat(60)}`)
  console.log('Results:')
  console.log(`  Yoga: ${yogaResult ? '✅ PASS' : '❌ FAIL'}`)
  console.log(`  ONNX: ${onnxResult ? '✅ PASS' : '❌ FAIL'}`)
  console.log('='.repeat(60))

  if (!yogaResult || !onnxResult) {
    throw new Error('Some sync wrappers failed to load or execute')
  }
})()
