#!/usr/bin/env node

/**
 * Build script for @socketsecurity/models.
 *
 * Downloads AI models from Hugging Face, converts to ONNX, and applies quantization.
 *
 * Workflow:
 * 1. Download models from Hugging Face (with fallbacks)
 * 2. Convert to ONNX if needed
 * 3. Apply quantization (INT4 or INT8) for compression
 * 4. Output quantized ONNX models
 *
 * Options:
 * --dev    Development build (INT8 quantization, better compatibility, ~50% size reduction)
 * --prod   Production build (INT4 quantization, maximum compression, ~75% size reduction, default)
 * --int8   Alias for --dev (INT8 quantization)
 * --int4   Alias for --prod (INT4 quantization)
 * --minilm Build MiniLM-L6 model only
 * --codet5 Build CodeT5 model only
 * --all    Build all models
 * --force  Force rebuild even if checkpoints exist
 * --clean  Clean all checkpoints before building
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  cleanCheckpoint,
  createCheckpoint,
} from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { checkModelBuildPrerequisites } from 'build-infra/lib/model-build-helpers'
import { getPythonCommand } from 'build-infra/lib/python-installer'
import { errorMessage } from 'build-infra/lib/error-utils'

import { readJson, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { convertToOnnx as convertToOnnxImpl } from './converted/shared/convert-to-onnx.mts'
import { downloadModel as downloadModelImpl } from './downloaded/shared/download-model.mts'
import { getCheckpointChain } from './get-checkpoint-chain.mts'
import {
  PACKAGE_ROOT,
  getBuildPaths,
  getCurrentPlatform,
} from './paths.mts'
import { quantizeModel as quantizeModelImpl } from './quantized/shared/quantize-model.mts'

// Parse arguments.
const args = new Set(process.argv.slice(2))
const FORCE_BUILD = args.has('--force')
const CLEAN_BUILD = args.has('--clean')

// Model selection flags.
// Build all models by default unless a specific model is selected.
const hasModelFlag =
  args.has('--minilm') || args.has('--codet5') || args.has('--all')
const BUILD_MINILM = !hasModelFlag || args.has('--all') || args.has('--minilm')
const BUILD_CODET5 = !hasModelFlag || args.has('--all') || args.has('--codet5')

// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
// Accept both --dev/--prod and legacy --int8/--int4 flags.
const QUANT_LEVEL = args.has('--int4') || args.has('--prod') ? 'int4' : 'int8'
// Build mode: prod (int4) vs dev (int8)
const BUILD_MODE = QUANT_LEVEL === 'int4' ? 'prod' : 'dev'

// Get checkpoint chain for progressive cleanup
const CHECKPOINT_CHAIN = getCheckpointChain(BUILD_MODE)

// Get paths from source of truth
const PLATFORM_ARCH = await getCurrentPlatform()
const {
  buildDir: BUILD,
  modelsDir: MODELS,
  outputFinalDir,
} = getBuildPaths(BUILD_MODE, PLATFORM_ARCH)
const DIST_MODE = outputFinalDir

const logger = getDefaultLogger()

// Load model sources from package.json (single source of truth).
const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json')
const packageJson = await readJson(packageJsonPath)
const MODEL_SOURCES = packageJson.moduleSources

if (!MODEL_SOURCES) {
  throw new Error('moduleSources not found in package.json')
}

/**
 * Download model from Hugging Face.
 */
async function downloadModel(modelKey) {
  // Use empty packageName for flat checkpoint structure (workflow caching requirement)
  return downloadModelImpl({
    buildDir: BUILD,
    forceRebuild: FORCE_BUILD,
    modelKey,
    modelSources: MODEL_SOURCES,
    modelsDir: MODELS,
    packageName: '',
  })
}

/**
 * Convert model to ONNX if needed.
 */
async function convertToOnnx(modelKey) {
  // Use empty packageName for flat checkpoint structure (workflow caching requirement)
  return convertToOnnxImpl({
    buildDir: BUILD,
    forceRebuild: FORCE_BUILD,
    modelKey,
    modelSources: MODEL_SOURCES,
    modelsDir: MODELS,
    packageName: '',
  })
}

/**
 * Apply quantization for compression.
 *
 * Supports two quantization levels:
 * - INT4: MatMulNBitsQuantizer with RTN weight-only quantization (maximum compression).
 * - INT8: Dynamic quantization (better compatibility, moderate compression).
 *
 * Results in significant size reduction with minimal accuracy loss.
 */
