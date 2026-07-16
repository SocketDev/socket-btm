/**
 * @file CodeT5 build phase workers — download, convert, quantize, optimize,
 *   export. Split out of build.mts (the orchestrator) to keep that file under
 *   the fleet's file-size cap; each phase takes the shared build context
 *   (`ctx`) computed once by `build.mts`'s `initBuildContext()`.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { validateOnnxFile } from 'build-infra/lib/onnx-helpers'
import { getPythonCommand } from 'build-infra/lib/python-installer'
import { errorMessage } from 'build-infra/lib/error-utils'
import * as ort from 'onnxruntime-node'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { MODELS_DIR } from './paths.mts'

const logger = getDefaultLogger()

/**
 * Download CodeT5 models from Hugging Face.
 */
export async function downloadModels(ctx) {
  const {
    buildDir,
    forceBuild,
    modelName,
    packageRoot,
    targetArch,
    targetPlatform,
    tokenizerFile,
    configFile,
  } = ctx
  if (!(await shouldRun(buildDir, '', CHECKPOINTS.DOWNLOADED, forceBuild))) {
    return
  }

  logger.step('Downloading CodeT5 Models')
  logger.substep(`Model: ${modelName}`)

  await safeMkdir(MODELS_DIR)

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  // Use argv-driven helper (not inline `-c` interpolation) so a model id
  // containing a quote or backslash escape can't break out of a Python
  // string literal and execute arbitrary code in the build runner.
  const downloadScriptPath = path.join(packageRoot, 'python', 'download.py')
  const downloadResult = await spawn(
    python3Path,
    [downloadScriptPath, modelName, MODELS_DIR],
    { stdio: 'inherit' },
  )

  if (downloadResult.code !== 0) {
    throw new Error('Failed to download models')
  }

  logger.success('Models downloaded')

  await createCheckpoint(
    buildDir,
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
    { arch: targetArch, platform: targetPlatform },
  )
}

/**
 * Convert models to ONNX format.
 */
export async function convertToOnnx(ctx) {
  const {
    buildDir,
    decoderFile,
    dirname,
    encoderFile,
    forceBuild,
    targetArch,
    targetPlatform,
  } = ctx
  if (!(await shouldRun(buildDir, '', CHECKPOINTS.CONVERTED, forceBuild))) {
    return
  }

  logger.step('Converting to ONNX')

  await safeMkdir(buildDir)

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  // Convert to ONNX using native torch.onnx.export via convert.py script.
  logger.substep('Converting models to ONNX')

  // Use opset 14 for both prod and dev (opset 13 lacks aten::triu support).
  const opsetVersion = '14'
  const convertScriptPath = path.join(dirname, '..', 'python', 'convert.py')

  // Run conversion with JSON output protocol
  const convertResult = await spawn(
    python3Path,
    [convertScriptPath, MODELS_DIR, buildDir, opsetVersion],
    {
      stdio: ['pipe', 'pipe', 'inherit'],
    },
  )

  // Parse JSON output from convert.py
  if (convertResult.stdout) {
    const lines = convertResult.stdout.toString().trim().split('\n')
    for (let i = 0, { length } = lines; i < length; i += 1) {
      const line = lines[i]
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
    buildDir,
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
      arch: targetArch,
      decoderFile: path.relative(buildDir, decoderFile),
      decoderSize,
      encoderFile: path.relative(buildDir, encoderFile),
      encoderSize,
      platform: targetPlatform,
    },
  )
}

/**
 * Apply quantization to models.
 */
export async function quantizeModels(ctx) {
  const {
    buildDir,
    decoderFile,
    encoderFile,
    forceBuild,
    packageRoot,
    targetArch,
    targetPlatform,
  } = ctx
  if (!(await shouldRun(buildDir, '', CHECKPOINTS.QUANTIZED, forceBuild))) {
    return
  }

  logger.step('Quantizing Models')

  const python3Path = await getPythonCommand()
  if (!python3Path) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  const quantizeScriptPath = path.join(packageRoot, 'python', 'quantize.py')

  logger.substep('Quantizing encoder (INT8)')
  const quantizeEncoderResult = await spawn(
    python3Path,
    [quantizeScriptPath, encoderFile, `${encoderFile}.quant`],
    { stdio: 'inherit' },
  )
  if (quantizeEncoderResult.code !== 0) {
    throw new Error('Failed to quantize encoder')
  }

  logger.substep('Quantizing decoder (INT8)')
  const quantizeDecoderResult = await spawn(
    python3Path,
    [quantizeScriptPath, decoderFile, `${decoderFile}.quant`],
    { stdio: 'inherit' },
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
    buildDir,
    CHECKPOINTS.QUANTIZED,
    async () => {
      // Smoke test: Verify quantized models are still valid ONNX files.
      await validateOnnxFile(encoderFile, 'quantized encoder')
      await validateOnnxFile(decoderFile, 'quantized decoder')
      logger.substep('Quantized models valid')
    },
    {
      arch: targetArch,
      decoderFile: path.relative(buildDir, decoderFile),
      decoderSize,
      encoderFile: path.relative(buildDir, encoderFile),
      encoderSize,
      platform: targetPlatform,
    },
  )
}

