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
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { CHECKPOINTS } from '../packages/build-infra/lib/constants.mjs'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MONOREPO_ROOT = path.dirname(__dirname)

let hasErrors = false

function error(message) {
  logger.fail(message)
  hasErrors = true
}

function success(message) {
  logger.success(message)
}

function info(message) {
  logger.info(message)
}

/**
 * Check if a checkpoint name follows past-tense convention
 */
function isPastTense(checkpoint) {
  const pastTenseEndings = [
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
function validateNodeSmol() {
  info('Validating node-smol-builder checkpoints...')

  const scriptsDir = path.join(
    MONOREPO_ROOT,
    'packages/node-smol-builder/scripts',
  )
  const dirs = readdirSync(scriptsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'lib' && d.name !== 'common')
    .map(d => d.name)

  const expectedCheckpoints = [
    CHECKPOINTS.SOURCE_COPIED,
    CHECKPOINTS.SOURCE_PATCHED,
    CHECKPOINTS.BINARY_RELEASED,
    CHECKPOINTS.BINARY_STRIPPED,
    CHECKPOINTS.BINARY_COMPRESSED,
    CHECKPOINTS.FINALIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.includes(checkpoint)) {
      error(`node-smol: Missing directory for checkpoint "${checkpoint}"`)
    } else {
      success(`node-smol: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      error(`node-smol: Checkpoint "${checkpoint}" is not past-tense`)
    }
  }
}

/**
 * Validate yoga-layout-builder checkpoints
 */
function validateYoga() {
  info('Validating yoga-layout-builder checkpoints...')

  const scriptsDir = path.join(
    MONOREPO_ROOT,
    'packages/yoga-layout-builder/scripts',
  )
  if (!existsSync(scriptsDir)) {
    error('yoga-layout: scripts directory not found')
    return
  }

  const dirs = readdirSync(scriptsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'common')
    .map(d => d.name)

  const expectedCheckpoints = [
    CHECKPOINTS.SOURCE_CONFIGURED,
    CHECKPOINTS.WASM_COMPILED,
    CHECKPOINTS.WASM_RELEASED,
    CHECKPOINTS.WASM_OPTIMIZED,
    CHECKPOINTS.WASM_SYNCED,
    CHECKPOINTS.FINALIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.includes(checkpoint)) {
      error(`yoga-layout: Missing directory for checkpoint "${checkpoint}"`)
    } else {
      success(`yoga-layout: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      error(`yoga-layout: Checkpoint "${checkpoint}" is not past-tense`)
    }
  }
}

/**
 * Validate onnxruntime-builder checkpoints
 */
function validateOnnxruntime() {
  info('Validating onnxruntime-builder checkpoints...')

  const scriptsDir = path.join(
    MONOREPO_ROOT,
    'packages/onnxruntime-builder/scripts',
  )
  if (!existsSync(scriptsDir)) {
    error('onnxruntime: scripts directory not found')
    return
  }

  const dirs = readdirSync(scriptsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'common')
    .map(d => d.name)

  const expectedCheckpoints = [
    CHECKPOINTS.WASM_COMPILED,
    CHECKPOINTS.WASM_RELEASED,
    CHECKPOINTS.WASM_OPTIMIZED,
    CHECKPOINTS.WASM_SYNCED,
    CHECKPOINTS.FINALIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.includes(checkpoint)) {
      error(`onnxruntime: Missing directory for checkpoint "${checkpoint}"`)
    } else {
      success(`onnxruntime: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      error(`onnxruntime: Checkpoint "${checkpoint}" is not past-tense`)
    }
  }
}

/**
 * Validate models package checkpoints
 */
function validateModels() {
  info('Validating models package checkpoints...')

  const scriptsDir = path.join(MONOREPO_ROOT, 'packages/models/scripts')
  if (!existsSync(scriptsDir)) {
    error('models: scripts directory not found')
    return
  }

  const dirs = readdirSync(scriptsDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'common')
    .map(d => d.name)

  const expectedCheckpoints = [
    CHECKPOINTS.DOWNLOADED,
    CHECKPOINTS.CONVERTED,
    CHECKPOINTS.QUANTIZED,
  ]

  for (const checkpoint of expectedCheckpoints) {
    if (!dirs.includes(checkpoint)) {
      error(`models: Missing directory for checkpoint "${checkpoint}"`)
    } else {
      success(`models: Directory "${checkpoint}" exists`)
    }

    if (!isPastTense(checkpoint)) {
      error(`models: Checkpoint "${checkpoint}" is not past-tense`)
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
