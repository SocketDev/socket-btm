/**
 * @fileoverview Tests for yoga-layout-builder WASM output files.
 * Validates that the build process generates correct file structure and formats.
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createWasmTestHelpers } from 'build-infra/lib/test-helpers'
import { describe, expect, it } from 'vitest'

import { isObjectObject } from '@socketsecurity/lib/objects'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const wasmDir = path.join(packageDir, 'build/wasm')

// Create test helpers with Yoga Layout specific configuration
const helpers = createWasmTestHelpers({
  exportName: 'yoga',
  initFunctionName: 'Module',
  sizeExpectations: {
    // < 500KB
    wasmMax: 500 * 1024,
    // > 50KB
    wasmMin: 50 * 1024,
  },
  wasmDir,
  wasmName: 'yoga',
})

describe('yoga-layout-builder WASM output', () => {
  describe('directory structure', () => {
    it('should have wasm output directory', () => {
      helpers.testWasmDirectoryExists(expect)
    })
  })

  describe('required output files', () => {
    it('should generate yoga.wasm (WASM binary)', () => {
      helpers.testWasmFileExists(expect)
    })

    it('should generate yoga.mjs (ES6 module)', () => {
      helpers.testMjsFileExists(expect)
    })

    it('should generate yoga-sync.js (synchronous CommonJS wrapper)', () => {
      helpers.testSyncJsFileExists(expect)
    })
  })

  describe('WASM binary validation', () => {
    it('yoga.wasm should have valid WASM magic number', async () => {
      await helpers.testWasmMagicNumber(expect)
    })

    it('yoga.wasm should be reasonably sized', async () => {
      await helpers.testWasmSize(expect)
    })
  })

  describe('ES6 module validation (yoga.mjs)', () => {
    it('yoga.mjs should be valid JavaScript', async () => {
      await helpers.testMjsContent(expect)
    })

    it('yoga.mjs should contain Emscripten loader code', async () => {
      await helpers.testMjsEmscriptenLoader(expect)
    })

    it('yoga.mjs should NOT contain export statement (stripped by build)', async () => {
      const { mjsPath } = helpers.getPaths()
      if (helpers.skipIfNotBuilt(mjsPath)) {
        return
      }

      const { promises: fs } = await import('node:fs')
      const content = await fs.readFile(mjsPath, 'utf-8')
      // Build script strips the export statement for inlining
      expect(content).not.toMatch(/export\s+default/)
    })
  })

  describe('synchronous wrapper validation (yoga-sync.js)', () => {
    it('yoga-sync.js should start with use strict', async () => {
      await helpers.testSyncJsUseStrict(expect)
    })

    it('yoga-sync.js should contain base64-encoded WASM', async () => {
      await helpers.testSyncJsBase64Wasm(expect)
    })

    it('yoga-sync.js should decode base64 to Uint8Array', async () => {
      await helpers.testSyncJsBase64Decode(expect)
    })

    it('yoga-sync.js should contain inlined Emscripten loader', async () => {
      await helpers.testSyncJsEmscriptenLoader(expect)
    })

    it('yoga-sync.js should use synchronous instantiateWasm', async () => {
      await helpers.testSyncJsInstantiateWasm(expect)
    })

    it('yoga-sync.js should have CommonJS exports only', async () => {
      await helpers.testSyncJsCommonJSExports(expect)
    })

    it('yoga-sync.js should NOT have top-level await', async () => {
      await helpers.testSyncJsNoTopLevelAwait(expect)
    })

    it('yoga-sync.js can be required as CommonJS module', async () => {
      const _require = createRequire(import.meta.url)
      await helpers.testSyncJsRequirable(expect, _require)
    })

    it('loaded yoga module should be an object', () => {
      const { syncJsPath } = helpers.getPaths()
      if (helpers.skipIfNotBuilt(syncJsPath)) {
        return
      }

      const _require = createRequire(import.meta.url)
      const yoga = _require(syncJsPath)
      expect(isObjectObject(yoga)).toBe(true)
    })
  })
})
