/**
 * Build codet5-models - Convert and optimize CodeT5 models for Socket CLI.
 *
 * This script downloads, converts, and optimizes CodeT5 models:
 * - Downloads models from Hugging Face
 * - Converts to ONNX format
 * - Applies INT4/INT8 mixed-precision quantization
 * - Optimizes ONNX graphs
 *
 * Usage:
 *   node scripts/build.mts          # Dev build (INT8 quantization, default)
 *   node scripts/build.mts --int4   # Prod build (INT4 quantization, smaller)
 *   node scripts/build.mts --force  # Force rebuild (ignore checkpoints)
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { formatDuration, getFileSize } from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { checkModelBuildPrerequisites } from 'build-infra/lib/model-build-helpers'
import { getBuildMode } from 'build-infra/lib/constants'
import { validateOnnxFile } from 'build-infra/lib/onnx-helpers'
import { getPythonCommand } from 'build-infra/lib/python-installer'
import { errorMessage } from 'build-infra/lib/error-utils'
import * as ort from 'onnxruntime-node'
import process from 'node:process'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  MODELS_DIR,
  getBuildPaths,
  getCurrentPlatform,
} from './paths.mts'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Package paths for model build prerequisites
const packageRoot = path.join(__dirname, '..')
const packageJsonPath = path.join(__dirname, '..', 'package.json')

// Load package.json for sources configuration
let packageJson
try {
  packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
} catch (e) {
  throw new Error(
    `Failed to parse package.json at ${packageJsonPath}: ${errorMessage(e)}`,
    { cause: e },
  )
}

// Parse arguments.
const args = new Set(process.argv.slice(2))
const FORCE_BUILD = args.has('--force')

// Build mode: --prod/--dev CLI flags win; otherwise env (BUILD_MODE, CI→prod,
// default dev). Handled centrally by build-infra's getBuildMode().
const BUILD_MODE = getBuildMode(args)

// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
const QUANT_LEVEL = args.has('--int4') ? 'int4' : 'int8'

// Get paths from source of truth
const PLATFORM_ARCH = await getCurrentPlatform()

// Host platform/arch explicitly passed to every createCheckpoint call so the
// cache key is tagged with the target (models builds run natively per host —
// no cross-compile). createCheckpoint now throws without these for non-source
// checkpoints.
const TARGET_PLATFORM = process.platform
const TARGET_ARCH = process.env.TARGET_ARCH || process.arch
const {
  buildDir: BUILD_DIR,
  configFile,
  decoderFile,
  encoderFile,
  outputDecoderFile,
  outputDir: OUTPUT_DIR,
  outputEncoderFile,
  outputTokenizerFile,
  tokenizerFile,
} = getBuildPaths(BUILD_MODE, PLATFORM_ARCH, QUANT_LEVEL)

// Configuration - Read model source from package.json.
const codet5Source = packageJson.sources?.codet5
if (!codet5Source) {
  throw new Error(
    'Missing sources.codet5 in package.json. Please add source metadata.',
  )
}
// For HuggingFace, version contains the model identifier
const MODEL_NAME = codet5Source.version

/**
 * Download CodeT5 models from Hugging Face.
 */
async function downloadModels() {
  if (!(await shouldRun(BUILD_DIR, '', CHECKPOINTS.DOWNLOADED, FORCE_BUILD))) {
    return
  }

  logger.step('Downloading CodeT5 Models')
  logger.substep(`Model: ${MODEL_NAME}`)

  await safeMkdir(MODELS_DIR)

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  // Use Hugging Face CLI to download models.
  const pythonScript =
    'from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; ' +
    `tokenizer = AutoTokenizer.from_pretrained('${MODEL_NAME}'); ` +
    `model = AutoModelForSeq2SeqLM.from_pretrained('${MODEL_NAME}'); ` +
    `tokenizer.save_pretrained('${MODELS_DIR}'); ` +
    `model.save_pretrained('${MODELS_DIR}')`

  const downloadResult = await spawn(python3Path, ['-c', pythonScript], {
    stdio: 'inherit',
  })

  if (downloadResult.code !== 0) {
    throw new Error('Failed to download models')
  }

  logger.success('Models downloaded')

  await createCheckpoint(
    BUILD_DIR,
    CHECKPOINTS.DOWNLOADED,
    async () => {
      // Smoke test: Verify tokenizer.json and model config exist.
      if (!existsSync(tokenizerFile)) {
        throw new Error(`Tokenizer file not found: ${tokenizerFile}`)
      }
      if (!existsSync(configFile)) {
        throw new Error(`Config file not found: ${configFile}`)
      }
      logger.substep('Model files validated')
    },
    { arch: TARGET_ARCH, platform: TARGET_PLATFORM },
  )
}

