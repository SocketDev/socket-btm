/**
 * @fileoverview Tests for onnxruntime-builder WASM output files.
 * Validates that the build process generates correct file structure and formats.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const wasmDir = path.join(packageDir, 'build/wasm')

describe('onnxruntime-builder WASM output', () => {
  describe('directory structure', () => {
    it('should have wasm output directory', () => {
      expect(existsSync(wasmDir)).toBe(true)
    })
  })

  describe('required output files', () => {
    it('should generate ort.wasm (WASM binary)', () => {
      const wasmPath = path.join(wasmDir, 'ort.wasm')
      expect(existsSync(wasmPath)).toBe(true)
    })

    it('should generate ort.mjs (ES6 module)', () => {
      const mjsPath = path.join(wasmDir, 'ort.mjs')
      expect(existsSync(mjsPath)).toBe(true)
    })

    it('should generate ort-sync.js (synchronous CommonJS wrapper)', () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      expect(existsSync(syncJsPath)).toBe(true)
    })
  })

  describe('WASM binary validation', () => {
    it('ort.wasm should have valid WASM magic number', async () => {
      const wasmPath = path.join(wasmDir, 'ort.wasm')
      if (!existsSync(wasmPath)) {
        return // Skip if not built yet
      }

      const buffer = await fs.readFile(wasmPath)
      const magic = buffer.slice(0, 4).toString('hex')
      expect(magic).toBe('0061736d') // \0asm
    })

    it('ort.wasm should be reasonably sized', async () => {
      const wasmPath = path.join(wasmDir, 'ort.wasm')
      if (!existsSync(wasmPath)) {
        return // Skip if not built yet
      }

      const stats = await fs.stat(wasmPath)
      // ONNX Runtime WASM is typically 10-20MB
      expect(stats.size).toBeGreaterThan(5 * 1024 * 1024) // > 5MB
      expect(stats.size).toBeLessThan(30 * 1024 * 1024) // < 30MB
    })
  })

  describe('ES6 module validation (ort.mjs)', () => {
    it('ort.mjs should be valid JavaScript', async () => {
      const mjsPath = path.join(wasmDir, 'ort.mjs')
      if (!existsSync(mjsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      expect(content).toBeTruthy()
      expect(content.length).toBeGreaterThan(1000)
    })

    it('ort.mjs should contain Emscripten loader code', async () => {
      const mjsPath = path.join(wasmDir, 'ort.mjs')
      if (!existsSync(mjsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      // Should contain Emscripten-generated code patterns
      expect(content).toContain('ortWasmThreaded')
      expect(content).toContain('WebAssembly')
    })

    it('ort.mjs should reference ONNX Runtime', async () => {
      const mjsPath = path.join(wasmDir, 'ort.mjs')
      if (!existsSync(mjsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      // ONNX Runtime specific exports
      expect(content).toMatch(/ort|onnx/i)
    })
  })

  describe('synchronous wrapper validation (ort-sync.js)', () => {
    it('ort-sync.js should start with use strict', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content.trimStart()).toMatch(/^['"]use strict['"]/)
    })

    it('ort-sync.js should contain base64-encoded WASM', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('const base64Wasm =')
      // Check that base64 contains typical base64 characters and is substantial
      const base64Match = content.match(
        /base64Wasm = ['"]([A-Za-z0-9+/=]+)['"]/,
      )
      expect(base64Match).toBeTruthy()
      // ONNX Runtime WASM is large, base64 should be several MB (>10MB characters)
      expect(base64Match[1].length).toBeGreaterThan(10_000_000)
    })

    it('ort-sync.js should decode base64 to Uint8Array', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('Uint8Array.from(atob(base64Wasm)')
    })

    it('ort-sync.js should contain inlined Emscripten loader', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('ortWasmThreaded')
      expect(content).toContain('WebAssembly')
    })

    it('ort-sync.js should use synchronous instantiateWasm', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('instantiateWasm(imports, successCallback)')
      expect(content).toContain('new WebAssembly.Module(wasmBinary)')
      expect(content).toContain('new WebAssembly.Instance(module, imports)')
    })

    it('ort-sync.js should have CommonJS exports', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('module.exports = ort')
      expect(content).toContain('module.exports.default')
      expect(content).toContain('module.exports.InferenceSession')
      expect(content).toContain('module.exports.Tensor')
    })

    it('ort-sync.js should have ES module exports', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('export default ort')
      expect(content).toContain('export const InferenceSession')
      expect(content).toContain('export const Tensor')
    })

    it('ort-sync.js should contain build metadata', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('AUTO-GENERATED by onnxruntime-builder')
      expect(content).toContain('Source: ort.mjs')
      expect(content).toContain('WASM:')
      expect(content).toContain('bytes')
      expect(content).toContain('threading + SIMD')
    })

    it('ort-sync.js should initialize synchronously', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      // Should use synchronous instantiateWasm (not async/await at top level)
      expect(content).toContain('instantiateWasm')
      expect(content).not.toContain('await Module(')
      expect(content).not.toContain('await ortWasmThreaded(')
    })
  })

  describe('file size relationships', () => {
    it('ort-sync.js should be larger than .mjs (contains embedded WASM)', async () => {
      const mjsPath = path.join(wasmDir, 'ort.mjs')
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')

      if (!existsSync(mjsPath) || !existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const mjsStats = await fs.stat(mjsPath)
      const syncJsStats = await fs.stat(syncJsPath)

      // Sync JS contains MJS + base64 WASM, should be significantly larger
      expect(syncJsStats.size).toBeGreaterThan(mjsStats.size * 10)
    })

    it('ort.wasm size should match base64 decoded size', async () => {
      const wasmPath = path.join(wasmDir, 'ort.wasm')
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')

      if (!existsSync(wasmPath) || !existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const wasmStats = await fs.stat(wasmPath)
      const syncJsContent = await fs.readFile(syncJsPath, 'utf-8')

      // Extract base64 WASM length from metadata comment
      const match = syncJsContent.match(/WASM: (\d+) bytes/)
      if (match) {
        const embeddedWasmSize = Number.parseInt(match[1], 10)
        expect(embeddedWasmSize).toBe(wasmStats.size)
      }
    })

    it('ort-sync.js should be larger than 10MB', async () => {
      const syncJsPath = path.join(wasmDir, 'ort-sync.js')

      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const stats = await fs.stat(syncJsPath)
      // ONNX Runtime with embedded WASM should be 15-25MB
      expect(stats.size).toBeGreaterThan(10 * 1024 * 1024) // > 10MB
    })
  })

  describe('package.json configuration', () => {
    it('should have test script configured', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts.test).toBeDefined()
    })

    it('should be marked as private', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.private).toBe(true)
    })
  })
})
