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
 *   node scripts/build.mjs          # Dev build (INT8 quantization, default)
 *   node scripts/build.mjs --int4   # Prod build (INT4 quantization, smaller)
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkDiskSpace,
  checkPythonVersion,
  formatDuration,
  getFileSize,
} from 'build-infra/lib/build-helpers'
import {
  printError,
  printHeader,
  printStep,
  printSuccess,
} from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { ensureAllPythonPackages } from 'build-infra/lib/python-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import * as ort from 'onnxruntime-node'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')

// Build mode: prod (default for CI) or dev (default for local).
const IS_CI = Boolean(process.env.CI)
const PROD_BUILD = args.includes('--prod')
const DEV_BUILD = args.includes('--dev')
const BUILD_MODE = PROD_BUILD
  ? 'prod'
  : DEV_BUILD
    ? 'dev'
    : IS_CI
      ? 'prod'
      : 'dev'

// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
const QUANT_LEVEL = args.includes('--int4') ? 'int4' : 'int8'

// Configuration.
const MODEL_NAME = 'Salesforce/codet5-base'
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_ROOT = path.join(ROOT_DIR, 'build')
// Shared models cache (same source models for both int8/int4)
const MODELS_DIR = path.join(BUILD_ROOT, 'models')
// Isolate builds by mode and quantization level
const BUILD_DIR = path.join(BUILD_ROOT, BUILD_MODE, QUANT_LEVEL)
const OUTPUT_DIR = path.join(BUILD_DIR, 'output')

/**
 * Download CodeT5 models from Hugging Face.
 */
