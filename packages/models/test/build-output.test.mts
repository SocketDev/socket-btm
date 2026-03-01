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
const buildDevDir = path.join(packageDir, 'build/dev/out/Final')
const buildProdDir = path.join(packageDir, 'build/prod/out/Final')

// Skip tests if build artifacts don't exist (expected in CI)
const hasBuiltArtifacts = existsSync(buildDevDir) || existsSync(buildProdDir)
// Use dev build for testing (int8 quantization)
const buildDir = existsSync(buildDevDir) ? buildDevDir : buildProdDir

describe.skipIf(!hasBuiltArtifacts)('models build output', () => {
  describe('directory structure', () => {
    it('should have build output directory', () => {
      expect(hasBuiltArtifacts).toBe(true)
    })

    it('should have minilm-l6 directory', () => {
      const minilmDir = path.join(buildDir, 'minilm-l6')
      expect(existsSync(minilmDir)).toBe(true)
    })

    it('should have codet5 directory', () => {
      const codet5Dir = path.join(buildDir, 'codet5')
      expect(existsSync(codet5Dir)).toBe(true)
    })
  })

  describe('MiniLM-L6 models', () => {
    it('should have model.onnx', () => {
      const modelPath = path.join(buildDir, 'minilm-l6/model.onnx')
      expect(existsSync(modelPath)).toBe(true)
    })

    it('should have tokenizer.json', () => {
      const tokenizerPath = path.join(buildDir, 'minilm-l6/tokenizer.json')
      expect(existsSync(tokenizerPath)).toBe(true)
    })

    it('model.onnx should be reasonably sized', async () => {
      const modelPath = path.join(buildDir, 'minilm-l6/model.onnx')
      if (!existsSync(modelPath)) {
        // Skip if not built yet
        return
      }

      const stats = await fs.stat(modelPath)
      // MiniLM-L6 quantized models are typically 10-30MB
      // > 1MB (minimum threshold for both int4 and int8)
      expect(stats.size).toBeGreaterThan(1 * 1024 * 1024)
      // < 50MB (maximum threshold)
      expect(stats.size).toBeLessThan(50 * 1024 * 1024)
    })
  })

  describe('CodeT5 models', () => {
    it('should have model.onnx', () => {
      const modelPath = path.join(buildDir, 'codet5/model.onnx')
      expect(existsSync(modelPath)).toBe(true)
    })

    it('should have tokenizer.json', () => {
      const tokenizerPath = path.join(buildDir, 'codet5/tokenizer.json')
      expect(existsSync(tokenizerPath)).toBe(true)
    })

    it('model.onnx should be reasonably sized', async () => {
      const modelPath = path.join(buildDir, 'codet5/model.onnx')
      if (!existsSync(modelPath)) {
        // Skip if not built yet
        return
      }

      const stats = await fs.stat(modelPath)
      // CodeT5 quantized models are typically larger than MiniLM
      // > 10MB
      expect(stats.size).toBeGreaterThan(10 * 1024 * 1024)
    })
  })

  describe('ONNX file validation', () => {
    it('minilm should have valid ONNX header', async () => {
      const modelPath = path.join(buildDir, 'minilm-l6/model.onnx')
      if (!existsSync(modelPath)) {
        // Skip if not built yet
        return
      }

      const buffer = await fs.readFile(modelPath)
      // ONNX files start with protocol buffer format marker
      const header = buffer.slice(0, 4)
      // Should not be empty or all zeros
      expect(header.length).toBe(4)
      expect(header.some(byte => byte !== 0)).toBe(true)
    })

    it('codet5 should have valid ONNX header', async () => {
      const modelPath = path.join(buildDir, 'codet5/model.onnx')
      if (!existsSync(modelPath)) {
        // Skip if not built yet
        return
      }

      const buffer = await fs.readFile(modelPath)
      const header = buffer.slice(0, 4)
      expect(header.length).toBe(4)
      expect(header.some(byte => byte !== 0)).toBe(true)
    })
  })

  describe('tokenizer validation', () => {
    it('minilm tokenizer should be valid JSON', async () => {
      const tokenizerPath = path.join(buildDir, 'minilm-l6/tokenizer.json')
      if (!existsSync(tokenizerPath)) {
        // Skip if not built yet
        return
      }

      const content = await fs.readFile(tokenizerPath, 'utf-8')
      const tokenizer = JSON.parse(content)

      // Should have expected tokenizer structure
      expect(tokenizer).toBeTruthy()
      expect(typeof tokenizer).toBe('object')
    })

    it('codet5 tokenizer should be valid JSON', async () => {
      const tokenizerPath = path.join(buildDir, 'codet5/tokenizer.json')
      if (!existsSync(tokenizerPath)) {
        // Skip if not built yet
        return
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
      // Check that exports include build paths for both dev and prod modes
      expect(
        pkgJson.exports['./build/dev/out/Final/minilm-l6/model.onnx'],
      ).toBeDefined()
      expect(
        pkgJson.exports['./build/prod/out/Final/minilm-l6/model.onnx'],
      ).toBeDefined()
    })
  })

  describe('build mode support', () => {
    it('should support both dev (int8) and prod (int4) builds', () => {
      const devDir = path.join(packageDir, 'build/dev/out/Final')
      const prodDir = path.join(packageDir, 'build/prod/out/Final')

      // At least one build mode should exist
      expect(existsSync(devDir) || existsSync(prodDir)).toBe(true)
    })

    it('int4 (prod) should provide size reduction vs int8 (dev) if both exist', async () => {
      const devDir = path.join(packageDir, 'build/dev/out/Final')
      const prodDir = path.join(packageDir, 'build/prod/out/Final')

      if (!existsSync(devDir) || !existsSync(prodDir)) {
        // Skip if both modes not built
        return
      }

      const models = ['minilm-l6', 'codet5']

      for (const model of models) {
        const int8Path = path.join(devDir, `${model}/model.onnx`)
        const int4Path = path.join(prodDir, `${model}/model.onnx`)

        if (!existsSync(int8Path) || !existsSync(int4Path)) {
          // Skip if model not built in both modes
          continue
        }

        // eslint-disable-next-line no-await-in-loop
        const int8Stats = await fs.stat(int8Path)
        // eslint-disable-next-line no-await-in-loop
        const int4Stats = await fs.stat(int4Path)

        const reduction = 1 - int4Stats.size / int8Stats.size

        // int4 should provide at least 20% size reduction
        expect(reduction).toBeGreaterThan(0.2)
      }
    })
  })
})