/**
 * Convert models to ONNX format.
 */
async function convertToOnnx() {
  if (!(await shouldRun(BUILD_DIR, '', CHECKPOINTS.CONVERTED, FORCE_BUILD))) {
    return
  }

  logger.step('Converting to ONNX')

  await safeMkdir(BUILD_DIR)

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  // Convert to ONNX using native torch.onnx.export via convert.py script.
  logger.substep('Converting models to ONNX')

  // Use opset 14 for both prod and dev (opset 13 lacks aten::triu support).
  const opsetVersion = '14'
  const convertScriptPath = path.join(__dirname, '..', 'python', 'convert.py')

  // Run conversion with JSON output protocol
  const convertResult = await spawn(
    python3Path,
    [convertScriptPath, MODELS_DIR, BUILD_DIR, opsetVersion],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )

  // Parse JSON output from convert.py
  if (convertResult.stdout) {
    const lines = convertResult.stdout.toString().trim().split('\n')
    for (const line of lines) {
      if (!line) {
        continue
      }
      try {
        const msg = JSON.parse(line)
        if (msg.error) {
          logger.error(`Conversion error: ${msg.error}`)
          if (msg.traceback) {
            logger.error(msg.traceback)
          }
          throw new Error(`Failed to convert models to ONNX: ${msg.error}`)
        }
        if (msg.status) {
          logger.substep(`Conversion: ${msg.status}`)
        }
      } catch (e) {
        if (errorMessage(e).startsWith('Failed to convert')) {
          throw e
        }
        // Non-JSON output, just log it
        logger.substep(line)
      }
    }
  }

  if (convertResult.code !== 0) {
    throw new Error('Failed to convert models to ONNX')
  }

  logger.success('Models converted to ONNX')

  const encoderSize = await getFileSize(encoderFile)
  const decoderSize = await getFileSize(decoderFile)

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    CHECKPOINTS.CONVERTED,
    async () => {
      // Smoke test: Verify converted models are valid ONNX files.
      await validateOnnxFile(encoderFile, 'encoder')
      await validateOnnxFile(decoderFile, 'decoder')
      logger.substep(
        `Converted models valid: encoder ${encoderSize}, decoder ${decoderSize}`,
      )
    },
    {
      arch: TARGET_ARCH,
      decoderFile: path.relative(BUILD_DIR, decoderFile),
      decoderSize,
      encoderFile: path.relative(BUILD_DIR, encoderFile),
      encoderSize,
      platform: TARGET_PLATFORM,
    },
  )
}

/**
 * Apply quantization to models.
 */
