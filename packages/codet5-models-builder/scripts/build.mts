/**
 * Build codet5-models - Convert and optimize CodeT5 models for Socket CLI.
 *
 * This script downloads, converts, and optimizes CodeT5 models:
 * - Downloads models from Hugging Face
 * - Converts to ONNX format
 * - Applies INT4/INT8 mixed-precision quantization
 * - Optimizes ONNX graphs.
 *
 * Usage:
 * node scripts/build.mts          # Dev build (INT8 quantization, default)
 * node scripts/build.mts --int4   # Prod build (INT4 quantization, smaller)
 * node scripts/build.mts --force  # Force rebuild (ignore checkpoints)
 *
 * Phase workers (download/convert/quantize/optimize/export) live in
 * `./build-phases.mts`; this file resolves the shared build context and
 * orchestrates the phase order.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { formatDuration } from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { getBuildMode } from 'build-infra/lib/constants'
import { checkModelBuildPrerequisites } from 'build-infra/lib/model-build-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  convertToOnnx,
  downloadModels,
  exportModels,
  optimizeModels,
  quantizeModels,
} from './build-phases.mts'
import { getBuildPaths, getCurrentPlatform } from './paths.mts'

const logger = getDefaultLogger()

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Package paths for model build prerequisites
const packageRoot = path.join(dirname, '..')
const packageJsonPath = path.join(dirname, '..', 'package.json')

// Parse arguments.
const args = new Set(process.argv.slice(2))
const FORCE_BUILD = args.has('--force')

// Build mode: --prod/--dev CLI flags win; otherwise env (BUILD_MODE, CI→prod,
// default dev). Handled centrally by build-infra's getBuildMode().
const BUILD_MODE = getBuildMode(args)

// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
const QUANT_LEVEL = args.has('--int4') ? 'int4' : 'int8'

// Populated by `initBuildContext()`, which `main()` awaits before any phase
// worker reads it — kept as a `let` binding (rather than top-level `await`)
// because the CJS bundle target does not support TLA.
let ctx

async function initBuildContext() {
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (e) {
    throw new Error(
      `Failed to parse package.json at ${packageJsonPath}: ${errorMessage(e)}`,
      { cause: e },
    )
  }

  // Configuration - Read model source from package.json.
  const codet5Source = packageJson.sources?.codet5
  if (!codet5Source) {
    throw new Error(
      'Missing sources.codet5 in package.json. Please add source metadata.',
    )
  }

  // Get paths from source of truth.
  const platformArch = await getCurrentPlatform()

  // Host platform/arch explicitly passed to every createCheckpoint call so the
  // cache key is tagged with the target (models builds run natively per host —
  // no cross-compile). createCheckpoint now throws without these for non-source
  // checkpoints.
  const targetPlatform = process.platform
  const targetArch = process.env['TARGET_ARCH'] || process.arch
  const {
    buildDir,
    configFile,
    decoderFile,
    encoderFile,
    outputDecoderFile,
    outputDir,
    outputEncoderFile,
    outputTokenizerFile,
    tokenizerFile,
  } = getBuildPaths(BUILD_MODE, platformArch, QUANT_LEVEL)

  ctx = {
    buildDir,
    configFile,
    decoderFile,
    dirname,
    encoderFile,
    forceBuild: FORCE_BUILD,
    // For HuggingFace, version contains the model identifier.
    modelName: codet5Source.version,
    outputDecoderFile,
    outputDir,
    outputEncoderFile,
    outputTokenizerFile,
    packageRoot,
    quantLevel: QUANT_LEVEL,
    targetArch,
    targetPlatform,
    tokenizerFile,
  }
}

/**
 * Main build function.
 */
async function main() {
  await initBuildContext()

  const totalStart = Date.now()

  logger.step('Building codet5-models')
  logger.info('Converting and optimizing CodeT5 models')
  logger.info(`Build mode: ${BUILD_MODE}`)
  logger.info(`Quantization: ${QUANT_LEVEL}`)
  logger.info('')

  // Pre-flight checks (centralized in build-infra).
  await checkModelBuildPrerequisites({
    buildDir: ctx.buildDir,
    packageJsonPath,
    packageRoot,
    requiredDiskGB: 2,
  })

  // Build phases.
  await downloadModels(ctx)
  await convertToOnnx(ctx)
  await quantizeModels(ctx)
  await optimizeModels(ctx)
  await exportModels(ctx)

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('Build Complete')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${ctx.outputDir}`)
  logger.info('')
  logger.group('Next steps:')
  logger.info('Test models with Socket CLI')
  logger.info('Integrate with Socket CLI build')
  logger.groupEnd()
}

// Run build.
main().catch(error => {
  printError('Build Failed')
  logger.error(errorMessage(error))
  throw error
})
