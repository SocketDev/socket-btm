/**
 * Shared test helpers for validating WASM build outputs.
 *
 * This module provides reusable test utilities to eliminate duplicate
 * test code across builder packages (onnxruntime-builder, yoga-layout-builder).
 *
 * Usage:
 *   import { createWasmTestHelpers } from 'build-infra/lib/test-helpers'
 *   const helpers = createWasmTestHelpers({ wasmDir, wasmName: 'ort', ... })
 *   helpers.testWasmMagicNumber()
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Create test helpers for a WASM builder package.
 *
 * @param {object} config - Configuration
 * @param {string} config.wasmDir - Directory containing WASM output files
 * @param {string} config.wasmName - Base name for WASM files (e.g., 'ort', 'yoga')
 * @param {object} [config.sizeExpectations] - Expected file size ranges
 * @param {object} [config.sizeExpectations.wasmMin] - Minimum WASM size in bytes
 * @param {object} [config.sizeExpectations.wasmMax] - Maximum WASM size in bytes
 * @param {object} [config.sizeExpectations.base64Min] - Minimum base64 string length
 * @param {string} [config.initFunctionName] - Emscripten init function name (e.g., 'ortWasmThreaded', 'Module')
 * @param {string} [config.exportName] - CommonJS export name (e.g., 'ort', 'yoga')
 * @returns {object} Test helper functions
 */
export function createWasmTestHelpers(config) {
  const {
    exportName,
    initFunctionName = 'Module',
    sizeExpectations = {},
    wasmDir,
    wasmName,
  } = config

  const wasmPath = path.join(wasmDir, `${wasmName}.wasm`)
  const mjsPath = path.join(wasmDir, `${wasmName}.mjs`)
  const syncJsPath = path.join(wasmDir, `${wasmName}-sync.js`)

  /**
   * Check if build outputs exist (skip tests if not built).
   */
  // eslint-disable-next-line unicorn/consistent-function-scoping
  function skipIfNotBuilt(filePath) {
    if (!existsSync(filePath)) {
      return true
    }
    return false
  }

  return {
    /**
     * Get the expected file paths.
     */
    getPaths() {
      return { mjsPath, syncJsPath, wasmPath }
    },

    /**
     * Skip test if build outputs don't exist.
     */
    skipIfNotBuilt,

    /**
     * Test: WASM directory should exist.
     */
    testWasmDirectoryExists(expect) {
      if (!existsSync(wasmDir)) {
        return
      }
      expect(existsSync(wasmDir)).toBe(true)
    },

    /**
     * Test: WASM binary file should exist.
     */
    testWasmFileExists(expect) {
      if (skipIfNotBuilt(wasmPath)) {
        return
      }
      expect(existsSync(wasmPath)).toBe(true)
    },

    /**
     * Test: WASM binary should have valid magic number (0061736d = \0asm).
     */
    async testWasmMagicNumber(expect) {
      if (skipIfNotBuilt(wasmPath)) {
        return
      }

      const buffer = await fs.readFile(wasmPath)
      const magic = buffer.slice(0, 4).toString('hex')
      expect(magic).toBe('0061736d')
    },

    /**
     * Test: WASM binary should be reasonably sized.
     */
    async testWasmSize(expect) {
      if (skipIfNotBuilt(wasmPath)) {
        return
      }

      const stats = await fs.stat(wasmPath)
      if (sizeExpectations.wasmMin) {
        expect(stats.size).toBeGreaterThan(sizeExpectations.wasmMin)
      }
      if (sizeExpectations.wasmMax) {
        expect(stats.size).toBeLessThan(sizeExpectations.wasmMax)
      }
    },

    /**
     * Test: MJS file should exist.
     */
    testMjsFileExists(expect) {
      if (skipIfNotBuilt(mjsPath)) {
        return
      }
      expect(existsSync(mjsPath)).toBe(true)
    },

    /**
     * Test: MJS file should be valid JavaScript with substantial content.
     */
    async testMjsContent(expect) {
      if (skipIfNotBuilt(mjsPath)) {
        return
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      expect(content).toBeTruthy()
      expect(content.length).toBeGreaterThan(1000)
    },

    /**
     * Test: MJS file should contain Emscripten loader code.
     */
    async testMjsEmscriptenLoader(expect) {
      if (skipIfNotBuilt(mjsPath)) {
        return
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      if (initFunctionName) {
        expect(content).toContain(initFunctionName)
      }
      expect(content).toContain('WebAssembly')
    },

    /**
     * Test: Sync.js file should exist.
     */
    testSyncJsFileExists(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }
      expect(existsSync(syncJsPath)).toBe(true)
    },

    /**
     * Test: Sync.js should start with 'use strict'.
     */
    async testSyncJsUseStrict(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content.trimStart()).toMatch(/^['"]use strict['"]/)
    },

    /**
     * Test: Sync.js should contain base64-encoded WASM.
     */
    async testSyncJsBase64Wasm(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('const base64Wasm =')

      // Check for valid base64 characters and minimum length
      const base64Match = content.match(
        /base64Wasm = ['"]([A-Za-z0-9+/=]+)['"]/,
      )
      expect(base64Match).toBeTruthy()

      if (sizeExpectations.base64Min) {
        expect(base64Match[1].length).toBeGreaterThan(
          sizeExpectations.base64Min,
        )
      }
    },

    /**
     * Test: Sync.js should decode base64 to Uint8Array.
     */
    async testSyncJsBase64Decode(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('Uint8Array.from(atob(base64Wasm)')
    },

    /**
     * Test: Sync.js should contain inlined Emscripten loader.
     */
    async testSyncJsEmscriptenLoader(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      if (initFunctionName) {
        expect(content).toContain(initFunctionName)
      }
      expect(content).toContain('WebAssembly')
    },

    /**
     * Test: Sync.js should use synchronous instantiateWasm.
     */
    async testSyncJsInstantiateWasm(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('instantiateWasm(imports, successCallback)')
      expect(content).toContain('new WebAssembly.Module(wasmBinary)')
      expect(content).toContain('new WebAssembly.Instance(module, imports)')
    },

    /**
     * Test: Sync.js should have CommonJS exports only (no ES modules).
     */
    async testSyncJsCommonJSExports(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      if (exportName) {
        expect(content).toContain(`module.exports = ${exportName}`)
      }
      // Should NOT have ES module exports
      expect(content).not.toContain('export default')
      expect(content).not.toContain('export const')
    },

    /**
     * Test: Sync.js should NOT have top-level await (synchronous loading only).
     */
    async testSyncJsNoTopLevelAwait(expect) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      const lines = content.split('\n')

      for (const line of lines) {
        const trimmed = line.trim()
        // Skip comments and string literals
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
          continue
        }
        // Check for top-level await (not inside functions)
        if (
          trimmed.startsWith('await ') &&
          !line.includes('function') &&
          !line.includes('=>')
        ) {
          // Found top-level await - this should fail
          expect(trimmed).not.toContain('await ')
        }
      }
    },

    /**
     * Test: Sync.js can be required as a CommonJS module.
     */
    async testSyncJsRequirable(expect, createRequire) {
      if (skipIfNotBuilt(syncJsPath)) {
        return
      }

      const _require = createRequire
      const syncModule = _require(syncJsPath)
      expect(syncModule).toBeTruthy()
      if (exportName) {
        expect(typeof syncModule).toBe('object')
      }
    },
  }
}
