#!/usr/bin/env node
/**
 * MiniLM Model Builder
 *
 * Converts and optimizes MiniLM models for Socket CLI:
 * 1. Download models from Hugging Face
 * 2. Convert to ONNX format
 * 3. Apply INT4/INT8 mixed-precision quantization
 * 4. Optimize ONNX graphs
 * 5. Verify inference
 * 6. Export to distribution location
 *
 * Usage:
 *   node scripts/build.mjs          # Dev build (INT8 quantization, default)
 *   node scripts/build.mjs --int4   # Prod build (INT4 quantization, smaller)
 *   node scripts/build.mjs --force  # Force rebuild (ignore checkpoints)
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  checkDiskSpace,
  checkPythonVersion,
  formatDuration,
  freeDiskSpace,
  getFileSize,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { ensureAllPythonPackages } from 'build-infra/lib/python-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'

import { which } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { PYTHON_DIR, getBuildPaths, getModelPaths } from './paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const logger = getDefaultLogger()

// Load Python packages from external-tools.json
const packageRoot = path.join(__dirname, '..')
const externalToolsPath = path.join(packageRoot, 'external-tools.json')
const externalToolsData = JSON.parse(readFileSync(externalToolsPath, 'utf8'))
const externalTools = externalToolsData.tools || {}

// Load package.json for sources configuration
const packageJsonPath = path.join(__dirname, '..', 'package.json')
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))

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
// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
const QUANT_LEVEL = args.includes('--int4') ? 'int4' : 'int8'

// Get paths from source of truth
const {
  buildDir: BUILD_DIR,
  cacheDir: CACHE_DIR,
  modelsDir: MODELS_DIR,
} = getBuildPaths(QUANT_LEVEL)

// Model configuration - Read model source from package.json.
const minilmSource = packageJson.sources?.minilm
if (!minilmSource) {
  throw new Error(
    'Missing sources.minilm in package.json. Please add source metadata.',
  )
}
// For HuggingFace, version contains the model identifier
const MODELS = [
  {
    name: minilmSource.version,
    outputName: 'minilm',
    hiddenSize: 384,
    numHeads: 12,
  },
]

/**
 * Run Python script and parse JSON output.
 */
async function runPythonScript(scriptName, args, options = {}) {
  const scriptPath = path.join(PYTHON_DIR, scriptName)

  const python3Path = await which('python3', { nothrow: true })
  if (!python3Path) {
    throw new Error('python3 not found in PATH')
  }

  const result = await spawn(python3Path, [scriptPath, ...args], {
    ...options,
  })

  if (result.code !== 0) {
    throw new Error(`Python script failed: ${result.stderr}`)
  }

  // Parse JSON output from Python script.
  const lines = result.stdout.split('\n').filter(Boolean)
  const results = []

  for (const line of lines) {
    try {
      const parsedResult = JSON.parse(line)
      results.push(parsedResult)

      if (parsedResult.error) {
        throw new Error(parsedResult.error)
      }

      if (parsedResult.code && parsedResult.code !== 'complete') {
        logger.substep(`  ${parsedResult.code.replace(/_/g, ' ')}...`)
      }
    } catch (e) {
      if (e.message.startsWith('{')) {
        continue
      }
      throw e
    }
  }

  return results[results.length - 1] || {}
}

/**
 * Download models from Hugging Face.
 */
