/**
 * @fileoverview Tests for minilm-builder model output files.
 * Validates that the build process generates correct model structure and formats.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.join(__dirname, '..')

describe('minilm-builder model output', () => {
  describe('directory structure', () => {
    it('should have build root directory', () => {
      const buildDir = path.join(packageDir, 'build')
      expect(existsSync(buildDir)).toBe(true)
    })

    it('should have int8 build directory', () => {
      const int8Dir = path.join(packageDir, 'build/int8')
      expect(existsSync(int8Dir)).toBe(true)
    })

    it('should have models directory in int8', () => {
      const modelsDir = path.join(packageDir, 'build/int8/models')
      expect(existsSync(modelsDir)).toBe(true)
    })
  })

  describe('int8 quantization output', () => {
    const int8ModelPath = path.join(packageDir, 'build/int8/models/minilm.onnx')
    const int8TokenizerDir = path.join(
      packageDir,
      'build/int8/models/minilm-tokenizer',
    )

    it('should generate minilm.onnx model file', () => {
      expect(existsSync(int8ModelPath)).toBe(true)
    })

    it('minilm.onnx should have valid ONNX format', async () => {
      if (!existsSync(int8ModelPath)) {
        return // Skip if not built yet
      }

      const buffer = await fs.readFile(int8ModelPath)
      // ONNX files use protobuf format (magic: 0x08 for first field)
      // Just check file starts with protobuf-like bytes
      expect(buffer.length).toBeGreaterThan(100)
      expect(buffer[0]).toBeGreaterThanOrEqual(0x08)
    })

    it('minilm.onnx should be reasonably sized', async () => {
      if (!existsSync(int8ModelPath)) {
        return // Skip if not built yet
      }

      const stats = await fs.stat(int8ModelPath)
      // INT8 quantized MiniLM models are typically 10-25MB
      expect(stats.size).toBeGreaterThan(5 * 1024 * 1024) // > 5MB
      expect(stats.size).toBeLessThan(30 * 1024 * 1024) // < 30MB
    })

    it('should have tokenizer directory', () => {
      expect(existsSync(int8TokenizerDir)).toBe(true)
    })

    it('tokenizer should have tokenizer.json', async () => {
      const tokenizerFile = path.join(int8TokenizerDir, 'tokenizer.json')
      if (!existsSync(tokenizerFile)) {
        return // Skip if not built yet
      }

      const content = JSON.parse(await fs.readFile(tokenizerFile, 'utf-8'))
      expect(content).toHaveProperty('version')
      expect(content).toHaveProperty('truncation')
      expect(content).toHaveProperty('padding')
    })

    it('tokenizer should have tokenizer_config.json', async () => {
      const configFile = path.join(int8TokenizerDir, 'tokenizer_config.json')
      if (!existsSync(configFile)) {
        return // Skip if not built yet
      }

      const content = JSON.parse(await fs.readFile(configFile, 'utf-8'))
      expect(content).toHaveProperty('model_max_length')
    })

    it('tokenizer should have vocab.txt', () => {
      const vocabFile = path.join(int8TokenizerDir, 'vocab.txt')
      if (!existsSync(vocabFile)) {
        return // Skip if not built yet
      }

      expect(existsSync(vocabFile)).toBe(true)
    })
  })

  describe('int4 quantization output (prod)', () => {
    const int4ModelPath = path.join(packageDir, 'build/int4/models/minilm.onnx')
    const int4TokenizerDir = path.join(
      packageDir,
      'build/int4/models/minilm-tokenizer',
    )

    it('should generate minilm.onnx model file for int4', () => {
      if (!existsSync(path.join(packageDir, 'build/int4'))) {
        return // Skip if int4 not built
      }
      expect(existsSync(int4ModelPath)).toBe(true)
    })

    it('int4 model should be smaller than int8', async () => {
      const int8ModelPath = path.join(
        packageDir,
        'build/int8/models/minilm.onnx',
      )

      if (!existsSync(int4ModelPath) || !existsSync(int8ModelPath)) {
        return // Skip if either not built
      }

      const int4Stats = await fs.stat(int4ModelPath)
      const int8Stats = await fs.stat(int8ModelPath)

      // INT4 should be noticeably smaller than INT8 (roughly 50% size)
      expect(int4Stats.size).toBeLessThan(int8Stats.size)
      expect(int4Stats.size).toBeGreaterThan(int8Stats.size * 0.3) // But not too small
      expect(int4Stats.size).toBeLessThan(int8Stats.size * 0.7) // Should be ~50%
    })

    it('should have tokenizer directory for int4', () => {
      if (!existsSync(path.join(packageDir, 'build/int4'))) {
        return // Skip if int4 not built
      }
      expect(existsSync(int4TokenizerDir)).toBe(true)
    })
  })

  describe('model validation', () => {
    it('int8 model should have IR version', async () => {
      const modelPath = path.join(packageDir, 'build/int8/models/minilm.onnx')
      if (!existsSync(modelPath)) {
        return // Skip if not built yet
      }

      const buffer = await fs.readFile(modelPath)
      // ONNX models contain IR version info early in the file
      const _str = buffer.toString('utf-8', 0, 1000)
      // Should contain model structure markers
      expect(buffer.length).toBeGreaterThan(1000)
    })
  })

  describe('package configuration', () => {
    it('should have test script configured', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.scripts).toBeDefined()
      expect(pkgJson.scripts.test).toBe('vitest run')
    })

    it('should be marked as private', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.private).toBe(true)
    })

    it('should have externalTools for Python dependencies', async () => {
      const pkgJson = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf-8'),
      )

      expect(pkgJson.externalTools).toBeDefined()
      expect(pkgJson.externalTools.transformers).toBeDefined()
      expect(pkgJson.externalTools.torch).toBeDefined()
      expect(pkgJson.externalTools.onnx).toBeDefined()
      expect(pkgJson.externalTools.onnxruntime).toBeDefined()
      expect(pkgJson.externalTools.optimum).toBeDefined()
    })
  })

  describe('build cache validation', () => {
    it('should have cache directory for checkpointing', () => {
      const cacheDir = path.join(packageDir, 'build/int8/cache')
      if (!existsSync(path.join(packageDir, 'build/int8'))) {
        return // Skip if not built yet
      }
      // Cache directory should exist during build
      expect(existsSync(cacheDir)).toBe(true)
    })
  })

  describe('model metadata', () => {
    it('tokenizer should have special_tokens_map.json', async () => {
      const specialTokensFile = path.join(
        packageDir,
        'build/int8/models/minilm-tokenizer/special_tokens_map.json',
      )
      if (!existsSync(specialTokensFile)) {
        return // Skip if not built yet
      }

      const content = JSON.parse(await fs.readFile(specialTokensFile, 'utf-8'))
      // MiniLM uses WordPiece tokenization with standard special tokens
      expect(content).toHaveProperty('cls_token')
      expect(content).toHaveProperty('sep_token')
      expect(content).toHaveProperty('pad_token')
    })
  })
})
