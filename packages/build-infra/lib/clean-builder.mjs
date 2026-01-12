/**
 * Shared clean utility for builder packages.
 *
 * Provides a standardized way to clean build artifacts and checkpoints
 * across all builder packages (onnxruntime, yoga-layout, models, etc.).
 *
 * @module clean-builder
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { cleanCheckpoint } from './checkpoint-manager.mjs'

/**
 * Clean build artifacts for a builder package.
 *
 * @param {string} packageName - Display name for logging (e.g., 'onnxruntime-builder')
 * @param {object} options - Configuration options
 * @param {string} options.packageDir - Absolute path to package root (default: caller's parent dir)
 * @param {string[]} options.cleanDirs - Directories to delete relative to packageDir (default: ['build'])
 * @param {string[]} options.checkpointModes - Modes to clean checkpoints for (default: ['prod', 'dev'])
 * @param {string} options.buildDir - Build directory name for checkpoints (default: 'build')
 * @param {object} options.logger - Custom logger instance (default: getDefaultLogger())
 * @returns {Promise<void>}
 *
 * @example
 * // Basic usage (cleans build/ and checkpoints for prod/dev)
 * await cleanBuilder('onnxruntime-builder')
 *
 * @example
 * // Custom directories
 * await cleanBuilder('models', {
 *   cleanDirs: ['build', 'dist'],
 *   packageDir: path.join(__dirname, '..')
 * })
 *
 * @example
 * // No checkpoint cleaning
 * await cleanBuilder('node-smol-builder', {
 *   checkpointModes: []
 * })
 */
export async function cleanBuilder(packageName, options = {}) {
  const logger = options.logger || getDefaultLogger()

  // Resolve package directory (default: caller's parent directory)
  let packageDir = options.packageDir
  if (!packageDir) {
    // Auto-detect from caller's location (typically scripts/clean.mjs)
    const callerUrl = new Error().stack.split('\n')[2].match(/\(([^)]+)\)/)?.[1]
    if (callerUrl) {
      const callerPath = fileURLToPath(callerUrl)
      packageDir = path.resolve(path.dirname(callerPath), '..')
    } else {
      throw new Error('packageDir must be provided or auto-detectable')
    }
  }

  const {
    buildDir = 'build',
    checkpointModes = ['prod', 'dev'],
    cleanDirs = ['build'],
  } = options

  logger.info(`🧹 Cleaning ${packageName}…`)

  let cleanedCount = 0

  // Delete each specified directory
  for (const dir of cleanDirs) {
    const dirPath = path.join(packageDir, dir)
    if (existsSync(dirPath)) {
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(dirPath)
      logger.success(`Removed ${dir}/`)
      cleanedCount++
    }
  }

  // Clean checkpoints for specified modes
  if (checkpointModes.length > 0) {
    const buildDirPath = path.join(packageDir, buildDir)
    for (const mode of checkpointModes) {
      const modeDirPath = path.join(buildDirPath, mode)
      // eslint-disable-next-line no-await-in-loop
      await cleanCheckpoint(modeDirPath, '')
    }
    logger.success('Cleaned checkpoints')
    cleanedCount++
  }

  if (cleanedCount === 0) {
    logger.info('Nothing to clean')
  } else {
    logger.success('Clean complete')
  }
}
