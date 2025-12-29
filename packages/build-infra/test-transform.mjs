/**
 * Test WASM sync wrapper transformation without rebuilding
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { generateWasmSyncWrapper } from './wasm-synced/wasm-sync-wrapper.mjs'

const require = createRequire(import.meta.url)
const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Resolve paths relative to this package
const onnxBuildDir = path.resolve(
  __dirname,
  '../onnxruntime-builder/build/dev/out/Sync',
)

// Test ONNX transformation
await generateWasmSyncWrapper({
  wasmFile: path.join(onnxBuildDir, 'ort.wasm'),
  mjsFile: path.join(onnxBuildDir, 'ort.mjs'),
  outputSyncJs: path.join(onnxBuildDir, 'ort-sync.js'),
  packageName: 'onnxruntime',
  exportName: 'ort',
  initFunctionName: 'ortWasmThreaded',
  description:
    'Built with WASM threading + SIMD for synchronous instantiation.',
  logger,
})

console.log('\n✅ Transformation complete! Testing...')

// Try to load it
try {
  const ortPath = path.join(onnxBuildDir, 'ort-sync.js')
  const ort = require(ortPath)
  console.log('✅ Module loaded successfully')
  console.log('Module type:', typeof ort)
  console.log('Module value:', ort)
  if (ort) {
    console.log('✅ Module is synchronous (no await needed)')
    console.log('Keys:', Object.keys(ort).slice(0, 10))
    console.log('Has HEAP8:', typeof ort.HEAP8)
    console.log('Has wasmBinary:', typeof ort.wasmBinary)
  } else {
    console.log('❌ Module is null/undefined')
  }
} catch (e) {
  console.error('❌ Failed:', e.message)
  console.error(e.stack)
}
