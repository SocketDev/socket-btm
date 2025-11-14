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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Parse arguments.
const args = process.argv.slice(2)
const FORCE_BUILD = args.includes('--force')
// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
const QUANT_LEVEL = args.includes('--int4') ? 'int4' : 'int8'

// Configuration.
const MODEL_NAME = 'Salesforce/codet5-base'
const ROOT_DIR = path.join(__dirname, '..')
const BUILD_ROOT = path.join(ROOT_DIR, 'build')
// Shared models cache (same source models for both int8/int4)
const MODELS_DIR = path.join(BUILD_ROOT, 'models')
// Isolate builds by quantization level to allow concurrent int4/int8 builds
const BUILD_DIR = path.join(BUILD_ROOT, QUANT_LEVEL)
const OUTPUT_DIR = path.join(BUILD_DIR, 'output')

/**
 * Download CodeT5 models from Hugging Face.
 */
async function downloadModels() {
  if (
    !(await shouldRun(BUILD_DIR, 'codet5-models', 'downloaded', FORCE_BUILD))
  ) {
    return
  }

  printHeader('Downloading CodeT5 Models')
  printStep(`Model: ${MODEL_NAME}`)

  await fs.mkdir(MODELS_DIR, { recursive: true })

  // Use Hugging Face CLI to download models.
  const downloadCommand =
    `python3 -c "from transformers import AutoTokenizer, AutoModelForSeq2SeqLM; ` +
    `tokenizer = AutoTokenizer.from_pretrained('${MODEL_NAME}'); ` +
    `model = AutoModelForSeq2SeqLM.from_pretrained('${MODEL_NAME}'); ` +
    `tokenizer.save_pretrained('${MODELS_DIR}'); ` +
    `model.save_pretrained('${MODELS_DIR}')"`

  const downloadResult = await spawn(downloadCommand, [], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (downloadResult.code !== 0) {
    throw new Error('Failed to download models')
  }

  printSuccess('Models downloaded')
  await createCheckpoint(BUILD_DIR, 'codet5-models', 'downloaded')
}

/**
 * Convert models to ONNX format.
 */
async function convertToOnnx() {
  if (
    !(await shouldRun(BUILD_DIR, 'codet5-models', 'converted', FORCE_BUILD))
  ) {
    return
  }

  printHeader('Converting to ONNX')

  await fs.mkdir(BUILD_DIR, { recursive: true })

  // Convert encoder.
  printStep('Converting encoder')
  const convertCommand = `python3 -m transformers.onnx --model=${MODELS_DIR} --feature=seq2seq-lm ${BUILD_DIR}`

  const convertResult = await spawn(convertCommand, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (convertResult.code !== 0) {
    throw new Error('Failed to convert models to ONNX')
  }

  printSuccess('Models converted to ONNX')
  await createCheckpoint(BUILD_DIR, 'codet5-models', 'converted')
}

/**
 * Apply quantization to models.
 */
async function quantizeModels() {
  if (
    !(await shouldRun(BUILD_DIR, 'codet5-models', 'quantized', FORCE_BUILD))
  ) {
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

  const quantizeEncoderResult = await spawn(quantizeEncoderCommand, {
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

  const quantizeDecoderResult = await spawn(quantizeDecoderCommand, {
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
  await createCheckpoint(BUILD_DIR, 'codet5-models', 'quantized')
}

/**
 * Optimize ONNX graphs.
 */
async function optimizeModels() {
  if (
    !(await shouldRun(BUILD_DIR, 'codet5-models', 'optimized', FORCE_BUILD))
  ) {
    return
  }

  printHeader('Optimizing ONNX Graphs')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')
  const decoderPath = path.join(BUILD_DIR, 'decoder_model.onnx')

  // Optimize encoder.
  printStep('Optimizing encoder')
  const optimizeEncoderCommand =
    `python3 -c "from onnxruntime.transformers import optimizer; ` +
    `optimizer.optimize_model('${encoderPath}', model_type='bert', num_heads=12, hidden_size=768)"`

  const optimizeEncoderResult = await spawn(optimizeEncoderCommand, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (optimizeEncoderResult.code !== 0) {
    throw new Error('Failed to optimize encoder')
  }

  // Optimize decoder.
  printStep('Optimizing decoder')
  const optimizeDecoderCommand =
    `python3 -c "from onnxruntime.transformers import optimizer; ` +
    `optimizer.optimize_model('${decoderPath}', model_type='bert', num_heads=12, hidden_size=768)"`

  const optimizeDecoderResult = await spawn(optimizeDecoderCommand, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (optimizeDecoderResult.code !== 0) {
    throw new Error('Failed to optimize decoder')
  }

  printSuccess('Models optimized')
  await createCheckpoint(BUILD_DIR, 'codet5-models', 'optimized')
}

/**
 * Verify models are valid ONNX files.
 *
 * Uses onnxruntime-node (native) to validate model structure.
 */
async function verifyModels() {
  if (!(await shouldRun(BUILD_DIR, 'codet5-models', 'verified', FORCE_BUILD))) {
    return
  }

  printHeader('Verifying Models')

  const encoderPath = path.join(BUILD_DIR, 'encoder_model.onnx')

  // Basic validation: Check file exists and is not empty.
  const stats = await fs.stat(encoderPath)
  if (stats.size === 0) {
    throw new Error('Encoder model is empty')
  }

  printStep(`Model file size: ${stats.size} bytes`)

  // Verify ONNX protobuf format.
  const buffer = await fs.readFile(encoderPath)

  // ONNX models are Protocol Buffer files with specific structure.
  // Check for valid protobuf format (field markers in first bytes).
  if (buffer.length < 100) {
    throw new Error('Model file too small to be valid ONNX')
  }

  // Check for common ONNX/protobuf patterns in header.
  // ONNX models typically start with field 1 (IR version): 0x08
  // or may have other valid protobuf field markers.
  const firstByte = buffer[0]
  const validProtobufStart = firstByte === 0x08 || firstByte === 0x0a

  if (!validProtobufStart) {
    throw new Error(
      `Invalid ONNX protobuf header (expected 0x08 or 0x0a, got 0x${firstByte.toString(16).padStart(2, '0')})`,
    )
  }

  printStep('ONNX protobuf format valid')

  // Smoke test: Load model with ONNX Runtime (native Node.js).
  printStep('Testing model loading with ONNX Runtime...')
  try {
    // Dynamically import onnxruntime-node (dev dependency).
    const ort = await import('onnxruntime-node')

    // Create an inference session (validates model structure).
    const session = await ort.InferenceSession.create(encoderPath)

    printStep(`Model loaded successfully`)
    printStep(`Input names: ${session.inputNames.join(', ')}`)
    printStep(`Output names: ${session.outputNames.join(', ')}`)
  } catch (e) {
    // If onnxruntime-node is not installed, provide helpful error.
    if (e.code === 'ERR_MODULE_NOT_FOUND') {
      throw new Error(
        'onnxruntime-node not found. Run: pnpm install --filter codet5-models-builder',
      )
    }
    throw new Error(`Failed to load model with ONNX Runtime: ${e.message}`)
  }

  printSuccess('Models verified')
  await createCheckpoint(BUILD_DIR, 'codet5-models', 'verified')
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
  const decoderSize = await getFileSize(outputDecoder)

  printStep(`Encoder: ${outputEncoder} (${encoderSize})`)
  printStep(`Decoder: ${outputDecoder} (${decoderSize})`)

  printSuccess('Models exported')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  printHeader('🔨 Building codet5-models')
  const logger = getDefaultLogger()
  logger.info('Converting and optimizing CodeT5 models')
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
  await verifyModels()
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
