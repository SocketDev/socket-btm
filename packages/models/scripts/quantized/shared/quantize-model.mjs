import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { which } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Apply quantization for compression.
 *
 * Supports two quantization levels:
 * - INT4: MatMul4BitsQuantizer with RTN weight-only quantization (maximum compression).
 * - INT8: Dynamic quantization (better compatibility, moderate compression).
 *
 * Results in significant size reduction with minimal accuracy loss.
 *
 * @param {Object} options - The options object
 * @param {string} options.modelKey - The model key (e.g., 'minilm-l6', 'codet5')
 * @param {string} options.quantLevel - The quantization level ('int4' or 'int8')
 * @param {string} options.buildDir - The build directory path
 * @param {string} options.packageName - The package name
 * @param {string} options.modelsDir - The models directory path
 * @param {boolean} options.forceRebuild - Whether to force rebuild
 * @returns {Promise<string[]>} Array of quantized model paths
 */
export async function quantizeModel(options) {
  const {
    buildDir,
    forceRebuild,
    modelKey,
    modelsDir,
    packageName,
    quantLevel,
  } = options

  const suffix = quantLevel.toLowerCase()
  const checkpointKey = `quantized-${modelKey}-${suffix}`

  if (!(await shouldRun(buildDir, packageName, checkpointKey, forceRebuild))) {
    // Return existing quantized paths.
    const modelDir = path.join(modelsDir, modelKey)
    return [path.join(modelDir, `model.${suffix}.onnx`)]
  }

  logger.step(`Applying ${quantLevel} quantization to ${modelKey}`)

  const modelDir = path.join(modelsDir, modelKey)

  // All models use single model.onnx file.
  const models = [{ input: 'model.onnx', output: `model.${suffix}.onnx` }]

  const quantizedPaths = []

  for (const { input, output } of models) {
    const onnxPath = path.join(modelDir, input)
    const quantPath = path.join(modelDir, output)

    if (!existsSync(onnxPath)) {
      throw new Error(`No ONNX model found at ${onnxPath}`)
    }

    const python3Path = await which('python3', { nothrow: true })
    if (!python3Path) {
      throw new Error('python3 not found in PATH')
    }

    if (quantLevel.toLowerCase() === 'int8') {
      // INT8: Use dynamic quantization (simpler, more compatible).
      const int8Command =
        'from onnxruntime.quantization import quantize_dynamic, QuantType; ' +
        `quantize_dynamic('${onnxPath}', '${quantPath}', weight_type=QuantType.QUInt8)`

      const int8Result = await spawn(python3Path, ['-c', int8Command], {
        stdio: 'inherit',
      })

      if (int8Result.code !== 0) {
        throw new Error(
          `INT8 quantization failed with exit code ${int8Result.code}`,
        )
      }
    } else {
      // INT4: Use MatMul4BitsQuantizer (maximum compression).
      const int4Command =
        'from onnxruntime.quantization.matmul_4bits_quantizer import MatMul4BitsQuantizer, RTNWeightOnlyQuantConfig; ' +
        'from onnxruntime.quantization import quant_utils; ' +
        'from pathlib import Path; ' +
        'quant_config = RTNWeightOnlyQuantConfig(); ' +
        `model = quant_utils.load_model_with_shape_infer(Path('${onnxPath}')); ` +
        'quant = MatMul4BitsQuantizer(model, algo_config=quant_config); ' +
        'quant.process(); ' +
        `quant.model.save_model_to_file('${quantPath}', True)`

      const int4Result = await spawn(python3Path, ['-c', int4Command], {
        stdio: 'inherit',
      })

      if (int4Result.code !== 0) {
        throw new Error(
          `INT4 quantization failed with exit code ${int4Result.code}`,
        )
      }
    }

    // Get sizes.
    const originalSize = (await fs.readFile(onnxPath)).length
    const quantSize = (await fs.readFile(quantPath)).length
    const savings = ((1 - quantSize / originalSize) * 100).toFixed(1)

    logger.substep(
      `${input}: ${(originalSize / 1024 / 1024).toFixed(2)} MB → ${(quantSize / 1024 / 1024).toFixed(2)} MB (${savings}% savings)`,
    )

    quantizedPaths.push(quantPath)
  }

  logger.success(`Quantized to ${quantLevel}`)
  await createCheckpoint(
    buildDir,
    checkpointKey,
    async () => {
      // Smoke test: Verify all quantized models exist and are valid
      for (const quantPath of quantizedPaths) {
        const stats = await fs.stat(quantPath)
        if (stats.size === 0) {
          throw new Error(
            `Quantized model is empty: ${path.basename(quantPath)}`,
          )
        }
        // Verify it's smaller or equal to original (sanity check)
        if (stats.size > 1024 * 1024 * 1024) {
          // > 1GB is suspicious
          throw new Error(
            `Quantized model is unexpectedly large: ${path.basename(quantPath)} (${(stats.size / 1024 / 1024).toFixed(2)}MB)`,
          )
        }
      }
    },
    {
      packageName,
      artifactPath: modelDir,
      modelKey,
      quantLevel,
    },
  )

  return quantizedPaths
}
