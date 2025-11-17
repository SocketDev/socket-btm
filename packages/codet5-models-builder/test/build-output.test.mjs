/**
 * @fileoverview Tests for codet5-models-builder model output files.
 * Validates that the build process generates correct encoder/decoder structure and formats.
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

describe.skipIf(!hasBuiltArtifacts)(
  'codet5-models-builder model output',
  () => {
    describe('directory structure', () => {
      it('should have build root directory', () => {
        expect(existsSync(buildDir)).toBe(true)
      })

      it('should have dev/int8 build directory', () => {
        const devInt8Dir = path.join(packageDir, 'build/dev/int8')
        expect(existsSync(devInt8Dir)).toBe(true)
      })

      it('should have output directory in dev/int8', () => {
        const outputDir = path.join(packageDir, 'build/dev/int8/output')
        expect(existsSync(outputDir)).toBe(true)
      })
    })

    describe('int8 quantization output (dev)', () => {
      const encoderPath = path.join(
        packageDir,
        'build/dev/int8/output/encoder.onnx',
      )
      const decoderPath = path.join(
        packageDir,
        'build/dev/int8/output/decoder.onnx',
      )
      const tokenizerPath = path.join(
        packageDir,
        'build/dev/int8/output/tokenizer.json',
      )

      it('should generate encoder.onnx model file', () => {
        expect(existsSync(encoderPath)).toBe(true)
      })

      it('should generate decoder.onnx model file', () => {
        expect(existsSync(decoderPath)).toBe(true)
      })

      it('should generate tokenizer.json', () => {
        expect(existsSync(tokenizerPath)).toBe(true)
      })

      it('encoder.onnx should have valid ONNX format', async () => {
        if (!existsSync(encoderPath)) {
          return // Skip if not built yet
        }

        const buffer = await fs.readFile(encoderPath)
        // ONNX files use protobuf format
        expect(buffer.length).toBeGreaterThan(100)
        expect(buffer[0]).toBeGreaterThanOrEqual(0x08)
      })

      it('decoder.onnx should have valid ONNX format', async () => {
        if (!existsSync(decoderPath)) {
          return // Skip if not built yet
        }

        const buffer = await fs.readFile(decoderPath)
        // ONNX files use protobuf format
        expect(buffer.length).toBeGreaterThan(100)
        expect(buffer[0]).toBeGreaterThanOrEqual(0x08)
      })

      it('encoder should be reasonably sized', async () => {
        if (!existsSync(encoderPath)) {
          return // Skip if not built yet
        }

        const stats = await fs.stat(encoderPath)
        // CodeT5 encoder is typically 40-120MB
        expect(stats.size).toBeGreaterThan(20 * 1024 * 1024) // > 20MB
        expect(stats.size).toBeLessThan(200 * 1024 * 1024) // < 200MB
      })

      it('decoder should be reasonably sized', async () => {
        if (!existsSync(decoderPath)) {
          return // Skip if not built yet
        }

        const stats = await fs.stat(decoderPath)
        // CodeT5 decoder is typically 40-200MB
        expect(stats.size).toBeGreaterThan(20 * 1024 * 1024) // > 20MB
        expect(stats.size).toBeLessThan(250 * 1024 * 1024) // < 250MB
      })

      it('tokenizer.json should be valid JSON', async () => {
        if (!existsSync(tokenizerPath)) {
          return // Skip if not built yet
        }

        const content = JSON.parse(await fs.readFile(tokenizerPath, 'utf-8'))
        expect(content).toHaveProperty('model')
        expect(content).toHaveProperty('normalizer')
      })
    })

    describe('int4 quantization output (prod)', () => {
      const int4EncoderPath = path.join(
        packageDir,
        'build/prod/int4/output/encoder.onnx',
      )
      const int4DecoderPath = path.join(
        packageDir,
        'build/prod/int4/output/decoder.onnx',
      )

      it('should generate encoder for int4', () => {
        if (!existsSync(path.join(packageDir, 'build/prod/int4'))) {
          return // Skip if int4 not built
        }
        expect(existsSync(int4EncoderPath)).toBe(true)
      })

      it('should generate decoder for int4', () => {
        if (!existsSync(path.join(packageDir, 'build/prod/int4'))) {
          return // Skip if int4 not built
        }
        expect(existsSync(int4DecoderPath)).toBe(true)
      })

      it('int4 models should be smaller than int8', async () => {
        const int8EncoderPath = path.join(
          packageDir,
          'build/dev/int8/output/encoder.onnx',
        )

        if (!existsSync(int4EncoderPath) || !existsSync(int8EncoderPath)) {
          return // Skip if either not built
        }

        const int4Stats = await fs.stat(int4EncoderPath)
        const int8Stats = await fs.stat(int8EncoderPath)

        // INT4 should be noticeably smaller (~50% size)
        expect(int4Stats.size).toBeLessThan(int8Stats.size)
        expect(int4Stats.size).toBeGreaterThan(int8Stats.size * 0.3)
        expect(int4Stats.size).toBeLessThan(int8Stats.size * 0.7)
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
      })
    })

    describe('shared models cache', () => {
      it('should have models directory for shared cache', () => {
        const modelsDir = path.join(packageDir, 'build/models')
        if (!existsSync(path.join(packageDir, 'build'))) {
          return // Skip if not built yet
        }
        expect(existsSync(modelsDir)).toBe(true)
      })

      it('models cache should have tokenizer.json', async () => {
        const tokenizerFile = path.join(
          packageDir,
          'build/models/tokenizer.json',
        )
        if (!existsSync(tokenizerFile)) {
          return // Skip if not built yet
        }

        expect(existsSync(tokenizerFile)).toBe(true)
        const content = JSON.parse(await fs.readFile(tokenizerFile, 'utf-8'))
        expect(content).toHaveProperty('model')
      })

      it('models cache should have config.json', () => {
        const configFile = path.join(packageDir, 'build/models/config.json')
        if (!existsSync(path.join(packageDir, 'build/models'))) {
          return // Skip if not built yet
        }
        expect(existsSync(configFile)).toBe(true)
      })
    })
  },
)
