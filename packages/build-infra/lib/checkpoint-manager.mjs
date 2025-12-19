/**
 * Build Checkpoint Manager
 *
 * Provides utilities for saving and restoring build state to enable
 * incremental builds and faster iterations. These checkpoints are used
 * by GitHub Actions workflows to track build progress and enable caching
 * at each build phase.
 *
 * Also provides centralized cache key management for build source validation.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  computeSourceHash,
  generateHashComment,
  shouldExtract,
} from './extraction-cache.mjs'
import { adHocSign } from './sign.mjs'

const logger = getDefaultLogger()

/**
 * Get checkpoint directory for a package.
 *
 * @param {string} buildDir - Build directory path (e.g., '/path/to/package/build/int4')
 * @param {string} packageName - Package name (e.g., 'onnx-runtime-builder'), or empty string for flat structure
 * @returns {string} Checkpoint directory path
 */
function getCheckpointDir(buildDir, packageName) {
  return packageName
    ? path.join(buildDir, 'checkpoints', packageName)
    : path.join(buildDir, 'checkpoints')
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
 * Create a workflow checkpoint with artifacts and metadata.
 * Checkpoints are tracked by GitHub Actions workflows to enable
 * phase-specific caching and build resumption.
 *
 * IMPORTANT: This function requires a smokeTest callback to ensure
 * all checkpoints are created AFTER validating the build artifacts.
 * This enforces the pattern: build → smoke test → checkpoint.
 *
 * Cache Invalidation:
 * - If sourcePaths provided, computes SHA256 hash and stores in checkpoint
 * - Next build compares current vs stored hash to determine if stage needs rebuild
 * - Each checkpoint tracks its own source dependencies independently
 *
 * Artifact Storage:
 * - If artifactPath provided, creates checkpoint.tar.gz (works for files OR directories)
 * - Metadata stores artifactPath for restoration
 * - Use restoreCheckpoint() to extract tarball back to original location
 *
 * Stores:
 * - Metadata JSON: build/{mode}/checkpoints/{package}/{phase}.json
 * - Tarball: build/{mode}/checkpoints/{package}/{phase}.tar.gz (if artifactPath provided)
 *
 * @param {string} buildDir - Build directory path
 * @param {string} checkpointName - Checkpoint name (e.g., 'release', 'patches-applied')
 * @param {Function} smokeTest - Async function that validates build artifacts (REQUIRED)
 * @param {object} [options] - Optional checkpoint metadata
 * @param {string | undefined} [options.packageName=''] - Package name (defaults to '' for flat structure)
 * @param {string | undefined} [options.artifactPath] - Path to file or directory to archive in checkpoint
 * @param {string[] | undefined} [options.sourcePaths] - Source file paths to hash for cache validation
 * @param {string | undefined} [options.packageRoot] - Package root for relative path display
 * @param {string | undefined} [options.platform=process.platform] - Platform (darwin, linux, win32)
 * @param {string | undefined} [options.arch=process.arch] - Architecture (x64, arm64)
 * @param {string | undefined} [options.binaryPath] - Binary path for macOS code signing
 * @returns {Promise<void>}
 *
 * @example
 * // Minimal usage
 * await createCheckpoint(BUILD_DIR, 'release', async () => {
 *   await spawn(binaryPath, ['--version'])
 * })
 *
 * // With options
 * await createCheckpoint(BUILD_DIR, 'release', async () => {
 *   await spawn(binaryPath, ['--version'])
 * }, {
 *   artifactPath: './out/Release/node',
 *   sourcePaths: ['build.mjs', 'patches/*.patch'],
 *   packageRoot: PACKAGE_ROOT,
 * })
 */
export async function createCheckpoint(
  buildDir,
  checkpointName,
  smokeTest,
  options = {},
) {
  // Extract options with defaults
  const {
    arch = process.arch,
    artifactPath,
    binaryPath,
    checkpointChain,
    packageName = '',
    packageRoot,
    platform = process.platform,
    sourcePaths,
    ...rest
  } = options

  // Build data object for legacy code paths
  const data = {
    artifactPath,
    sourcePaths,
    packageRoot,
    platform,
    arch,
    binaryPath,
    ...rest,
  }

  // Enforce smoke test requirement
  if (typeof smokeTest !== 'function') {
    const actualValue =
      typeof smokeTest === 'object'
        ? `object with keys: ${Object.keys(smokeTest).join(', ')}`
        : typeof smokeTest
    throw new Error(
      `\n${'='.repeat(70)}\n` +
        'ERROR: createCheckpoint() called incorrectly!\n' +
        `${'='.repeat(70)}\n` +
        `Checkpoint: "${checkpointName}"\n` +
        '\n' +
        'Expected parameter 3: smokeTest callback function\n' +
        `Actual parameter 3: ${actualValue}\n` +
        '\n' +
        'Correct pattern:\n' +
        '  createCheckpoint(buildDir, checkpointName, async () => {\n' +
        '    // Smoke test validation code here\n' +
        '  }, options)\n' +
        '\n' +
        'You passed:\n' +
        '  createCheckpoint(buildDir, checkpointName, options) ❌ Missing callback!\n' +
        `${'='.repeat(70)}\n`,
    )
  }

  // Sign binary on macOS BEFORE smoke test (required for execution)
  if (data.binaryPath) {
    const binaryPath = path.isAbsolute(data.binaryPath)
      ? data.binaryPath
      : path.join(buildDir, data.binaryPath)

    await adHocSign(binaryPath)
  }

  // Build checkpoint identifier with platform/arch if provided
  let checkpointId = checkpointName
  if (platform && arch) {
    checkpointId = `${checkpointName} (${platform}-${arch})`
  } else if (platform) {
    checkpointId = `${checkpointName} (${platform})`
  }

  // Show package root once at start
  if (packageRoot) {
    const relativeRoot = path.relative(process.cwd(), packageRoot) || '.'
    logger.log('')
    logger.substep(`Working in: ${relativeRoot}`)
  }

  // Run smoke test BEFORE creating checkpoint
  logger.substep(`Testing ${checkpointId}`)
  try {
    await smokeTest()
  } catch (error) {
    throw new Error(
      `Smoke test failed for checkpoint '${checkpointName}': ${error.message}`,
    )
  }

  logger.substep(`Creating ${checkpointId} checkpoint`)

  const checkpointDir = getCheckpointDir(buildDir, packageName)
  await safeMkdir(checkpointDir)

  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  // If artifactPath is provided, create tarball (works for both files and directories)
  // The tarball is ALWAYS checkpoint.tar.gz, and artifactPath in metadata tells where to extract
  if (data.artifactPath) {
    const artifactPath = path.isAbsolute(data.artifactPath)
      ? data.artifactPath
      : path.join(buildDir, data.artifactPath)

    const tarballPath = checkpointFile.replace('.json', '.tar.gz')

    // Create tarball using tar command
    const tarBin = await which('tar')
    const tarDir = path.dirname(artifactPath)
    const tarBase = path.basename(artifactPath)

    const stats = await fs.stat(artifactPath)
    const isDir = stats.isDirectory()

    // Show relative path from packageRoot if provided
    const displayPath = packageRoot
      ? path.relative(packageRoot, artifactPath)
      : tarBase
    logger.substep(`Archiving ${displayPath}${isDir ? ' (dir)' : ''}`)

    // Convert Windows paths to Unix-style for Git tar.
    // Git's tar is a Unix tool and expects /c/path instead of C:\path.
    const toUnixPath = p => {
      if (!WIN32) {
        return p
      }
      // First normalize to forward slashes: C:\path → C:/path
      const normalized = normalizePath(p)
      // Then convert drive letter: C:/path → /c/path (lowercase)
      return normalized.replace(
        /^([A-Z]):/i,
        (_, letter) => `/${letter.toLowerCase()}`,
      )
    }

    const unixTarballPath = toUnixPath(tarballPath)
    const unixTarDir = toUnixPath(tarDir)

    try {
      // Create tarball with artifact as top-level entry
      // -c: create archive
      // -z: compress with gzip
      // -f: output file
      // -C: change to directory before archiving (ensures artifact becomes top-level entry)
      // tarBase: the artifact basename to archive (file or directory)
      //
      // Example: tar -czf checkpoint.tar.gz -C /build/dev/out Final
      //   → Creates tarball containing Final/ as top-level entry
      //   → During extraction, use --strip-components=1 to remove this wrapper
      await spawn(
        tarBin,
        ['-czf', unixTarballPath, '-C', unixTarDir, tarBase],
        {
          stdio: 'inherit',
        },
      )
    } catch (error) {
      const workingDirExists = existsSync(tarDir)
      const sourceExists = existsSync(artifactPath)

      const checkpointDir = path.dirname(tarballPath)
      const errorMsg = [
        `Failed to create checkpoint tarball: ${checkpointName}.tar.gz`,
        '',
        'Common causes:',
        `  ${sourceExists ? '✓' : '✗'} Source artifact exists`,
        `  ${workingDirExists ? '✓' : '✗'} Working directory exists`,
        '  ✗ Insufficient disk space',
        '  ✗ Permission denied writing tarball',
        '  ✗ Invalid tar command or arguments',
        '',
        'Troubleshooting:',
        `  1. Source: ${artifactPath}`,
        `  2. Tarball: ${tarballPath}`,
        `  3. Check disk space: df -h ${checkpointDir}`,
        `  4. Check permissions: ls -ld ${checkpointDir}`,
        `  5. Tar command: ${tarBin} -czf ${unixTarballPath} -C ${unixTarDir} ${tarBase}`,
      ].join('\n')

      const err = new Error(errorMsg)
      err.cause = error
      throw err
    }

    const tarStats = await fs.stat(tarballPath)
    const sizeMB = (tarStats.size / 1024 / 1024).toFixed(1)
    logger.substep(`Saved ${checkpointName}.tar.gz (${sizeMB}MB)`)
  }

  // Compute cache hash if sourcePaths provided
  let cacheHash = null
  if (data.sourcePaths && Array.isArray(data.sourcePaths)) {
    cacheHash = await computeSourceHash(data.sourcePaths)
    logger.substep(`Cache key: ${cacheHash.substring(0, 12)}...`)
  }

  logger.log('')

  const checkpointData = {
    created: new Date().toISOString(),
    name: checkpointName,
    ...data,
    // Store hash for cache validation
    cacheHash,
  }

  await fs.writeFile(
    checkpointFile,
    JSON.stringify(checkpointData, null, 2),
    'utf8',
  )

  // In CI: Progressive cleanup - delete only the immediate previous checkpoint in the chain
  // This keeps the latest checkpoint while cleaning up intermediate ones
  const isCI = !!(
    process.env['CI'] ||
    process.env['GITHUB_ACTIONS'] ||
    process.env['GITLAB_CI'] ||
    process.env['CIRCLECI'] ||
    process.env['TRAVIS']
  )

  if (isCI && checkpointChain && data.artifactPath) {
    try {
      // Find current checkpoint's position in chain
      const currentIndex = checkpointChain.indexOf(checkpointName)

      if (currentIndex > 0) {
        // Get the immediate previous checkpoint name (next index, since chain is newest→oldest)
        const previousCheckpointName = checkpointChain[currentIndex + 1]

        if (previousCheckpointName) {
          // Delete both tarball and JSON for the immediate previous checkpoint
          const previousTarball = path.join(
            checkpointDir,
            `${previousCheckpointName}.tar.gz`,
          )
          const previousJson = path.join(
            checkpointDir,
            `${previousCheckpointName}.json`,
          )

          if (existsSync(previousTarball)) {
            logger.substep(
              `Removing previous checkpoint: ${previousCheckpointName}.tar.gz`,
            )
            await safeDelete(previousTarball)
          }

          if (existsSync(previousJson)) {
            logger.substep(
              `Removing previous checkpoint metadata: ${previousCheckpointName}.json`,
            )
            await safeDelete(previousJson)
          }
        }
      }
    } catch (error) {
      // Non-critical: log warning but continue
      logger.info(
        `Warning: Could not clean up previous checkpoint: ${error.message}`,
      )
    }
  }
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
 * Restore checkpoint artifacts from tarball to original location or custom destination.
 * Uses artifactPath from checkpoint metadata to determine extraction location.
 *
 * IMPORTANT: Deletes existing target file/directory before extraction to ensure
 * clean state and prevent corruption from previous failed builds.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name
 * @param {object} [options] - Restoration options
 * @param {string} [options.destDir] - Override extraction directory (extracts to this dir instead of artifactPath's location)
 * @returns {Promise<boolean>} True if restored, false if checkpoint doesn't exist
 */
export async function restoreCheckpoint(
  buildDir,
  packageName,
  checkpointName,
  options = {},
) {
  const checkpointData = await getCheckpointData(
    buildDir,
    packageName,
    checkpointName,
  )

  if (!checkpointData) {
    return false
  }

  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  logger.substep(`Restoring checkpoint '${checkpointName}'`)

  // Restore from tarball if artifactPath specified
  if (checkpointData.artifactPath) {
    const tarballPath = checkpointFile.replace('.json', '.tar.gz')
    const artifactPath = path.isAbsolute(checkpointData.artifactPath)
      ? checkpointData.artifactPath
      : path.join(buildDir, checkpointData.artifactPath)

    try {
      const stats = await fs.stat(tarballPath)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      logger.info(`Extracting checkpoint.tar.gz (${sizeMB} MB)...`)

      // Determine extraction directory
      const extractDir = options.destDir || path.dirname(artifactPath)
      const targetPath = options.destDir
        ? path.join(options.destDir, path.basename(artifactPath))
        : artifactPath

      // Delete existing artifact to ensure clean state
      // This prevents corruption from previous failed builds
      await safeDelete(targetPath)
      if (options.destDir) {
        logger.info(
          `Cleaned existing artifact: ${path.basename(targetPath)} (custom destination)`,
        )
      } else {
        logger.info(`Cleaned existing artifact: ${path.basename(artifactPath)}`)
      }

      // Extract tarball using tar command
      const tarBin = await which('tar')

      // Ensure extraction directory exists
      await safeMkdir(extractDir)

      // Convert Windows paths to Unix-style for Git tar
      const toUnixPath = p => {
        if (!WIN32) {
          return p
        }
        // First normalize to forward slashes, then convert drive letter
        const normalized = normalizePath(p)
        return normalized.replace(
          /^([A-Z]):/i,
          (_, letter) => `/${letter.toLowerCase()}`,
        )
      }

      const unixTarballPath = toUnixPath(tarballPath)
      const unixExtractDir = toUnixPath(extractDir)

      await spawn(tarBin, ['-xzf', unixTarballPath, '-C', unixExtractDir], {
        stdio: 'ignore',
      })

      if (options.destDir) {
        logger.info(
          `Restored: ${path.basename(artifactPath)} → ${extractDir} (custom destination)`,
        )
      } else {
        logger.info(`Restored: ${path.basename(artifactPath)} → ${extractDir}`)
      }
    } catch (error) {
      logger.info(`Warning: Could not restore checkpoint: ${error.message}`)
      return false
    }
  }

  return true
}

/**
 * Clean all workflow checkpoints for a package.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @returns {Promise<void>}
 */
export async function cleanCheckpoint(buildDir, packageName) {
  logger.substep(`Cleaning checkpoints for ${packageName}`)

  const checkpointDir = getCheckpointDir(buildDir, packageName)

  await safeDelete(checkpointDir)
  logger.info('Checkpoints cleaned')
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
 * Check if build should run based on checkpoint, cache hash, and --force flag.
 *
 * @param {string} buildDir - Build directory path
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name
 * @param {boolean} force - Force rebuild flag
 * @param {string[]} [sourcePaths] - Source paths to validate cache hash against
 * @returns {Promise<boolean>} True if should run, false if should skip
 */
export async function shouldRun(
  buildDir,
  packageName,
  checkpointName,
  force = false,
  sourcePaths = null,
) {
  if (force) {
    return true
  }

  const exists = await hasCheckpoint(buildDir, packageName, checkpointName)

  if (!exists) {
    return true
  }

  // If checkpoint exists and sourcePaths provided, validate cache hash
  if (sourcePaths && Array.isArray(sourcePaths) && sourcePaths.length > 0) {
    const checkpointData = await getCheckpointData(
      buildDir,
      packageName,
      checkpointName,
    )

    if (checkpointData?.cacheHash) {
      const currentHash = await computeSourceHash(sourcePaths)

      if (currentHash !== checkpointData.cacheHash) {
        logger.substep(
          `Checkpoint '${checkpointName}' exists but source files changed (cache invalidated)`,
        )
        return true
      }
    }
  }

  logger.substep(
    `Checkpoint '${checkpointName}' exists and cache valid, skipping`,
  )
  return false
}

/**
 * CACHE KEY MANAGEMENT
 *
 * Centralized cache key helpers for build source validation.
 * Provides single source of truth for cache file naming and validation.
 */

/**
 * Get cache validation hash file path.
 * Single source of truth for cache hash filename.
 *
 * @param {string} cacheDir - Cache directory path (e.g., 'build/dev/.cache')
 * @returns {string} Cache hash file path
 */
export function getCacheHashFile(cacheDir) {
  return path.join(cacheDir, 'cache-validation.hash')
}

/**
 * Check if build cache is valid based on source file hashes.
 *
 * @param {string} cacheDir - Cache directory path
 * @param {string[]} sourcePaths - Source file paths to validate
 * @returns {Promise<boolean>} True if cache needs rebuild, false if valid
 */
export async function needsCacheRebuild(cacheDir, sourcePaths) {
  const hashFilePath = getCacheHashFile(cacheDir)
  return await shouldExtract({
    sourcePaths,
    outputPath: hashFilePath,
  })
}

/**
 * Write cache validation hash file.
 *
 * @param {string} cacheDir - Cache directory path
 * @param {string[]} sourcePaths - Source file paths to hash
 * @returns {Promise<void>}
 */
export async function writeCacheHash(cacheDir, sourcePaths) {
  const hashFilePath = getCacheHashFile(cacheDir)

  // Ensure cache directory exists
  await safeMkdir(cacheDir)

  // Generate and write hash
  const hashComment = generateHashComment(sourcePaths)
  await fs.writeFile(hashFilePath, hashComment, 'utf-8')

  logger.info(`Cache hash: ${hashFilePath}`)
}

/**
 * Get current cache hash for source files.
 *
 * @param {string[]} sourcePaths - Source file paths to hash
 * @returns {Promise<string>} SHA256 hash (hex)
 */
export function getCacheHash(sourcePaths) {
  return computeSourceHash(sourcePaths)
}