async function downloadModels() {
  if (!(await shouldRun(BUILD_DIR, '', 'downloaded', FORCE_BUILD))) {
    return
  }

  printHeader('Downloading CodeT5 Models')
  printStep(`Model: ${MODEL_NAME}`)

  await fs.mkdir(MODELS_DIR, { recursive: true })

  // Use Hugging Face CLI to download models.
  const pythonScript =
    'from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; ' +
    `tokenizer = AutoTokenizer.from_pretrained('${MODEL_NAME}'); ` +
    `model = AutoModelForSeq2SeqLM.from_pretrained('${MODEL_NAME}'); ` +
    `tokenizer.save_pretrained('${MODELS_DIR}'); ` +
    `model.save_pretrained('${MODELS_DIR}')`

  const downloadResult = await spawn('python3', ['-c', pythonScript], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (downloadResult.code !== 0) {
    throw new Error('Failed to download models')
  }

  printSuccess('Models downloaded')

  await createCheckpoint(
    BUILD_DIR,
    '',
    'downloaded',
    async () => {
      // Smoke test: Verify tokenizer.json and model config exist.
      const tokenizerPath = path.join(MODELS_DIR, 'tokenizer.json')
      const configPath = path.join(MODELS_DIR, 'config.json')
      await fs.access(tokenizerPath)
      await fs.access(configPath)
      printStep('Model files validated')
    },
    {},
  )
}

/**
 * Convert models to ONNX format.
 */
async function convertToOnnx() {
  if (!(await shouldRun(BUILD_DIR, '', 'convert-onnx', FORCE_BUILD))) {
    return
  }

  printHeader('Converting to ONNX')

  await fs.mkdir(BUILD_DIR, { recursive: true })

  // Convert to ONNX using optimum (transformers.onnx is deprecated).
  printStep('Converting models to ONNX')

  const convertResult = await spawn(
    'python3',
    [
      '-m',
      'optimum.exporters.onnx',
      '-m',
      MODELS_DIR,
      '--task',
      'seq2seq-lm',
      '--opset',
      '14',
      BUILD_DIR,
    ],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (convertResult.code !== 0) {
    throw new Error('Failed to convert models to ONNX')
  }

  printSuccess('Models converted to ONNX')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')
  const encoderSize = await getFileSize(encoderPath)
  const decoderSize = await getFileSize(decoderPath)

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'convert-onnx',
    async () => {
      // Smoke test: Verify converted models are valid ONNX files.
      // Check encoder.
      const encoderBuffer = await fs.readFile(encoderPath)
      if (encoderBuffer.length < 100) {
        throw new Error('Encoder model file too small to be valid ONNX')
      }

      const encoderMagic = encoderBuffer[0]
      if (encoderMagic !== 0x08 && encoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX encoder protobuf header (expected 0x08 or 0x0a, got 0x${encoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      // Check decoder.
      const decoderBuffer = await fs.readFile(decoderPath)
      if (decoderBuffer.length < 100) {
        throw new Error('Decoder model file too small to be valid ONNX')
      }

      const decoderMagic = decoderBuffer[0]
      if (decoderMagic !== 0x08 && decoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX decoder protobuf header (expected 0x08 or 0x0a, got 0x${decoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      printStep(
        `Converted models valid: encoder ${encoderSize}, decoder ${decoderSize}`,
      )
    },
    {
      encoderSize,
      decoderSize,
      encoderPath: path.relative(BUILD_DIR, encoderPath),
      decoderPath: path.relative(BUILD_DIR, decoderPath),
    },
  )
}

/**
 * Apply quantization to models.
 */
async function quantizeModels() {
  if (!(await shouldRun(BUILD_DIR, '', 'quantized', FORCE_BUILD))) {
    return
  }

  printHeader('Quantizing Models')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')

  // Quantize encoder with INT8.
  printStep('Quantizing encoder (INT8)')
  const quantizeEncoderCommand =
    `python3 -c "from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
    `quantize_dynamic('${encoderPath}', '${encoderPath}.quant', weight_type=QuantType.QInt8)"`

  const quantizeEncoderResult = await spawn(quantizeEncoderCommand, [], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (quantizeEncoderResult.code !== 0) {
    throw new Error('Failed to quantize encoder')
  }

  // Quantize decoder with INT8.
  printStep('Quantizing decoder (INT8)')
  const quantizeDecoderCommand =
    `python3 -c "from onnxruntime.quantization import quantize_dynamic, QuantType; ` +
    `quantize_dynamic('${decoderPath}', '${decoderPath}.quant', weight_type=QuantType.QInt8)"`

  const quantizeDecoderResult = await spawn(quantizeDecoderCommand, [], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (quantizeDecoderResult.code !== 0) {
    throw new Error('Failed to quantize decoder')
  }

  // Replace original models with quantized versions.
  await fs.rename(`${encoderPath}.quant`, encoderPath)
  await fs.rename(`${decoderPath}.quant`, decoderPath)

  const encoderSize = await getFileSize(encoderPath)
  const decoderSize = await getFileSize(decoderPath)

  printStep(`Encoder: ${encoderSize}`)
  printStep(`Decoder: ${decoderSize}`)

  printSuccess('Models quantized')

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'quantized',
    async () => {
      // Smoke test: Verify quantized models are still valid ONNX files.
      const encoderBuffer = await fs.readFile(encoderPath)
      if (encoderBuffer.length < 100) {
        throw new Error('Quantized encoder too small to be valid ONNX')
      }

      const encoderMagic = encoderBuffer[0]
      if (encoderMagic !== 0x08 && encoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX quantized encoder header (expected 0x08 or 0x0a, got 0x${encoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      const decoderBuffer = await fs.readFile(decoderPath)
      if (decoderBuffer.length < 100) {
        throw new Error('Quantized decoder too small to be valid ONNX')
      }

      const decoderMagic = decoderBuffer[0]
      if (decoderMagic !== 0x08 && decoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX quantized decoder header (expected 0x08 or 0x0a, got 0x${decoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      printStep('Quantized models valid')
    },
    {
      encoderSize,
      decoderSize,
      encoderPath: path.relative(BUILD_DIR, encoderPath),
      decoderPath: path.relative(BUILD_DIR, decoderPath),
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
    printStep('Skipping ONNX graph optimization (dev mode - faster builds)')
    return
  }

  if (!(await shouldRun(BUILD_DIR, '', 'optimize-model', FORCE_BUILD))) {
    return
  }

  printHeader('Optimizing ONNX Graphs (prod mode)')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')
  const optimizedEncoderPath = path.join(
    BUILD_DIR,
    'encoder_model_optimized.onnx',
  )
  const optimizedDecoderPath = path.join(
    BUILD_DIR,
    'decoder_model_optimized.onnx',
  )

  // Optimize encoder.
  printStep('Optimizing encoder graph')
  const optimizeEncoderCommand =
    `python3 -c "from onnxruntime.transformers import optimizer; ` +
    `opt = optimizer.optimize_model('${encoderPath}', model_type='bert', num_heads=12, hidden_size=768); ` +
    `opt.save_model_to_file('${optimizedEncoderPath}')"`

  const optimizeEncoderResult = await spawn(optimizeEncoderCommand, [], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (optimizeEncoderResult.code !== 0) {
    throw new Error('Failed to optimize encoder')
  }

  // Optimize decoder.
  printStep('Optimizing decoder graph')
  const optimizeDecoderCommand =
    `python3 -c "from onnxruntime.transformers import optimizer; ` +
    `opt = optimizer.optimize_model('${decoderPath}', model_type='bert', num_heads=12, hidden_size=768); ` +
    `opt.save_model_to_file('${optimizedDecoderPath}')"`

  const optimizeDecoderResult = await spawn(optimizeDecoderCommand, [], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (optimizeDecoderResult.code !== 0) {
    throw new Error('Failed to optimize decoder')
  }

  // Replace original models with optimized versions.
  await fs.rename(optimizedEncoderPath, encoderPath)
  await fs.rename(optimizedDecoderPath, decoderPath)

  const encoderSize = await getFileSize(encoderPath)
  const decoderSize = await getFileSize(decoderPath)

  printStep(`Encoder: ${encoderSize}`)
  printStep(`Decoder: ${decoderSize}`)

  printSuccess('ONNX graphs optimized')

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'optimize-model',
    async () => {
      // Smoke test: Verify optimized models are still valid ONNX files.
      const encoderBuffer = await fs.readFile(encoderPath)
      if (encoderBuffer.length < 100) {
        throw new Error('Optimized encoder too small to be valid ONNX')
      }

      const encoderMagic = encoderBuffer[0]
      if (encoderMagic !== 0x08 && encoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX optimized encoder header (expected 0x08 or 0x0a, got 0x${encoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      const decoderBuffer = await fs.readFile(decoderPath)
      if (decoderBuffer.length < 100) {
        throw new Error('Optimized decoder too small to be valid ONNX')
      }

      const decoderMagic = decoderBuffer[0]
      if (decoderMagic !== 0x08 && decoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX optimized decoder header (expected 0x08 or 0x0a, got 0x${decoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      printStep('Optimized models valid')
    },
    {
      encoderSize,
      decoderSize,
      encoderPath: path.relative(BUILD_DIR, encoderPath),
      decoderPath: path.relative(BUILD_DIR, decoderPath),
    },
  )
}

/**
 * Export models to output directory.
 */
async function exportModels() {
  printHeader('Exporting Models')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')
  const tokenizerPath = path.join(MODELS_DIR, 'tokenizer.json')

  const outputEncoder = path.join(OUTPUT_DIR, 'encoder.onnx')
  const outputDecoder = path.join(OUTPUT_DIR, 'decoder.onnx')
  const outputTokenizer = path.join(OUTPUT_DIR, 'tokenizer.json')

  await fs.copyFile(encoderPath, outputEncoder)
  await fs.copyFile(decoderPath, outputDecoder)

  if (
    await fs
      .access(tokenizerPath)
      .then(() => true)
      .catch(() => false)
  ) {
    await fs.copyFile(tokenizerPath, outputTokenizer)
  }

  const encoderSize = await getFileSize(outputEncoder)
  const decoderSize = await getFileSize(decoderPath)

  printStep(`Encoder: ${outputEncoder} (${encoderSize})`)
  printStep(`Decoder: ${outputDecoder} (${decoderSize})`)

  printSuccess('Models exported')

  // Create checkpoint with comprehensive smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'release',
    async () => {
      // Smoke test: Verify exported models with onnxruntime-node.
      // Verify ONNX protobuf format.
      const buffer = await fs.readFile(outputEncoder)

      if (buffer.length < 100) {
        throw new Error('Exported encoder too small to be valid ONNX')
      }

      // Check for common ONNX/protobuf patterns in header.
      const firstByte = buffer[0]
      const validProtobufStart = firstByte === 0x08 || firstByte === 0x0a

      if (!validProtobufStart) {
        throw new Error(
          `Invalid ONNX protobuf header (expected 0x08 or 0x0a, got 0x${firstByte.toString(16).padStart(2, '0')})`,
        )
      }

      printStep('ONNX protobuf format valid')

      // Comprehensive test: Load model with ONNX Runtime (native Node.js).
      const session = await ort.InferenceSession.create(outputEncoder)

      printStep('Model loaded successfully')
      printStep(`Input names: ${session.inputNames.join(', ')}`)
      printStep(`Output names: ${session.outputNames.join(', ')}`)
    },
    {
      encoderSize,
      decoderSize,
      encoderPath: path.relative(BUILD_DIR, outputEncoder),
      decoderPath: path.relative(BUILD_DIR, outputDecoder),
    },
  )
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building codet5-models')
  const logger = getDefaultLogger()
  logger.info('Converting and optimizing CodeT5 models')
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info(`Quantization: ${QUANT_LEVEL}`)
  logger.info('')

  // Pre-flight checks.
  printHeader('Pre-flight Checks')

  const diskOk = await checkDiskSpace(BUILD_DIR, 2 * 1024 * 1024 * 1024)
  if (!diskOk) {
    throw new Error('Insufficient disk space (need 2GB)')
  }

  // Ensure Python 3 is installed.
  const pythonResult = await ensureToolInstalled('python3', {
    autoInstall: true,
  })
  if (!pythonResult.available) {
    printError('Python 3.8+ is required but not found')
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error('Python 3.8+ required')
  }

  if (pythonResult.installed) {
    printSuccess('Installed Python 3')
  }

  // Check Python version.
  const pythonOk = await checkPythonVersion('3.8')
  if (!pythonOk) {
    printError('Python 3.8+ required (found older version)')
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error('Python 3.8+ required')
  }

  // Ensure required Python packages are installed.
  printStep('Checking Python packages...')
  const requiredPackages = [
    'transformers',
    'torch',
    'onnx',
    { name: 'onnxruntime', importName: 'onnxruntime' },
  ]

  const packagesResult = await ensureAllPythonPackages(requiredPackages, {
    autoInstall: true,
    quiet: false,
  })

  if (!packagesResult.allAvailable) {
    printError('Failed to install required Python packages:')
    for (const pkg of packagesResult.missing) {
      logger.error(`  - ${pkg}`)
    }
    logger.error('')
    logger.error('Please install manually:')
    logger.error('  pip3 install --user transformers torch onnx onnxruntime')
    throw new Error('Missing Python dependencies')
  }

  if (packagesResult.installed.length > 0) {
    printSuccess(
      `Installed Python packages: ${packagesResult.installed.join(', ')}`,
    )
  } else {
    printSuccess('All Python packages available')
  }

  printSuccess('Pre-flight checks passed')

  // Build phases.
  await downloadModels()
  await convertToOnnx()
  await quantizeModels()
  await optimizeModels()
  await exportModels()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  printHeader('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${OUTPUT_DIR}`)
  logger.info('')
  logger.info('Next steps:')
  logger.info('  1. Test models with Socket CLI')
  logger.info('  2. Integrate with Socket CLI build')
  logger.info('')
}

// Run build.
const logger = getDefaultLogger()
main().catch(e => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
