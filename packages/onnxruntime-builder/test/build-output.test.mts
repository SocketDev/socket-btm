/**
 * @fileoverview Tests for onnxruntime-builder WASM output files.
 * Validates that the build process generates correct file structure and formats.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWasmTestHelpers } from 'build-infra/lib/test/helpers'
import { describe, expect, it } from 'vitest'

import { isObjectObject } from '@socketsecurity/lib/objects'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const wasmDir = path.join(packageDir, 'build/wasm')

// Create test helpers with ONNX Runtime specific configuration
const helpers = createWasmTestHelpers({
  exportName: 'ort',
  initFunctionName: 'ortWasmThreaded',
  sizeExpectations: {
    // > 10MB base64
    base64Min: 10_000_000,
    // < 30MB
    wasmMax: 30 * 1024 * 1024,
    // > 5MB
    wasmMin: 5 * 1024 * 1024,
  },
  wasmDir,
  wasmName: 'ort',
})

describe('onnxruntime-builder WASM output', () => {
  describe('directory structure', () => {
    it('should have wasm output directory', () => {
      helpers.testWasmDirectoryExists(expect)
    })
  })

  describe('required output files', () => {
    it('should generate ort.wasm (WASM binary)', () => {
      helpers.testWasmFileExists(expect)
    })

    it('should generate ort.mjs (ES6 module)', () => {
      helpers.testMjsFileExists(expect)
    })

    it('should generate ort-sync.js (synchronous CommonJS wrapper)', () => {
      helpers.testSyncJsFileExists(expect)
    })
  })

  describe('WASM binary validation', () => {
    it('ort.wasm should have valid WASM magic number', async () => {
      await helpers.testWasmMagicNumber(expect)
    })

    it('ort.wasm should be reasonably sized', async () => {
      await helpers.testWasmSize(expect)
    })
  })

  describe('ES6 module validation (ort.mjs)', () => {
    it('ort.mjs should be valid JavaScript', async () => {
      await helpers.testMjsContent(expect)
    })

    it('ort.mjs should contain Emscripten loader code', async () => {
      await helpers.testMjsEmscriptenLoader(expect)
    })

    it('ort.mjs should reference ONNX Runtime', async () => {
      const { mjsPath } = helpers.getPaths()
      if (helpers.skipIfNotBuilt(mjsPath)) {
        return
      }

      const { promises: fs } = await import('node:fs')
      const content = await fs.readFile(mjsPath, 'utf-8')
      // ONNX Runtime specific exports
      expect(content).toMatch(/ort|onnx/i)
    })
  })

  describe('synchronous wrapper validation (ort-sync.js)', () => {
    it('ort-sync.js should start with use strict', async () => {
      await helpers.testSyncJsUseStrict(expect)
    })

    it('ort-sync.js should contain base64-encoded WASM', async () => {
      await helpers.testSyncJsBase64Wasm(expect)
    })

    it('ort-sync.js should decode base64 to Uint8Array', async () => {
      await helpers.testSyncJsBase64Decode(expect)
    })

    it('ort-sync.js should contain inlined Emscripten loader', async () => {
      await helpers.testSyncJsEmscriptenLoader(expect)
    })

    it('ort-sync.js should use synchronous instantiateWasm', async () => {
      await helpers.testSyncJsInstantiateWasm(expect)
    })

    it('ort-sync.js should have CommonJS exports only', async () => {
      await helpers.testSyncJsCommonJSExports(expect)
    })

    it('ort-sync.js should NOT have top-level await', async () => {
      await helpers.testSyncJsNoTopLevelAwait(expect)
    })

    it('ort-sync.js can be required as CommonJS module', async () => {
      const _require = createRequire(import.meta.url)
      await helpers.testSyncJsRequirable(expect, _require)
    })

    it('loaded ort module should be an object', () => {
      const { syncJsPath } = helpers.getPaths()
      if (helpers.skipIfNotBuilt(syncJsPath)) {
        return
      }

      const _require = createRequire(import.meta.url)
      const ort = _require(syncJsPath)
      expect(isObjectObject(ort)).toBe(true)
    })
  })
})