async function downloadModels() {
  if (!(await shouldRun(BUILD_DIR, 'minilm', 'downloaded', FORCE_BUILD))) {
    return
  }

  logger.step('Downloading Models from Hugging Face')

  await fs.mkdir(CACHE_DIR, { recursive: true })

  for (const model of MODELS) {
    logger.substep(`Model: ${model.name}`)

    try {
      const { cacheModelDir } = getModelPaths(QUANT_LEVEL, model.outputName)
      await runPythonScript('download.py', [model.name, cacheModelDir])
      logger.success(`Downloaded: ${model.name}`)
    } catch (e) {
      if (e.message.includes('transformers not installed')) {
        logger.warn('Python transformers library not installed')
        logger.warn('Install with: pip install transformers')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Model download complete')
  await createCheckpoint(BUILD_DIR, 'minilm', 'downloaded', async () => {
    // Smoke test: Verify model cache directory exists
    if (!existsSync(CACHE_DIR)) {
      throw new Error('Model cache directory not found')
    }
    logger.substep('Model cache validated')
  })
}

/**
 * Convert models to ONNX format.
 */
async function convertToOnnx() {
  if (!(await shouldRun(BUILD_DIR, 'minilm', 'converted', FORCE_BUILD))) {
    return
  }

  logger.step('Converting Models to ONNX')

  await fs.mkdir(MODELS_DIR, { recursive: true })

  for (const model of MODELS) {
    logger.substep(`Converting: ${model.name}`)

    try {
      const { cacheModelDir, onnxModelDir } = getModelPaths(
        QUANT_LEVEL,
        model.outputName,
      )

      await runPythonScript('convert.py', [cacheModelDir, onnxModelDir])
      logger.success(`Converted: ${model.name}`)
    } catch (e) {
      if (e.message.includes('optimum')) {
        logger.warn('Python optimum library not installed')
        logger.warn('Install with: pip install optimum[onnxruntime]')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('ONNX conversion complete')
  await createCheckpoint(BUILD_DIR, 'minilm', 'converted', async () => {
    // Smoke test: Verify ONNX models exist
    for (const model of MODELS) {
      const { onnxModelFile } = getModelPaths(QUANT_LEVEL, model.outputName)
      if (!existsSync(onnxModelFile)) {
        throw new Error(`Converted model not found: ${onnxModelFile}`)
      }
    }
    logger.substep('Converted ONNX models validated')
  })
}

/**
 * Apply mixed-precision quantization.
 */
async function quantizeModels() {
  if (!(await shouldRun(BUILD_DIR, 'minilm', 'quantized', FORCE_BUILD))) {
    return
  }

  logger.step('Applying INT8 Quantization')

  for (const model of MODELS) {
    logger.substep(`Quantizing: ${model.outputName}`)

    try {
      const {
        optimizedModelDir,
        optimizedModelFile,
        quantizedModelDir,
        quantizedModelFile,
      } = getModelPaths(QUANT_LEVEL, model.outputName)

      const sizeBefore = await getFileSize(optimizedModelFile)
      logger.substep(`  Size before: ${sizeBefore}`)

      await runPythonScript('quantize.py', [
        optimizedModelDir,
        quantizedModelDir,
      ])

      const sizeAfter = await getFileSize(quantizedModelFile)
      logger.substep(`  Size after: ${sizeAfter}`)

      logger.success(`Quantized: ${model.outputName}`)
    } catch (e) {
      if (e.message.includes('optimum')) {
        logger.warn('Python optimum library not installed')
        logger.warn('Install with: pip install optimum[onnxruntime]')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Quantization complete')
  await createCheckpoint(BUILD_DIR, 'minilm', 'quantized', async () => {
    // Smoke test: Verify quantized models exist
    for (const model of MODELS) {
      const { quantizedModelFile } = getModelPaths(
        QUANT_LEVEL,
        model.outputName,
      )
      if (!existsSync(quantizedModelFile)) {
        throw new Error(`Quantized model not found: ${quantizedModelFile}`)
      }
    }
    logger.substep('Quantized models validated')
  })
}

/**
 * Optimize ONNX graphs.
 */
async function optimizeGraphs() {
  if (!(await shouldRun(BUILD_DIR, 'minilm', 'optimized', FORCE_BUILD))) {
    return
  }

  logger.step('Optimizing ONNX Graphs')

  for (const model of MODELS) {
    logger.substep(`Optimizing: ${model.outputName}`)

    try {
      const { onnxModelFile, optimizedModelFile } = getModelPaths(
        QUANT_LEVEL,
        model.outputName,
      )

      const sizeBefore = await getFileSize(onnxModelFile)
      logger.substep(`  Size before: ${sizeBefore}`)

      await runPythonScript('optimize.py', [
        onnxModelFile,
        optimizedModelFile,
        String(model.numHeads),
        String(model.hiddenSize),
      ])

      const sizeAfter = await getFileSize(optimizedModelFile)
      logger.substep(`  Size after: ${sizeAfter}`)

      logger.success(`Optimized: ${model.outputName}`)
    } catch (e) {
      if (e.message.includes('onnxruntime not installed')) {
        logger.warn('Python onnxruntime library not installed')
        logger.warn('Install with: pip install onnxruntime')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Graph optimization complete')
  await createCheckpoint(BUILD_DIR, 'minilm', 'optimized', async () => {
    // Smoke test: Verify optimized models exist
    for (const model of MODELS) {
      const { optimizedModelFile } = getModelPaths(
        QUANT_LEVEL,
        model.outputName,
      )
      if (!existsSync(optimizedModelFile)) {
        throw new Error(`Optimized model not found: ${optimizedModelFile}`)
      }
    }
    logger.substep('Optimized models validated')
  })
}

/**
 * Verify models work correctly.
 */
async function verifyModels() {
  if (!(await shouldRun(BUILD_DIR, 'minilm', 'verified', FORCE_BUILD))) {
    return
  }

  logger.step('Verifying Model Inference')

  for (const model of MODELS) {
    logger.substep(`Verifying: ${model.outputName}`)

    try {
      const { quantizedModelDir, quantizedModelFile } = getModelPaths(
        QUANT_LEVEL,
        model.outputName,
      )
      const testText = 'This is a test'

      const result = await runPythonScript('verify.py', [
        quantizedModelFile,
        quantizedModelDir,
        testText,
      ])

      logger.substep(`  Test: "${result.test_text}"`)
      logger.substep(`  Output shape: [${result.output_shape.join(', ')}]`)
      logger.substep(
        `  Mean: ${result.output_mean.toFixed(4)}, Std: ${result.output_std.toFixed(4)}`,
      )

      logger.success(`Verified: ${model.outputName}`)
    } catch (e) {
      if (e.message.includes('not installed')) {
        logger.warn('Missing Python dependencies')
        logger.warn('Install with: pip install onnxruntime transformers')
        throw new Error('Missing Python dependencies')
      }
      throw e
    }
  }

  logger.success('Model verification complete')
  await createCheckpoint(BUILD_DIR, 'minilm', 'verified', async () => {
    // Smoke test: Verify quantized models exist
    for (const model of MODELS) {
      const { quantizedModelFile } = getModelPaths(
        QUANT_LEVEL,
        model.outputName,
      )
      if (!existsSync(quantizedModelFile)) {
        throw new Error(`Verified model not found: ${quantizedModelFile}`)
      }
    }
    logger.substep('Verified models validated')
  })
}

/**
 * Export models to distribution location.
 */
async function exportModels() {
  logger.step('Exporting Models')

  for (const model of MODELS) {
    logger.substep(`Exporting: ${model.outputName}`)

    const {
      finalModelFile,
      quantizedModelDir,
      quantizedModelFile,
      tokenizerDir,
    } = getModelPaths(QUANT_LEVEL, model.outputName)

    // Check if quantized model exists.
    if (!existsSync(quantizedModelFile)) {
      logger.warn(`Model not found: ${quantizedModelFile}`)
      logger.warn('Run build to generate models')
      continue
    }

    // Copy quantized model to final location.
    await fs.copyFile(quantizedModelFile, finalModelFile)

    // Copy tokenizer files.
    await fs.mkdir(tokenizerDir, { recursive: true })

    const tokenizerFiles = [
      'tokenizer.json',
      'tokenizer_config.json',
      'special_tokens_map.json',
      'vocab.txt',
    ]
    for (const file of tokenizerFiles) {
      const src = path.join(quantizedModelDir, file)
      const dst = path.join(tokenizerDir, file)

      if (existsSync(src)) {
        await fs.copyFile(src, dst)
      }
    }

    const modelSize = await getFileSize(finalModelFile)
    logger.substep(`  Model: ${modelSize}`)
    logger.substep(`  Location: ${finalModelFile}`)
  }

  logger.success('Export complete')
}

/**
 * Main build function.
 */
async function main() {
  const totalStart = Date.now()

  logger.step('🤖 Building minilm models')
  logger.info('MiniLM model conversion and optimization')
  logger.info('')

  // Pre-flight checks.
  logger.step('Pre-flight Checks')

  // Free up disk space (CI environments)
  await freeDiskSpace()

  const diskOk = await checkDiskSpace(BUILD_DIR, 1 * 1024 * 1024 * 1024)
  if (!diskOk) {
    logger.warn('Could not check disk space')
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
    logger.success('Installed Python 3')
  }

  // Check Python version.
  const pythonOk = await checkPythonVersion('3.8')
  if (!pythonOk) {
    printError('Python 3.8+ required (found older version)')
    printError('Install Python from: https://www.python.org/downloads/')
    throw new Error('Python 3.8+ required')
  }

  // Ensure required Python packages are installed.
  logger.substep('Checking Python packages...')

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
    logger.success(
      `Installed Python packages: ${packagesResult.installed.join(', ')}`,
    )
  } else {
    logger.success('All Python packages available')
  }

  logger.success('Pre-flight checks passed')

  // Build phases.
  await downloadModels()
  await convertToOnnx()
  await optimizeGraphs()
  await quantizeModels()
  await verifyModels()
  await exportModels()

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('🎉 Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${MODELS_DIR}`)
  logger.info('')
  logger.info('Models ready for use:')
  for (const model of MODELS) {
    logger.info(`  - ${model.outputName}.onnx`)
    logger.info(`  - ${model.outputName}-tokenizer/`)
  }
  logger.info('')
}

// Run build.
main().catch(e => {
  printError('Build Failed')
  logger.error(e.message)
  throw e
})
