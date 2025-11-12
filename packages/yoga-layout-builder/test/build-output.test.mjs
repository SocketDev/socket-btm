/**
 * @fileoverview Tests for yoga-layout-builder WASM output files.
 * Validates that the build process generates correct file structure and formats.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const wasmDir = path.join(packageDir, 'build/wasm')

describe('yoga-layout-builder WASM output', () => {
  describe('directory structure', () => {
    it('should have wasm output directory', () => {
      expect(existsSync(wasmDir)).toBe(true)
    })
  })

  describe('required output files', () => {
    it('should generate yoga.wasm (WASM binary)', () => {
      const wasmPath = path.join(wasmDir, 'yoga.wasm')
      expect(existsSync(wasmPath)).toBe(true)
    })

    it('should generate yoga.mjs (ES6 module)', () => {
      const mjsPath = path.join(wasmDir, 'yoga.mjs')
      expect(existsSync(mjsPath)).toBe(true)
    })

    it('should generate yoga-sync.js (synchronous CommonJS wrapper)', () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      expect(existsSync(syncJsPath)).toBe(true)
    })
  })

  describe('WASM binary validation', () => {
    it('yoga.wasm should have valid WASM magic number', async () => {
      const wasmPath = path.join(wasmDir, 'yoga.wasm')
      if (!existsSync(wasmPath)) {
        return // Skip if not built yet
      }

      const buffer = await fs.readFile(wasmPath)
      const magic = buffer.slice(0, 4).toString('hex')
      expect(magic).toBe('0061736d') // \0asm
    })

    it('yoga.wasm should be reasonably sized', async () => {
      const wasmPath = path.join(wasmDir, 'yoga.wasm')
      if (!existsSync(wasmPath)) {
        return // Skip if not built yet
      }

      const stats = await fs.stat(wasmPath)
      // Yoga WASM is typically 100-200KB
      expect(stats.size).toBeGreaterThan(50 * 1024) // > 50KB
      expect(stats.size).toBeLessThan(500 * 1024) // < 500KB
    })
  })

  describe('ES6 module validation (yoga.mjs)', () => {
    it('yoga.mjs should be valid JavaScript', async () => {
      const mjsPath = path.join(wasmDir, 'yoga.mjs')
      if (!existsSync(mjsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      expect(content).toBeTruthy()
      expect(content.length).toBeGreaterThan(1000)
    })

    it('yoga.mjs should contain Emscripten loader code', async () => {
      const mjsPath = path.join(wasmDir, 'yoga.mjs')
      if (!existsSync(mjsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      // Should contain Emscripten-generated code patterns
      expect(content).toContain('Module')
      expect(content).toContain('WebAssembly')
    })

    it('yoga.mjs should NOT contain export statement (stripped by build)', async () => {
      const mjsPath = path.join(wasmDir, 'yoga.mjs')
      if (!existsSync(mjsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(mjsPath, 'utf-8')
      // Build script strips the export statement for inlining
      expect(content).not.toMatch(/export\s+default/)
    })
  })

  describe('synchronous wrapper validation (yoga-sync.js)', () => {
    it('yoga-sync.js should start with use strict', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content.trimStart()).toMatch(/^['"]use strict['"]/)
    })

    it('yoga-sync.js should contain base64-encoded WASM', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('const base64Wasm =')
      expect(content).toMatch(/base64Wasm = ['"][A-Za-z0-9+/=]{1000,}['"]/)
    })

    it('yoga-sync.js should decode base64 to Uint8Array', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('Uint8Array.from(atob(base64Wasm)')
    })

    it('yoga-sync.js should contain inlined Emscripten loader', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('Module')
      expect(content).toContain('WebAssembly')
    })

    it('yoga-sync.js should use synchronous instantiateWasm', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('instantiateWasm(imports, successCallback)')
      expect(content).toContain('new WebAssembly.Module(wasmBinary)')
      expect(content).toContain('new WebAssembly.Instance(module, imports)')
    })

    it('yoga-sync.js should have CommonJS exports', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('module.exports')
      expect(content).toContain('module.exports.default')
    })

    it('yoga-sync.js should have ES module exports', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('export default yoga')
    })

    it('yoga-sync.js should contain build metadata', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
      if (!existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(syncJsPath, 'utf-8')
      expect(content).toContain('AUTO-GENERATED by yoga-layout-builder')
      expect(content).toContain('Source: yoga.mjs')
      expect(content).toContain('WASM:')
      expect(content).toContain('bytes')
    })

    it('yoga-sync.js should initialize synchronously', async () => {
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')
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
    it('yoga-sync.js should be larger than yoga.mjs (contains embedded WASM)', async () => {
      const mjsPath = path.join(wasmDir, 'yoga.mjs')
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')

      if (!existsSync(mjsPath) || !existsSync(syncJsPath)) {
        return // Skip if not built yet
      }

      const mjsStats = await fs.stat(mjsPath)
      const syncJsStats = await fs.stat(syncJsPath)

      // Sync JS contains MJS + base64 WASM, should be significantly larger
      expect(syncJsStats.size).toBeGreaterThan(mjsStats.size * 5)
    })

    it('yoga.wasm size should match base64 decoded size in yoga-sync.js', async () => {
      const wasmPath = path.join(wasmDir, 'yoga.wasm')
      const syncJsPath = path.join(wasmDir, 'yoga-sync.js')

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