async function quantizeModel(modelKey, quantLevel) {
  // Use empty packageName for flat checkpoint structure (workflow caching requirement)
  return quantizeModelImpl({
    buildDir: BUILD,
    forceRebuild: FORCE_BUILD,
    modelKey,
    modelsDir: MODELS,
    packageName: '',
    quantLevel,
  })
}

/**
 * Copy quantized models and tokenizers to build output directory.
 * Output structure: build/{mode}/out/Final/{modelKey}/model.onnx
 */
async function copyToDist(modelKey, quantizedPaths, quantLevel) {
  logger.step('Copying models to build output')

  // Create nested directory structure: build/<mode>/<platform-arch>/out/Final/minilm-l6/
  const outputDir = path.join(DIST_MODE, modelKey)
  await safeMkdir(outputDir)

  const modelDir = path.join(MODELS, modelKey)

  // Copy quantized model
  await fs.copyFile(quantizedPaths[0], path.join(outputDir, 'model.onnx'))

  // Copy or generate tokenizer.json
  const tokenizerJsonPath = path.join(modelDir, 'tokenizer.json')
  if (existsSync(tokenizerJsonPath)) {
    await fs.copyFile(tokenizerJsonPath, path.join(outputDir, 'tokenizer.json'))
  } else {
    // Generate tokenizer.json from tokenizer files
    logger.substep('Generating tokenizer.json from tokenizer files')
    const python3Path = await getPythonCommand()
    if (!python3Path) {
      throw new Error('Python not found (checked pip shebang and PATH)')
    }

    const generateScript = `
from transformers import AutoTokenizer
tokenizer = AutoTokenizer.from_pretrained('${modelDir}')
tokenizer.save_pretrained('${outputDir}')
`
    const result = await spawn(python3Path, ['-c', generateScript], {
      stdio: 'inherit',
    })
    if (result.code !== 0) {
      throw new Error(
        `Failed to generate tokenizer.json with exit code ${result.code}`,
      )
    }
  }

  logger.success(
    `Copied ${modelKey} model (${quantLevel}) to ${path.relative(PACKAGE_ROOT, outputDir)}/`,
  )
}

/**
 * Main build.
 */
