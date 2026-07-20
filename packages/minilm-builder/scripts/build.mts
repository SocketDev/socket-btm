#!/usr/bin/env node
/**
 * MiniLM Model Builder.
 *
 * Converts and optimizes MiniLM models for Socket CLI:
 * 1. Download models from Hugging Face
 * 2. Convert to ONNX format
 * 3. Apply INT4/INT8 mixed-precision quantization
 * 4. Optimize ONNX graphs
 * 5. Verify inference
 * 6. Export to distribution location.
 *
 * Usage: node scripts/repo/build.mts # Dev build (INT8 quantization, default)
 * node scripts/repo/build.mts --int4 # Prod build (INT4 quantization, smaller)
 * node scripts/repo/build.mts --force # Force rebuild (ignore checkpoints)
 *
 * Phase workers (download/convert/quantize/optimize/verify/export) live in
 * `./build-phases.mts`; this file resolves the shared build context and
 * orchestrates the phase order.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { formatDuration } from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { checkModelBuildPrerequisites } from 'build-infra/lib/model-build-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  convertToOnnx,
  downloadModels,
  exportModels,
  optimizeGraphs,
  quantizeModels,
  verifyModels,
} from './build-phases.mts'
import { getBuildPaths, getCurrentPlatform } from './paths.mts'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const logger = getDefaultLogger()

// Package paths for model build prerequisites
const packageRoot = path.join(dirname, '..')
const packageJsonPath = path.join(dirname, '..', 'package.json')

// Parse arguments.
const cliArgs = new Set(process.argv.slice(2))
const FORCE_BUILD = cliArgs.has('--force')
// Quantization level: int8 (dev, default) vs int4 (prod, smaller).
const QUANT_LEVEL = cliArgs.has('--int4') ? 'int4' : 'int8'
// Build mode mirrors QUANT_LEVEL: int4 -> prod, int8 -> dev.
const BUILD_MODE = QUANT_LEVEL === 'int4' ? 'prod' : 'dev'

// Populated by `initBuildContext()`, which `main()` awaits before any phase
// worker reads it — kept as a `let` binding (rather than top-level `await`)
// because the CJS bundle target does not support TLA.
let ctx

async function initBuildContext() {
  // Load package.json for sources configuration.
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (e) {
    throw new Error(
      `Failed to parse package.json at ${packageJsonPath}: ${errorMessage(e)}`,
      { cause: e },
    )
  }

  // Model configuration - Read model source from package.json.
  const minilmSource = packageJson.sources?.minilm
  if (!minilmSource) {
    throw new Error(
      'Missing sources.minilm in package.json. Please add source metadata.',
    )
  }

  // Get paths from source of truth.
  const platformArch = await getCurrentPlatform()

  // Host platform/arch — createCheckpoint now requires explicit target for
  // non-source checkpoints. Model builds run natively per host (no cross-
  // compile), so passing process.* is safe.
  const targetPlatform = process.platform
  const targetArch = process.env['TARGET_ARCH'] || process.arch
  const { buildDir, cacheDir, modelsDir } = getBuildPaths(
    BUILD_MODE,
    platformArch,
    QUANT_LEVEL,
  )

  ctx = {
    buildDir,
    buildMode: BUILD_MODE,
    cacheDir,
    forceBuild: FORCE_BUILD,
    // For HuggingFace, version contains the model identifier.
    models: [
      {
        hiddenSize: 384,
        name: minilmSource.version,
        numHeads: 12,
        outputName: 'minilm',
      },
    ],
    modelsDir,
    platformArch,
    quantLevel: QUANT_LEVEL,
    targetArch,
    targetPlatform,
  }
}

/**
 * Main build function.
 */
async function main() {
  await initBuildContext()

  const totalStart = Date.now()

  logger.step('Building minilm models')
  logger.info('MiniLM model conversion and optimization')
  logger.info('')

  // Pre-flight checks (centralized in build-infra).
  await checkModelBuildPrerequisites({
    buildDir: ctx.buildDir,
    packageJsonPath,
    packageRoot,
    requiredDiskGB: 1,
  })

  // Build phases.
  await downloadModels(ctx)
  await convertToOnnx(ctx)
  await optimizeGraphs(ctx)
  await quantizeModels(ctx)
  await verifyModels(ctx)
  await exportModels(ctx)

  // Report completion.
  const totalDuration = formatDuration(Date.now() - totalStart)

  logger.step('Build Complete!')
  logger.success(`Total time: ${totalDuration}`)
  logger.success(`Output: ${ctx.modelsDir}`)
  logger.info('')
  logger.group('Models ready for use:')
  for (let i = 0, { length } = ctx.models; i < length; i += 1) {
    const model = ctx.models[i]
    logger.info(`${model.outputName}.onnx`)
    logger.info(`${model.outputName}-tokenizer/`)
  }
  logger.groupEnd()
}

// Run build.
main().catch(error => {
  printError('Build Failed')
  logger.error(errorMessage(error))
  throw error
})
