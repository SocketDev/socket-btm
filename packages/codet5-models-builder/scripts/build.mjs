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

import { promises as fs, readFileSync } from 'node:fs'
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
import * as ort from 'onnxruntime-node'

import { which } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { MODELS_DIR, getBuildPaths } from './paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load Python packages from package.json externalTools
const packageJsonPath = path.join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
const externalTools = packageJson.externalTools || {}

// Extract Python package names from externalTools
const pythonPackages = Object.entries(externalTools)
  .filter(([_, config]) => config.type === 'python')
  .map(([name]) => {
    // Handle packages that need special import names
    if (name === 'onnxruntime') {
      return { name, importName: 'onnxruntime' }
    }
    return name
  })

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

// Get paths from source of truth
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
} = getBuildPaths(BUILD_MODE, QUANT_LEVEL)

// Configuration.
const MODEL_NAME = 'Salesforce/codet5-base'

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

  const python3Path = await which('python3', { nothrow: true })
  if (!python3Path) {
    throw new Error('python3 not found in PATH')
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

  printSuccess('Models downloaded')

  await createCheckpoint(
    BUILD_DIR,
    '',
    'downloaded',
    async () => {
      // Smoke test: Verify tokenizer.json and model config exist.
      await fs.access(tokenizerFile)
      await fs.access(configFile)
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

  const python3Path = await which('python3', { nothrow: true })
  if (!python3Path) {
    throw new Error('python3 not found in PATH')
  }

  // Convert to ONNX using optimum (transformers.onnx is deprecated).
  printStep('Converting models to ONNX')

  // Use opset 14 for both prod and dev (opset 13 lacks aten::triu support).
  const opsetVersion = '14'
  const convertResult = await spawn(
    python3Path,
    [
      '-m',
      'optimum.exporters.onnx',
      '-m',
      MODELS_DIR,
      '--task',
      'seq2seq-lm',
      '--opset',
      opsetVersion,
      BUILD_DIR,
    ],
    {
      stdio: 'inherit',
    },
  )

  if (convertResult.code !== 0) {
    throw new Error('Failed to convert models to ONNX')
  }

  printSuccess('Models converted to ONNX')

  // encoderFile replaced with encoderFile
  // decoderFile replaced with decoderFile
  const encoderSize = await getFileSize(encoderFile)
  const decoderSize = await getFileSize(decoderFile)

  // Create checkpoint with smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'convert-onnx',
    async () => {
      // Smoke test: Verify converted models are valid ONNX files.
      // Check encoder.
      const encoderBuffer = await fs.readFile(encoderFile)
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
      const decoderBuffer = await fs.readFile(decoderFile)
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
      encoderFile: path.relative(BUILD_DIR, encoderFile),
      decoderFile: path.relative(BUILD_DIR, decoderFile),
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

  // encoderFile replaced with encoderFile
  // decoderFile replaced with decoderFile

  // Quantize encoder with INT8.
  printStep('Quantizing encoder (INT8)')
  const quantizeEncoderScript =
    'from onnxruntime.quantization import quantize_dynamic, QuantType; ' +
    `quantize_dynamic('${encoderFile}', '${encoderFile}.quant', weight_type=QuantType.QInt8)`

  const python3Path = await which('python3', { nothrow: true })
  if (!python3Path) {
    throw new Error('python3 not found in PATH')
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
  printStep('Quantizing decoder (INT8)')
  const quantizeDecoderScript =
    'from onnxruntime.quantization import quantize_dynamic, QuantType; ' +
    `quantize_dynamic('${decoderFile}', '${decoderFile}.quant', weight_type=QuantType.QInt8)`

  const python3PathDecoder = await which('python3', { nothrow: true })
  if (!python3PathDecoder) {
    throw new Error('python3 not found in PATH')
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
      const encoderBuffer = await fs.readFile(encoderFile)
      if (encoderBuffer.length < 100) {
        throw new Error('Quantized encoder too small to be valid ONNX')
      }

      const encoderMagic = encoderBuffer[0]
      if (encoderMagic !== 0x08 && encoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX quantized encoder header (expected 0x08 or 0x0a, got 0x${encoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      const decoderBuffer = await fs.readFile(decoderFile)
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
      encoderFile: path.relative(BUILD_DIR, encoderFile),
      decoderFile: path.relative(BUILD_DIR, decoderFile),
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

  // encoderFile replaced with encoderFile
  // decoderFile replaced with decoderFile
  const optimizedEncoderPath = path.join(
    BUILD_DIR,
    'encoder_model_optimized.onnx',
  )
  const optimizedDecoderPath = path.join(
    BUILD_DIR,
    'decoder_model_optimized.onnx',
  )

  // Resolve python3 path for optimization
  const python3PathOpt = await which('python3', { nothrow: true })
  if (!python3PathOpt) {
    throw new Error('python3 not found in PATH')
  }

  // Optimize encoder.
  printStep('Optimizing encoder graph')
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
  printStep('Optimizing decoder graph')
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
      const encoderBuffer = await fs.readFile(encoderFile)
      if (encoderBuffer.length < 100) {
        throw new Error('Optimized encoder too small to be valid ONNX')
      }

      const encoderMagic = encoderBuffer[0]
      if (encoderMagic !== 0x08 && encoderMagic !== 0x0a) {
        throw new Error(
          `Invalid ONNX optimized encoder header (expected 0x08 or 0x0a, got 0x${encoderMagic.toString(16).padStart(2, '0')})`,
        )
      }

      const decoderBuffer = await fs.readFile(decoderFile)
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
      encoderFile: path.relative(BUILD_DIR, encoderFile),
      decoderFile: path.relative(BUILD_DIR, decoderFile),
    },
  )
}

/**
 * Export models to output directory.
 */
async function exportModels() {
  printHeader('Exporting Models')

  await fs.mkdir(OUTPUT_DIR, { recursive: true })

  // encoderFile replaced with encoderFile
  // decoderFile replaced with decoderFile
  // tokenizerFile replaced with tokenizerFile

  // outputEncoderFile replaced with outputEncoderFileFile
  // outputDecoderFile replaced with outputDecoderFileFile
  // outputTokenizerFile replaced with outputTokenizerFileFile

  await fs.copyFile(encoderFile, outputEncoderFile)
  await fs.copyFile(decoderFile, outputDecoderFile)

  if (
    await fs
      .access(tokenizerFile)
      .then(() => true)
      .catch(() => false)
  ) {
    await fs.copyFile(tokenizerFile, outputTokenizerFile)
  }

  const encoderSize = await getFileSize(outputEncoderFile)
  const decoderSize = await getFileSize(decoderFile)

  printStep(`Encoder: ${outputEncoderFile} (${encoderSize})`)
  printStep(`Decoder: ${outputDecoderFile} (${decoderSize})`)

  printSuccess('Models exported')

  // Create checkpoint with comprehensive smoke test.
  await createCheckpoint(
    BUILD_DIR,
    '',
    'release',
    async () => {
      // Smoke test: Verify exported models with onnxruntime-node.
      // Verify ONNX protobuf format.
      const buffer = await fs.readFile(outputEncoderFile)

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
      const session = await ort.InferenceSession.create(outputEncoderFile)

      printStep('Model loaded successfully')
      printStep(`Input names: ${session.inputNames.join(', ')}`)
      printStep(`Output names: ${session.outputNames.join(', ')}`)
    },
    {
      encoderSize,
      decoderSize,
      encoderFile: path.relative(BUILD_DIR, outputEncoderFile),
      decoderFile: path.relative(BUILD_DIR, outputDecoderFile),
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

  const packagesResult = await ensureAllPythonPackages(pythonPackages, {
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
    logger.error(
      `  pip3 install --user ${pythonPackages.map(p => (typeof p === 'string' ? p : p.name)).join(' ')}`,
    )
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