async function main() {
  logger.info('Building @socketsecurity/models')
  logger.info('='.repeat(60))
  logger.info(`Quantization: ${QUANT_LEVEL}`)
  logger.info('')

  const startTime = Date.now()

  // Check and install prerequisites (centralized in build-infra).
  await checkModelBuildPrerequisites({
    buildDir: BUILD,
    packageJsonPath,
    packageRoot: PACKAGE_ROOT,
    requiredDiskGB: 2,
  })

  // Clean checkpoints if requested or if output is missing.
  const outputMissing =
    !existsSync(path.join(DIST_MODE, 'minilm-l6', 'model.onnx')) &&
    !existsSync(path.join(DIST_MODE, 'codet5', 'model.onnx'))

  if (CLEAN_BUILD || outputMissing) {
    if (outputMissing) {
      logger.step('Output artifacts missing - cleaning stale checkpoints')
    }
    await cleanCheckpoint(BUILD, '')
  }

  // Create directories.
  await safeMkdir(BUILD)

  try {
    // Build MiniLM-L6 if requested.
    if (BUILD_MINILM) {
      logger.info('')
      logger.info('Building MiniLM-L6...')
      logger.info('-'.repeat(60))

      await downloadModel('minilm-l6')
      await convertToOnnx('minilm-l6')
      const quantizedPaths = await quantizeModel('minilm-l6', QUANT_LEVEL)
      await copyToDist('minilm-l6', quantizedPaths, QUANT_LEVEL)
    }

    // Build CodeT5 if requested.
    if (BUILD_CODET5) {
      logger.info('')
      logger.info('Building CodeT5...')
      logger.info('-'.repeat(60))

      await downloadModel('codet5')
      await convertToOnnx('codet5')
      const quantizedPaths = await quantizeModel('codet5', QUANT_LEVEL)
      await copyToDist('codet5', quantizedPaths, QUANT_LEVEL)
    }

    // Create aggregate phase checkpoints for workflow caching
    // These are used by GitHub Actions to cache at phase boundaries

    // Downloaded checkpoint: Archive all downloaded models
    await createCheckpoint(
      BUILD,
      CHECKPOINTS.DOWNLOADED,
      async () => {
        // Smoke test: Verify models directory exists and has models
        const stats = await fs.stat(MODELS)
        if (!stats.isDirectory()) {
          throw new Error(`Models directory not found: ${MODELS}`)
        }
        const modelDirs = await fs.readdir(MODELS)
        if (modelDirs.length === 0) {
          throw new Error('No models downloaded')
        }
      },
      {
        artifactPath: MODELS,
        buildMode: BUILD_MODE,
        checkpointChain: CHECKPOINT_CHAIN,
      },
    )

    // Converted checkpoint: Archive all converted models (same directory)
    await createCheckpoint(
      BUILD,
      CHECKPOINTS.CONVERTED,
      async () => {
        // Smoke test: Verify at least one ONNX file exists
        const modelDirs = await fs.readdir(MODELS)
        let hasOnnx = false
        for (const modelDir of modelDirs) {
          const modelPath = path.join(MODELS, modelDir, 'model.onnx')
          if (existsSync(modelPath)) {
            hasOnnx = true
            break
          }
        }
        if (!hasOnnx) {
          throw new Error('No ONNX models found after conversion')
        }
      },
      {
        artifactPath: MODELS,
        buildMode: BUILD_MODE,
        checkpointChain: CHECKPOINT_CHAIN,
      },
    )

    // Quantized checkpoint: Archive all quantized models (same directory)
    await createCheckpoint(
      BUILD,
      CHECKPOINTS.QUANTIZED,
      async () => {
        // Smoke test: Verify at least one quantized model exists
        const modelDirs = await fs.readdir(MODELS)
        let hasQuantized = false
        for (const modelDir of modelDirs) {
          const int4Path = path.join(MODELS, modelDir, 'model.int4.onnx')
          const int8Path = path.join(MODELS, modelDir, 'model.int8.onnx')
          if (existsSync(int4Path) || existsSync(int8Path)) {
            hasQuantized = true
            break
          }
        }
        if (!hasQuantized) {
          throw new Error('No quantized models found')
        }
      },
      {
        artifactPath: MODELS,
        buildMode: BUILD_MODE,
        checkpointChain: CHECKPOINT_CHAIN,
        quantLevel: QUANT_LEVEL,
      },
    )

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)

    logger.info('')
    logger.info('='.repeat(60))
    logger.success('Build complete!')
    logger.info('')
    logger.substep(`Duration: ${duration}s`)
    logger.info('')
    logger.substep(`Output: ${DIST_MODE}`)

    if (BUILD_MINILM) {
      logger.substep(`  - minilm-l6/model.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep('  - minilm-l6/tokenizer.json')
    }
    if (BUILD_CODET5) {
      logger.substep(`  - codet5/model.onnx (${QUANT_LEVEL} quantized)`)
      logger.substep('  - codet5/tokenizer.json')
    }

    // Create finalized checkpoint for caching.
    await createCheckpoint(
      BUILD,
      CHECKPOINTS.FINALIZED,
      async () => {
        // Smoke test: Verify final output files exist and meet size requirements
        // Different thresholds for dev (INT8) vs prod (INT4)
        // 100KB (INT4) or 1MB (INT8)
        const minSize = BUILD_MODE === 'prod' ? 100_000 : 1_000_000

        if (BUILD_MINILM) {
          const minilmModel = path.join(DIST_MODE, 'minilm-l6', 'model.onnx')
          const minilmTokenizer = path.join(
            DIST_MODE,
            'minilm-l6',
            'tokenizer.json',
          )
          if (!existsSync(minilmModel)) {
            throw new Error(`MiniLM model not found: ${minilmModel}`)
          }
          if (!existsSync(minilmTokenizer)) {
            throw new Error(`MiniLM tokenizer not found: ${minilmTokenizer}`)
          }
          const stats = await fs.stat(minilmModel)
          if (stats.size < minSize) {
            throw new Error(
              `MiniLM model too small: ${stats.size} bytes (expected >${minSize})`,
            )
          }
        }
        if (BUILD_CODET5) {
          const codet5Model = path.join(DIST_MODE, 'codet5', 'model.onnx')
          const codet5Tokenizer = path.join(
            DIST_MODE,
            'codet5',
            'tokenizer.json',
          )
          if (!existsSync(codet5Model)) {
            throw new Error(`CodeT5 model not found: ${codet5Model}`)
          }
          if (!existsSync(codet5Tokenizer)) {
            throw new Error(`CodeT5 tokenizer not found: ${codet5Tokenizer}`)
          }
          const stats = await fs.stat(codet5Model)
          if (stats.size < minSize) {
            throw new Error(
              `CodeT5 model too small: ${stats.size} bytes (expected >${minSize})`,
            )
          }
        }
      },
      {
        artifactPath: DIST_MODE,
        buildMode: BUILD_MODE,
        checkpointChain: CHECKPOINT_CHAIN,
        quantLevel: QUANT_LEVEL,
      },
    )
  } catch (error) {
    logger.info('')
    logger.error(`Build failed: ${errorMessage(error)}`)
    throw error
  }
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
