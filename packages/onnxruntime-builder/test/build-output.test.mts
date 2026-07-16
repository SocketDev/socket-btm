/**
 * @file Tests for onnxruntime-builder WASM output files. Validates that the
 *   build process generates correct file structure and formats.
 */

import { describe, expect, it } from 'vitest'

import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWasmTestHelpers } from 'build-infra/lib/test/helpers'

import { isObject } from '@socketsecurity/lib-stable/objects/predicates'

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

// Local expect-prefixed aliases so socket/no-vitest-empty-test recognizes
// these delegated helper calls as real assertions (the rule only trusts a
// callee literally named expect*/assert*; it cannot trace into a shared
// helper that receives `expect` as an argument).
const {
  testMjsContent: expectMjsContent,
  testMjsEmscriptenLoader: expectMjsEmscriptenLoader,
  testMjsFileExists: expectMjsFileExists,
  testSyncJsBase64Decode: expectSyncJsBase64Decode,
  testSyncJsBase64Wasm: expectSyncJsBase64Wasm,
  testSyncJsCommonJSExports: expectSyncJsCommonJSExports,
  testSyncJsEmscriptenLoader: expectSyncJsEmscriptenLoader,
  testSyncJsFileExists: expectSyncJsFileExists,
  testSyncJsInstantiateWasm: expectSyncJsInstantiateWasm,
  testSyncJsNoTopLevelAwait: expectSyncJsNoTopLevelAwait,
  testSyncJsRequirable: expectSyncJsRequirable,
  testSyncJsUseStrict: expectSyncJsUseStrict,
  testWasmDirectoryExists: expectWasmDirectoryExists,
  testWasmFileExists: expectWasmFileExists,
  testWasmMagicNumber: expectWasmMagicNumber,
  testWasmSize: expectWasmSize,
} = helpers

describe('onnxruntime-builder WASM output', () => {
  describe('directory structure', () => {
    it('should have wasm output directory', () => {
      expectWasmDirectoryExists(expect)
    })
  })

  describe('required output files', () => {
    it('should generate ort.wasm (WASM binary)', () => {
      expectWasmFileExists(expect)
    })

    it('should generate ort.mjs (ES6 module)', () => {
      expectMjsFileExists(expect)
    })

    it('should generate ort-sync.js (synchronous CommonJS wrapper)', () => {
      expectSyncJsFileExists(expect)
    })
  })

  describe('wASM binary validation', () => {
    it('ort.wasm should have valid WASM magic number', async () => {
      await expectWasmMagicNumber(expect)
    })

    it('ort.wasm should be reasonably sized', async () => {
      await expectWasmSize(expect)
    })
  })

  describe('eS6 module validation (ort.mjs)', () => {
    it('ort.mjs should be valid JavaScript', async () => {
      await expectMjsContent(expect)
    })

    it('ort.mjs should contain Emscripten loader code', async () => {
      await expectMjsEmscriptenLoader(expect)
    })

    it('ort.mjs should reference ONNX Runtime', async () => {
      const { mjsPath } = helpers.getPaths()
      if (helpers.skipIfNotBuilt(mjsPath)) {
        return
      }

      const content = await fs.readFile(mjsPath, 'utf8')
      // ONNX Runtime specific exports
      expect(content).toMatch(/ort|onnx/i)
    })
  })

  describe('synchronous wrapper validation (ort-sync.js)', () => {
    it('ort-sync.js should start with use strict', async () => {
      await expectSyncJsUseStrict(expect)
    })

    it('ort-sync.js should contain base64-encoded WASM', async () => {
      await expectSyncJsBase64Wasm(expect)
    })

    it('ort-sync.js should decode base64 to Uint8Array', async () => {
      await expectSyncJsBase64Decode(expect)
    })

    it('ort-sync.js should contain inlined Emscripten loader', async () => {
      await expectSyncJsEmscriptenLoader(expect)
    })

    it('ort-sync.js should use synchronous instantiateWasm', async () => {
      await expectSyncJsInstantiateWasm(expect)
    })

    it('ort-sync.js should have CommonJS exports only', async () => {
      await expectSyncJsCommonJSExports(expect)
    })

    it('ort-sync.js should NOT have top-level await', async () => {
      await expectSyncJsNoTopLevelAwait(expect)
    })

    it('ort-sync.js can be required as CommonJS module', async () => {
      const require = createRequire(import.meta.url)
      await expectSyncJsRequirable(expect, require)
    })

    it('loaded ort module should be an object', () => {
      const { syncJsPath } = helpers.getPaths()
      if (helpers.skipIfNotBuilt(syncJsPath)) {
        return
      }

      const require = createRequire(import.meta.url)
      const ort = require(syncJsPath)
      expect(isObject(ort)).toBeTruthy()
    })
  })
})
