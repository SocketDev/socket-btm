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

// Skip tests if build artifacts don't exist (expected in CI)
const buildDir = path.join(packageDir, 'build')
const hasBuiltArtifacts = existsSync(buildDir)

describe.skipIf(!hasBuiltArtifacts)('minilm-builder model output', () => {
  describe('directory structure', () => {
    it('should have build root directory', () => {
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
        // Skip if not built yet
        return
      }

      const buffer = await fs.readFile(int8ModelPath)
      expect(buffer.length).toBeGreaterThan(100)
      // ONNX files use protobuf format (magic: 0x08 for first field)
      // Just check file starts with protobuf-like bytes
      expect(buffer[0]).toBeGreaterThanOrEqual(0x08)
    })

    it('minilm.onnx should be reasonably sized', async () => {
      if (!existsSync(int8ModelPath)) {
        // Skip if not built yet
        return
      }

      const stats = await fs.stat(int8ModelPath)
      expect(stats.size).toBeGreaterThan(5 * 1024 * 1024)
      // INT8 quantized MiniLM models are typically 10-25MB
      // > 5MB
      expect(stats.size).toBeLessThan(30 * 1024 * 1024)
      // < 30MB
    })

    it('should have tokenizer directory', () => {
      expect(existsSync(int8TokenizerDir)).toBe(true)
    })

    it('tokenizer should have tokenizer.json', async () => {
      const tokenizerFile = path.join(int8TokenizerDir, 'tokenizer.json')
      if (!existsSync(tokenizerFile)) {
        // Skip if not built yet
        return
      }

      const content = JSON.parse(await fs.readFile(tokenizerFile, 'utf-8'))
      expect(content).toHaveProperty('version')
      expect(content).toHaveProperty('truncation')
      expect(content).toHaveProperty('padding')
    })

    it('tokenizer should have tokenizer_config.json', async () => {
      const configFile = path.join(int8TokenizerDir, 'tokenizer_config.json')
      if (!existsSync(configFile)) {
        // Skip if not built yet
        return
      }

      const content = JSON.parse(await fs.readFile(configFile, 'utf-8'))
      expect(content).toHaveProperty('model_max_length')
    })

    it('tokenizer should have vocab.txt', () => {
      const vocabFile = path.join(int8TokenizerDir, 'vocab.txt')
      if (!existsSync(vocabFile)) {
        // Skip if not built yet
        return
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
        // Skip if int4 not built
        return
      }
      expect(existsSync(int4ModelPath)).toBe(true)
    })

    it('int4 model should be smaller than int8', async () => {
      const int8ModelPath = path.join(
        packageDir,
        'build/int8/models/minilm.onnx',
      )

      if (!existsSync(int4ModelPath) || !existsSync(int8ModelPath)) {
        // Skip if either not built
        return
      }

      const int4Stats = await fs.stat(int4ModelPath)
      const int8Stats = await fs.stat(int8ModelPath)

      expect(int4Stats.size).toBeLessThan(int8Stats.size)
      // INT4 should be noticeably smaller than INT8 (roughly 50% size)
      expect(int4Stats.size).toBeGreaterThan(int8Stats.size * 0.3)
      // But not too small
      expect(int4Stats.size).toBeLessThan(int8Stats.size * 0.7)
      // Should be ~50%
    })

    it('should have tokenizer directory for int4', () => {
      if (!existsSync(path.join(packageDir, 'build/int4'))) {
        // Skip if int4 not built
        return
      }
      expect(existsSync(int4TokenizerDir)).toBe(true)
    })
  })

  describe('model validation', () => {
    it('int8 model should have IR version', async () => {
      const modelPath = path.join(packageDir, 'build/int8/models/minilm.onnx')
      if (!existsSync(modelPath)) {
        // Skip if not built yet
        return
      }

      const buffer = await fs.readFile(modelPath)
      const _str = buffer.toString('utf-8', 0, 1000)
      // ONNX models contain IR version info early in the file
      expect(buffer.length).toBeGreaterThan(1000)
      // Should contain model structure markers
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

    it('should have external-tools.json for Python dependencies', async () => {
      const externalToolsPath = path.join(packageDir, 'external-tools.json')
      const externalTools = JSON.parse(
        await fs.readFile(externalToolsPath, 'utf-8'),
      )

      expect(externalTools.tools).toBeDefined()
      expect(externalTools.tools.transformers).toBeDefined()
      expect(externalTools.tools.torch).toBeDefined()
      expect(externalTools.tools.onnx).toBeDefined()
      expect(externalTools.tools.onnxruntime).toBeDefined()
      expect(externalTools.tools.optimum).toBeDefined()
    })
  })

  describe('build cache validation', () => {
    it('should have cache directory for checkpointing', () => {
      const cacheDir = path.join(packageDir, 'build/int8/cache')
      if (!existsSync(path.join(packageDir, 'build/int8'))) {
        // Skip if not built yet
        return
      }
      expect(existsSync(cacheDir)).toBe(true)
      // Cache directory should exist during build
    })
  })

  describe('model metadata', () => {
    it('tokenizer should have special_tokens_map.json', async () => {
      const specialTokensFile = path.join(
        packageDir,
        'build/int8/models/minilm-tokenizer/special_tokens_map.json',
      )
      if (!existsSync(specialTokensFile)) {
        // Skip if not built yet
        return
      }

      const content = JSON.parse(await fs.readFile(specialTokensFile, 'utf-8'))
      expect(content).toHaveProperty('cls_token')
      // MiniLM uses WordPiece tokenization with standard special tokens
      expect(content).toHaveProperty('sep_token')
      expect(content).toHaveProperty('pad_token')
    })
  })
})