async function quantizeModels() {
  if (!(await shouldRun(BUILD_DIR, '', CHECKPOINTS.QUANTIZED, FORCE_BUILD))) {
    return
  }

  logger.step('Quantizing Models')

  // Quantize encoder with INT8.
  logger.substep('Quantizing encoder (INT8)')
  const quantizeEncoderScript =
    'from onnxruntime.quantization import quantize_dynamic, QuantType; ' +
    `quantize_dynamic('${encoderFile}', '${encoderFile}.quant', weight_type=QuantType.QInt8)`

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  const quantizeEncoderResult = await spawn(
    python3Path,
    ['-c', quantizeEncoderScript],
    {
      stdio: 'inherit',
    },
  )

  if (quantizeEncoderResult.code !== 0) {
    throw new Error('Failed to quantize encoder')
  }

  // Quantize decoder with INT8.
  logger.substep('Quantizing decoder (INT8)')
  const quantizeDecoderScript =
    'from onnxruntime.quantization import quantize_dynamic, QuantType; ' +
    `quantize_dynamic('${decoderFile}', '${decoderFile}.quant', weight_type=QuantType.QInt8)`

  const python3PathDecoder = await getPythonCommand()
  if (!python3PathDecoder) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  const quantizeDecoderResult = await spawn(
    python3PathDecoder,
    ['-c', quantizeDecoderScript],
    {
      stdio: 'inherit',
    },
  )

  if (quantizeDecoderResult.code !== 0) {
    throw new Error('Failed to quantize decoder')
  }

  // Replace original models with quantized versions.
  await fs.rename(`${encoderFile}.quant`, encoderFile)
  await fs.rename(`${decoderFile}.quant`, decoderFile)

  const encoderSize = await getFileSize(encoderFile)
  const decoderSize = await getFileSize(decoderFile)

  logger.substep(`Encoder: ${encoderSize}`)
  logger.substep(`Decoder: ${decoderSize}`)

  logger.success('Models quantized')

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    CHECKPOINTS.QUANTIZED,
    async () => {
      // Smoke test: Verify quantized models are still valid ONNX files.
      await validateOnnxFile(encoderFile, 'quantized encoder')
      await validateOnnxFile(decoderFile, 'quantized decoder')
      logger.substep('Quantized models valid')
    },
    {
      arch: TARGET_ARCH,
      decoderFile: path.relative(BUILD_DIR, decoderFile),
      decoderSize,
      encoderFile: path.relative(BUILD_DIR, encoderFile),
      encoderSize,
      platform: TARGET_PLATFORM,
    },
  )
}

/**
 * Optimize ONNX graphs with transformer-specific optimizations (prod mode only).
 *
 * Uses onnxruntime.transformers.optimizer to apply graph optimizations like:
 * - Fusing operations (LayerNorm, Attention)
 * - Constant folding
 * - Removing redundant nodes
 *
 * In dev mode (int8), skip this for faster builds.
 * In prod mode (int4), apply optimizations for maximum performance.
 */
async function optimizeModels() {
  // Skip optimization in dev mode (int8 - faster iteration).
  if (QUANT_LEVEL === 'int8') {
    logger.substep(
      'Skipping ONNX graph optimization (dev mode - faster builds)',
    )
    return
  }

  if (!(await shouldRun(BUILD_DIR, '', CHECKPOINTS.OPTIMIZED, FORCE_BUILD))) {
    return
  }

  logger.step('Optimizing ONNX Graphs (prod mode)')

  const optimizedEncoderPath = path.join(
    BUILD_DIR,
    'encoder_model_optimized.onnx',
  )
  const optimizedDecoderPath = path.join(
    BUILD_DIR,
    'decoder_model_optimized.onnx',
  )

  // Resolve python path for optimization (uses pip-associated Python)
  const python3PathOpt = await getPythonCommand()
  if (!python3PathOpt) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  // Optimize encoder.
  logger.substep('Optimizing encoder graph')
  const optimizeEncoderScript =
    'from onnxruntime.transformers import optimizer; ' +
    `opt = optimizer.optimize_model('${encoderFile}', model_type='bert', num_heads=12, hidden_size=768); ` +
    `opt.save_model_to_file('${optimizedEncoderPath}')`

  const optimizeEncoderResult = await spawn(
    python3PathOpt,
    ['-c', optimizeEncoderScript],
    {
      stdio: 'inherit',
    },
  )

  if (optimizeEncoderResult.code !== 0) {
    throw new Error('Failed to optimize encoder')
  }

  // Optimize decoder.
  logger.substep('Optimizing decoder graph')
  const optimizeDecoderScript =
    'from onnxruntime.transformers import optimizer; ' +
    `opt = optimizer.optimize_model('${decoderFile}', model_type='bert', num_heads=12, hidden_size=768); ` +
    `opt.save_model_to_file('${optimizedDecoderPath}')`

  const optimizeDecoderResult = await spawn(
    python3PathOpt,
    ['-c', optimizeDecoderScript],
    {
      stdio: 'inherit',
    },
  )

  if (optimizeDecoderResult.code !== 0) {
    throw new Error('Failed to optimize decoder')
  }

  // Replace original models with optimized versions.
  await fs.rename(optimizedEncoderPath, encoderFile)
  await fs.rename(optimizedDecoderPath, decoderFile)

  const encoderSize = await getFileSize(encoderFile)
  const decoderSize = await getFileSize(decoderFile)

  logger.substep(`Encoder: ${encoderSize}`)
  logger.substep(`Decoder: ${decoderSize}`)

  logger.success('ONNX graphs optimized')

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    CHECKPOINTS.OPTIMIZED,
    async () => {
      // Smoke test: Verify optimized models are still valid ONNX files.
      await validateOnnxFile(encoderFile, 'optimized encoder')
      await validateOnnxFile(decoderFile, 'optimized decoder')
      logger.substep('Optimized models valid')
    },
    {
      arch: TARGET_ARCH,
      decoderFile: path.relative(BUILD_DIR, decoderFile),
      decoderSize,
      encoderFile: path.relative(BUILD_DIR, encoderFile),
      encoderSize,
      platform: TARGET_PLATFORM,
    },
  )
}