/**
 * Optimize ONNX graphs with transformer-specific optimizations (prod mode
 * only).
 *
 * Uses onnxruntime.transformers.optimizer to apply graph optimizations like:
 * - Fusing operations (LayerNorm, Attention)
 * - Constant folding
 * - Removing redundant nodes.
 *
 * In dev mode (int8), skip this for faster builds.
 * In prod mode (int4), apply optimizations for maximum performance.
 */
export async function optimizeModels(ctx) {
  const {
    buildDir,
    decoderFile,
    encoderFile,
    forceBuild,
    packageRoot,
    quantLevel,
    targetArch,
    targetPlatform,
  } = ctx
  // Skip optimization in dev mode (int8 - faster iteration).
  if (quantLevel === 'int8') {
    logger.substep(
      'Skipping ONNX graph optimization (dev mode - faster builds)',
    )
    return
  }

  if (!(await shouldRun(buildDir, '', CHECKPOINTS.OPTIMIZED, forceBuild))) {
    return
  }

  logger.step('Optimizing ONNX Graphs (prod mode)')

  const optimizedEncoderPath = path.join(
    buildDir,
    'encoder_model_optimized.onnx',
  )
  const optimizedDecoderPath = path.join(
    buildDir,
    'decoder_model_optimized.onnx',
  )

  // Resolve python path for optimization (uses pip-associated Python)
  const python3PathOpt = await getPythonCommand()
  if (!python3PathOpt) {
    throw new Error('Python not found (checked pip shebang and PATH)')
  }

  // Argv-driven optimization helper — avoids the Python-`-c` injection
  // shape on file paths. Same script handles encoder + decoder.
  const optimizeScriptPath = path.join(packageRoot, 'python', 'optimize.py')

  logger.substep('Optimizing encoder graph')
  const optimizeEncoderResult = await spawn(
    python3PathOpt,
    [optimizeScriptPath, encoderFile, optimizedEncoderPath, '12', '768'],
    { stdio: 'inherit' },
  )
  if (optimizeEncoderResult.code !== 0) {
    throw new Error('Failed to optimize encoder')
  }

  logger.substep('Optimizing decoder graph')
  const optimizeDecoderResult = await spawn(
    python3PathOpt,
    [optimizeScriptPath, decoderFile, optimizedDecoderPath, '12', '768'],
    { stdio: 'inherit' },
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
    buildDir,
    CHECKPOINTS.OPTIMIZED,
    async () => {
      // Smoke test: Verify optimized models are still valid ONNX files.
      await validateOnnxFile(encoderFile, 'optimized encoder')
      await validateOnnxFile(decoderFile, 'optimized decoder')
      logger.substep('Optimized models valid')
    },
    {
      arch: targetArch,
      decoderFile: path.relative(buildDir, decoderFile),
      decoderSize,
      encoderFile: path.relative(buildDir, encoderFile),
      encoderSize,
      platform: targetPlatform,
    },
  )
}

/**
 * Export models to output directory.
 */
export async function exportModels(ctx) {
  const {
    buildDir,
    decoderFile,
    encoderFile,
    outputDecoderFile,
    outputDir,
    outputEncoderFile,
    outputTokenizerFile,
    targetArch,
    targetPlatform,
    tokenizerFile,
  } = ctx

  logger.step('Exporting Models')

  await safeMkdir(outputDir)

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
    buildDir,
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
      arch: targetArch,
      decoderFile: path.relative(buildDir, outputDecoderFile),
      decoderSize,
      encoderFile: path.relative(buildDir, outputEncoderFile),
      encoderSize,
      platform: targetPlatform,
    },
  )
}
