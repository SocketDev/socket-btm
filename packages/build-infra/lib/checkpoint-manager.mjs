/**
 * Build Checkpoint Manager
 *
 * Provides utilities for saving and restoring build state to enable
 * incremental builds and faster iterations. These checkpoints are used
 * by GitHub Actions workflows to track build progress and enable caching
 * at each build phase.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib/fs'

import { printStep, printSubstep } from './build-output.mjs'

/**
 * Get checkpoint directory for a package.
 *
 * @param {string} buildDir - Build directory path (e.g., '/path/to/package/build/int4')
 * @param {string} packageName - Package name (e.g., 'onnx-runtime-builder')
 * @returns {string} Checkpoint directory path
 */
function getCheckpointDir(buildDir, packageName) {
  return path.join(buildDir, 'checkpoints', packageName)
}

/**
 * Get checkpoint file path.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name (e.g., 'configured', 'built')
 * @returns {string} Checkpoint file path
 */
function getCheckpointFile(buildDir, packageName, checkpointName) {
  return path.join(
    getCheckpointDir(buildDir, packageName),
    `${checkpointName}.json`,
  )
}

/**
 * Check if a checkpoint exists.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name
 * @returns {Promise<boolean>}
 */
export async function hasCheckpoint(buildDir, packageName, checkpointName) {
  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  try {
    await fs.access(checkpointFile)
    return true
  } catch {
    return false
  }
}

/**
 * Create a workflow checkpoint with binary and metadata.
 * Checkpoints are tracked by GitHub Actions workflows to enable
 * phase-specific caching and build resumption.
 *
 * Stores:
 * - Metadata JSON: build/{mode}/checkpoints/{package}/{phase}.json
 * - Binary: build/{mode}/checkpoints/{package}/{phase}.bin
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name (e.g., 'release', 'stripped', 'final')
 * @param {object} data - Checkpoint data (must include binaryPath: path to binary to checkpoint)
 * @returns {Promise<void>}
 */
export async function createWorkflowCheckpoint(
  buildDir,
  packageName,
  checkpointName,
  data = {},
) {
  printSubstep(`Creating checkpoint: ${checkpointName}`)

  const checkpointDir = getCheckpointDir(buildDir, packageName)
  await fs.mkdir(checkpointDir, { recursive: true })

  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  // If binaryPath is provided, copy the binary to checkpoint
  let binaryCheckpointPath = null
  if (data.binaryPath) {
    const path = await import('node:path')
    const binaryPath = path.default.isAbsolute(data.binaryPath)
      ? data.binaryPath
      : path.default.join(buildDir, data.binaryPath)

    binaryCheckpointPath = checkpointFile.replace('.json', '.bin')
    await fs.copyFile(binaryPath, binaryCheckpointPath)
    printSubstep(`Binary saved: ${path.default.basename(binaryCheckpointPath)}`)
  }

  const checkpointData = {
    created: new Date().toISOString(),
    name: checkpointName,
    package: packageName,
    hasBinary: !!binaryCheckpointPath,
    ...data,
  }

  await fs.writeFile(
    checkpointFile,
    JSON.stringify(checkpointData, null, 2),
    'utf8',
  )
}

/**
 * Get checkpoint data.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name
 * @returns {Promise<object|null>} Checkpoint data or null if not found
 */
export async function getCheckpointData(buildDir, packageName, checkpointName) {
  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    return JSON.parse(content)
  } catch {
    return null
  }
}

/**
 * Clean all workflow checkpoints for a package.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @returns {Promise<void>}
 */
export async function cleanWorkflowCheckpoint(buildDir, packageName) {
  printStep(`Cleaning checkpoints for ${packageName}`)

  const checkpointDir = getCheckpointDir(buildDir, packageName)

  await safeDelete(checkpointDir)
  printSubstep('Checkpoints cleaned')
}

/**
 * Clean a specific checkpoint.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name
 * @returns {Promise<void>}
 */
export async function removeCheckpoint(buildDir, packageName, checkpointName) {
  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  await safeDelete(checkpointFile)
}

/**
 * List all checkpoints for a package.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @returns {Promise<string[]>} Array of checkpoint names
 */
export async function listCheckpoints(buildDir, packageName) {
  const checkpointDir = getCheckpointDir(buildDir, packageName)

  try {
    const files = await fs.readdir(checkpointDir)
    return files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .sort()
  } catch {
    return []
  }
}

/**
 * Check if build should run based on checkpoint and --force flag.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name
 * @param {boolean} force - Force rebuild flag
 * @returns {Promise<boolean>} True if should run, false if should skip
 */
export async function shouldRun(
  buildDir,
  packageName,
  checkpointName,
  force = false,
) {
  if (force) {
    return true
  }

  const exists = await hasCheckpoint(buildDir, packageName, checkpointName)

  if (exists) {
    printStep(`Checkpoint '${checkpointName}' exists, skipping`)
    return false
  }

  return true
}
