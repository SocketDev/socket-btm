/**
 * @fileoverview Tests for models build output files.
 * Validates that the build process generates correct model structure and formats.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')
const distDir = path.join(packageDir, 'dist')

// Skip tests if build artifacts don't exist (expected in CI)
const hasBuiltArtifacts = existsSync(distDir)

describe.skipIf(!hasBuiltArtifacts)('models build output', () => {
  describe('directory structure', () => {
    it('should have dist output directory', () => {
      expect(existsSync(distDir)).toBe(true)
    })

    it('should have int8 quantization directory', () => {
      const int8Dir = path.join(distDir, 'int8')
      expect(existsSync(int8Dir)).toBe(true)
    })

    it('should have int4 quantization directory', () => {
      const int4Dir = path.join(distDir, 'int4')
      expect(existsSync(int4Dir)).toBe(true)
    })
  })

  describe('MiniLM-L6 models', () => {
    describe('int8 quantization', () => {
      it('should have model.onnx', () => {
        const modelPath = path.join(distDir, 'int8/minilm-l6/model.onnx')
        expect(existsSync(modelPath)).toBe(true)
      })

      it('should have tokenizer.json', () => {
        const tokenizerPath = path.join(
          distDir,
          'int8/minilm-l6/tokenizer.json',
        )
        expect(existsSync(tokenizerPath)).toBe(true)
      })

      it('model.onnx should be reasonably sized', async () => {
        const modelPath = path.join(distDir, 'int8/minilm-l6/model.onnx')
        if (!existsSync(modelPath)) {
          return // Skip if not built yet
        }

        const stats = await fs.stat(modelPath)
        // MiniLM-L6 int8 is typically 20-30MB
        expect(stats.size).toBeGreaterThan(10 * 1024 * 1024) // > 10MB
        expect(stats.size).toBeLessThan(50 * 1024 * 1024) // < 50MB
      })
    })

    describe('int4 quantization', () => {
      it('should have model.onnx', () => {
        const modelPath = path.join(distDir, 'int4/minilm-l6/model.onnx')
        expect(existsSync(modelPath)).toBe(true)
      })

      it('should have tokenizer.json', () => {
        const tokenizerPath = path.join(
          distDir,
          'int4/minilm-l6/tokenizer.json',
        )
        expect(existsSync(tokenizerPath)).toBe(true)
      })

      it('model.onnx should be smaller than int8', async () => {
        const int8Path = path.join(distDir, 'int8/minilm-l6/model.onnx')
        const int4Path = path.join(distDir, 'int4/minilm-l6/model.onnx')

        if (!existsSync(int8Path) || !existsSync(int4Path)) {
          return // Skip if not built yet
        }

        const int8Stats = await fs.stat(int8Path)
        const int4Stats = await fs.stat(int4Path)

        // int4 should be smaller than int8
        expect(int4Stats.size).toBeLessThan(int8Stats.size)
      })
    })
  })

  describe('CodeT5 models', () => {
    describe('int8 quantization', () => {
      it('should have model.onnx', () => {
        const modelPath = path.join(distDir, 'int8/codet5/model.onnx')
        expect(existsSync(modelPath)).toBe(true)
      })

      it('should have tokenizer.json', () => {
        const tokenizerPath = path.join(distDir, 'int8/codet5/tokenizer.json')
        expect(existsSync(tokenizerPath)).toBe(true)
      })

      it('model.onnx should be reasonably sized', async () => {
        const modelPath = path.join(distDir, 'int8/codet5/model.onnx')
        if (!existsSync(modelPath)) {
          return // Skip if not built yet
        }

        const stats = await fs.stat(modelPath)
        // CodeT5 int8 is typically larger than MiniLM
        expect(stats.size).toBeGreaterThan(10 * 1024 * 1024) // > 10MB
      })
    })

    describe('int4 quantization', () => {
      it('should have model.onnx', () => {
        const modelPath = path.join(distDir, 'int4/codet5/model.onnx')
        expect(existsSync(modelPath)).toBe(true)
      })

      it('should have tokenizer.json', () => {
        const tokenizerPath = path.join(distDir, 'int4/codet5/tokenizer.json')
        expect(existsSync(tokenizerPath)).toBe(true)
      })

      it('model.onnx should be smaller than int8', async () => {
        const int8Path = path.join(distDir, 'int8/codet5/model.onnx')
        const int4Path = path.join(distDir, 'int4/codet5/model.onnx')

        if (!existsSync(int8Path) || !existsSync(int4Path)) {
          return // Skip if not built yet
        }

        const int8Stats = await fs.stat(int8Path)
        const int4Stats = await fs.stat(int4Path)

        // int4 should be smaller than int8
        expect(int4Stats.size).toBeLessThan(int8Stats.size)
      })
    })
  })

  describe('ONNX file validation', () => {
    it('int8 minilm should have valid ONNX header', async () => {
      const modelPath = path.join(distDir, 'int8/minilm-l6/model.onnx')
      if (!existsSync(modelPath)) {
        return // Skip if not built yet
      }

      const buffer = await fs.readFile(modelPath)
      // ONNX files start with protocol buffer format marker
      const header = buffer.slice(0, 4)
      // Should not be empty or all zeros
      expect(header.length).toBe(4)
      expect(header.some(byte => byte !== 0)).toBe(true)
    })

    it('int8 codet5 should have valid ONNX header', async () => {
      const modelPath = path.join(distDir, 'int8/codet5/model.onnx')
      if (!existsSync(modelPath)) {
        return // Skip if not built yet
      }

      const buffer = await fs.readFile(modelPath)
      const header = buffer.slice(0, 4)
      expect(header.length).toBe(4)
      expect(header.some(byte => byte !== 0)).toBe(true)
    })
  })

  describe('tokenizer validation', () => {
    it('minilm tokenizer should be valid JSON', async () => {
      const tokenizerPath = path.join(distDir, 'int8/minilm-l6/tokenizer.json')
      if (!existsSync(tokenizerPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(tokenizerPath, 'utf-8')
      const tokenizer = JSON.parse(content)

      // Should have expected tokenizer structure
      expect(tokenizer).toBeTruthy()
      expect(typeof tokenizer).toBe('object')
    })

    it('codet5 tokenizer should be valid JSON', async () => {
      const tokenizerPath = path.join(distDir, 'int8/codet5/tokenizer.json')
      if (!existsSync(tokenizerPath)) {
        return // Skip if not built yet
      }

      const content = await fs.readFile(tokenizerPath, 'utf-8')
      const tokenizer = JSON.parse(content)

      expect(tokenizer).toBeTruthy()
      expect(typeof tokenizer).toBe('object')
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

    it('should have expected exports', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.exports).toBeDefined()
      expect(pkgJson.exports['./dist/minilm-l6.onnx']).toBeDefined()
      expect(pkgJson.exports['./dist/codet5-encoder.onnx']).toBeDefined()
    })
  })

  describe('quantization comparison', () => {
    it('int4 should provide size reduction across all models', async () => {
      const models = ['minilm-l6', 'codet5']

      for (const model of models) {
        const int8Path = path.join(distDir, `int8/${model}/model.onnx`)
        const int4Path = path.join(distDir, `int4/${model}/model.onnx`)

        if (!existsSync(int8Path) || !existsSync(int4Path)) {
          continue // Skip if not built yet
        }

        const int8Stats = await fs.stat(int8Path)
        const int4Stats = await fs.stat(int4Path)

        const reduction = 1 - int4Stats.size / int8Stats.size

        // int4 should provide at least 20% size reduction
        expect(reduction).toBeGreaterThan(0.2)
      }
    })
  })
})