/**
 * Export models to output directory.
 */
async function exportModels() {
  logger.step('Exporting Models')

  await safeMkdir(OUTPUT_DIR)

  await fs.copyFile(encoderFile, outputEncoderFile)
  await fs.copyFile(decoderFile, outputDecoderFile)

  if (existsSync(tokenizerFile)) {
    await fs.copyFile(tokenizerFile, outputTokenizerFile)
  }

  const encoderSize = await getFileSize(outputEncoderFile)
  const decoderSize = await getFileSize(outputDecoderFile)

  logger.substep(`Encoder: ${outputEncoderFile} (${encoderSize})`)
  logger.substep(`Decoder: ${outputDecoderFile} (${decoderSize})`)

  logger.success('Models exported')

  // Create checkpoint with comprehensive smoke test.
  await createCheckpoint(
    BUILD_DIR,
    CHECKPOINTS.FINALIZED,
    async () => {
      // Smoke test: Verify exported models with onnxruntime-node.
      await validateOnnxFile(outputEncoderFile, 'exported encoder')
      logger.substep('ONNX protobuf format valid')

      // Comprehensive test: Load model with ONNX Runtime (native Node.js).
      const session = await ort.InferenceSession.create(outputEncoderFile)

      logger.substep('Model loaded successfully')
      logger.substep(`Input names: ${session.inputNames.join(', ')}`)
      logger.substep(`Output names: ${session.outputNames.join(', ')}`)
    },
    {
      arch: TARGET_ARCH,
      decoderFile: path.relative(BUILD_DIR, outputDecoderFile),
      decoderSize,
      encoderFile: path.relative(BUILD_DIR, outputEncoderFile),
      encoderSize,
      platform: TARGET_PLATFORM,
    },
  )
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  logger.step('Building codet5-models')
  logger.info('Converting and optimizing CodeT5 models')
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info(`Quantization: ${QUANT_LEVEL}`)
  logger.info('')

  // Pre-flight checks (centralized in build-infra).
  await checkModelBuildPrerequisites({
    buildDir: BUILD_DIR,
    packageJsonPath,
    packageRoot,
    requiredDiskGB: 2,
  })

  // Build phases.
  await downloadModels()
  await convertToOnnx()
  await quantizeModels()
  await optimizeModels()
  await exportModels()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('Build Complete')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test models with Socket CLI')
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('')
}

// Run build.
main().catch(error => {
  printError('Build Failed')
  logger.error(errorMessage(error))
  throw error
})
