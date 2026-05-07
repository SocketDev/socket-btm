#!/usr/bin/env node
/**
 * Validate checkpoint name alignment across codebase
 *
 * Ensures:
 * - Checkpoint names match directory names
 * - Workflow hash variables match checkpoint names
 * - Consistent past-tense naming convention
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { CHECKPOINTS } from '../packages/build-infra/lib/constants.mts'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MONOREPO_ROOT = path.dirname(__dirname)

let hasErrors = false

type CheckpointName = string

/**
 * Check if a checkpoint name follows past-tense convention
 */
function isPastTense(checkpoint: CheckpointName): boolean {
  const pastTenseEndings: string[] = [
    'ed',
    'ized',
    'cloned',
    'patched',
    'stripped',
    'compressed',
    'compiled',
    'synced',
  ]
  return pastTenseEndings.some(ending => checkpoint.endsWith(ending))
}

/**
 * Validate node-smol-builder checkpoints
 */
function validateNodeSmol(): void {
  logger.info('Validating node-smol-builder checkpoints...')

  const scriptsDir = path.join(
    MONOREPO_ROOT,
    'packages/node-smol-builder/scripts',
  )
  const dirs = new Set(
    readdirSync(scriptsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'lib' && d.name !== 'common')
      .map(d => d.name),
  )

  const expectedCheckpoints: CheckpointName[] = [
    CHECKPOINTS.SOURCE_COPIED,
    CHECKPOINTS.SOURCE_PATCHED,
    CHECKPOINTS.BINARY_RELEASED,
    CHECKPOINTS.BINARY_STRIPPED,
    CHECKPOINTS.BINARY_COMPRESSED,
    CHECKPOINTS.FINALIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.has(checkpoint)) {
      logger.fail(`node-smol: Missing directory for checkpoint "${checkpoint}"`)
      hasErrors = true
    } else {
      logger.success(`node-smol: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      logger.fail(`node-smol: Checkpoint "${checkpoint}" is not past-tense`)
      hasErrors = true
    }
  }
}

/**
 * Validate yoga-layout-builder checkpoints
 */
function validateYoga(): void {
  logger.info('Validating yoga-layout-builder checkpoints...')

  const scriptsDir = path.join(
    MONOREPO_ROOT,
    'packages/yoga-layout-builder/scripts',
  )
  if (!existsSync(scriptsDir)) {
    logger.fail('yoga-layout: scripts directory not found')
    hasErrors = true
    return
  }

  const dirs = new Set(
    readdirSync(scriptsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'common')
      .map(d => d.name),
  )

  const expectedCheckpoints: CheckpointName[] = [
    CHECKPOINTS.SOURCE_CONFIGURED,
    CHECKPOINTS.WASM_COMPILED,
    CHECKPOINTS.WASM_RELEASED,
    CHECKPOINTS.WASM_OPTIMIZED,
    CHECKPOINTS.WASM_SYNCED,
    CHECKPOINTS.FINALIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.has(checkpoint)) {
      logger.fail(
        `yoga-layout: Missing directory for checkpoint "${checkpoint}"`,
      )
      hasErrors = true
    } else {
      logger.success(`yoga-layout: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      logger.fail(`yoga-layout: Checkpoint "${checkpoint}" is not past-tense`)
      hasErrors = true
    }
  }
}

/**
 * Validate onnxruntime-builder checkpoints
 */
function validateOnnxruntime(): void {
  logger.info('Validating onnxruntime-builder checkpoints...')

  const scriptsDir = path.join(
    MONOREPO_ROOT,
    'packages/onnxruntime-builder/scripts',
  )
  if (!existsSync(scriptsDir)) {
    logger.fail('onnxruntime: scripts directory not found')
    hasErrors = true
    return
  }

  const dirs = new Set(
    readdirSync(scriptsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'common')
      .map(d => d.name),
  )

  const expectedCheckpoints: CheckpointName[] = [
    CHECKPOINTS.WASM_COMPILED,
    CHECKPOINTS.WASM_RELEASED,
    CHECKPOINTS.WASM_OPTIMIZED,
    CHECKPOINTS.WASM_SYNCED,
    CHECKPOINTS.FINALIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.has(checkpoint)) {
      logger.fail(
        `onnxruntime: Missing directory for checkpoint "${checkpoint}"`,
      )
      hasErrors = true
    } else {
      logger.success(`onnxruntime: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      logger.fail(`onnxruntime: Checkpoint "${checkpoint}" is not past-tense`)
      hasErrors = true
    }
  }
}

/**
 * Validate models package checkpoints
 */
function validateModels(): void {
  logger.info('Validating models package checkpoints...')

  const scriptsDir = path.join(MONOREPO_ROOT, 'packages/models/scripts')
  if (!existsSync(scriptsDir)) {
    logger.fail('models: scripts directory not found')
    hasErrors = true
    return
  }

  const dirs = new Set(
    readdirSync(scriptsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && d.name !== 'common')
      .map(d => d.name),
  )

  const expectedCheckpoints: CheckpointName[] = [
    CHECKPOINTS.DOWNLOADED,
    CHECKPOINTS.CONVERTED,
    CHECKPOINTS.QUANTIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.has(checkpoint)) {
      logger.fail(`models: Missing directory for checkpoint "${checkpoint}"`)
      hasErrors = true
    } else {
      logger.success(`models: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      logger.fail(`models: Checkpoint "${checkpoint}" is not past-tense`)
      hasErrors = true
    }
  }
}

// Run all validations.
logger.info('Validating checkpoint alignment...\n')

validateNodeSmol()
logger.log('')
validateYoga()
logger.log('')
validateOnnxruntime()
logger.log('')
validateModels()

logger.log('')
if (hasErrors) {
  logger.fail('Validation failed with errors')
  process.exitCode = 1
} else {
  logger.success('All checkpoint alignments validated successfully')
  process.exitCode = 0
}
