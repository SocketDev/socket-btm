/**
 * @fileoverview Checkpoint validation logic for Depot Docker builds.
 *
 * Validates checkpoint archives exported from Depot Docker builds to ensure
 * they are valid and can be successfully read. This prevents silent cache
 * corruption by catching corrupted archives before they're cached for future
 * builds.
 */

import { spawnSync } from 'node:child_process'
import { accessSync, constants, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Supported tar archive formats.
 */
const _CHECKPOINT_FORMATS = ['*.tar', '*.tar.gz', '*.tgz'] as const

/**
 * Result of checkpoint validation.
 */
export interface ValidationResult {
  checkpointsFound: boolean
  valid: boolean
  message: string
  checkpointCount: number
  corruptedCount: number
}

/**
 * Validation options.
 */
export interface ValidationOptions {
  packagePath: string
  buildMode: 'prod' | 'dev'
  packageName: string
}

/**
 * Checks if a file matches supported checkpoint formats.
 */
function isCheckpointFile(filename: string): boolean {
  return (
    filename.endsWith('.tar') ||
    filename.endsWith('.tar.gz') ||
    filename.endsWith('.tgz')
  )
}

/**
 * Validates a single tar archive using tar command.
 * Checks both integrity (readable) and that it contains files.
 */
function validateTarArchive(tarPath: string): boolean {
  try {
    // Check if file exists and is readable.
    accessSync(tarPath, constants.R_OK)

    // Use tar -tf for .tar files, tar -tzf for compressed files.
    // The -z flag is for gzip compression (.tar.gz, .tgz).
    const isCompressed = tarPath.endsWith('.tar.gz') || tarPath.endsWith('.tgz')
    const flags = isCompressed ? '-tzf' : '-tf'

    const result = spawnSync('tar', [flags, tarPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // Check that tar command succeeded and archive contains files.
    if (result.status !== 0) {
      return false
    }

    // Empty tar archives are invalid for checkpoint purposes.
    const hasContent = result.stdout && result.stdout.trim().length > 0
    return hasContent
  } catch {
    return false
  }
}

/**
 * Finds checkpoint archives in a directory matching supported formats.
 */
function findCheckpoints(checkpointDir: string): string[] {
  try {
    accessSync(checkpointDir, constants.R_OK)
    const entries = readdirSync(checkpointDir)

    return entries
      .filter(filename => {
        const fullPath = path.join(checkpointDir, filename)
        try {
          const stat = statSync(fullPath)
          if (!stat.isFile()) {
            return false
          }

          // Check if filename matches any supported format.
          return isCheckpointFile(filename)
        } catch {
          return false
        }
      })
      .map(filename => path.join(checkpointDir, filename))
  } catch {
    return []
  }
}

/**
 * Validates checkpoint archives exported from Depot Docker builds.
 *
 * Different from validate-checkpoints action which validates cached checkpoints
 * before restoration. This validates newly created checkpoints immediately
 * after Depot builds complete.
 */
export function validateCheckpoints(
  options: ValidationOptions,
): ValidationResult {
  const { buildMode, packagePath } = options

  // Checkpoint directory locations to check.
  const modeCheckpointDir = path.join(
    packagePath,
    'build',
    buildMode,
    'checkpoints',
  )
  const sharedCheckpointDir = path.join(
    packagePath,
    'build',
    'shared',
    'checkpoints',
  )

  // Check if checkpoint directories exist.
  let modeDirExists = false
  let sharedDirExists = false

  try {
    accessSync(modeCheckpointDir, constants.R_OK)
    modeDirExists = true
  } catch {
    // Directory doesn't exist.
  }

  try {
    accessSync(sharedCheckpointDir, constants.R_OK)
    sharedDirExists = true
  } catch {
    // Directory doesn't exist.
  }

  // No checkpoint directories found.
  if (!modeDirExists && !sharedDirExists) {
    return {
      checkpointsFound: false,
      valid: false,
      message: 'No checkpoint directories found',
      checkpointCount: 0,
      corruptedCount: 0,
    }
  }

  // Find all checkpoint archives.
  const allCheckpoints: string[] = []

  if (modeDirExists) {
    allCheckpoints.push(...findCheckpoints(modeCheckpointDir))
  }

  if (sharedDirExists) {
    allCheckpoints.push(...findCheckpoints(sharedCheckpointDir))
  }

  // No checkpoint archives found (directories exist but are empty).
  if (allCheckpoints.length === 0) {
    return {
      checkpointsFound: true,
      valid: false,
      message: 'No checkpoint archives found',
      checkpointCount: 0,
      corruptedCount: 0,
    }
  }

  // Validate each checkpoint archive.
  let corruptedCount = 0

  for (const checkpoint of allCheckpoints) {
    if (!validateTarArchive(checkpoint)) {
      corruptedCount++
    }
  }

  // Report results.
  if (corruptedCount === 0) {
    return {
      checkpointsFound: true,
      valid: true,
      message: 'All checkpoints valid',
      checkpointCount: allCheckpoints.length,
      corruptedCount: 0,
    }
  }

  return {
    checkpointsFound: true,
    valid: false,
    message: 'Corrupted checkpoints detected',
    checkpointCount: allCheckpoints.length,
    corruptedCount,
  }
}
