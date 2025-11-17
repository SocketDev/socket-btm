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
import { normalizePath } from '@socketsecurity/lib/paths/normalize'
import { spawn } from '@socketsecurity/lib/spawn'

import { printStep, printSubstep } from './build-output.mjs'
import {
  computeSourceHash,
  generateHashComment,
  shouldExtract,
} from './extraction-cache.mjs'

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
 * @param {string} packageName - Package name
 * @param {string} checkpointName - Checkpoint name (e.g., 'release', 'patches-applied')
 * @param {Function} smokeTest - Async function that validates build artifacts (REQUIRED)
 * @param {object} data - Checkpoint metadata
 * @param {string} [data.artifactPath] - Path to file or directory to archive in checkpoint
 * @param {string[]} [data.sourcePaths] - Source file paths to hash for cache validation
 * @returns {Promise<void>}
 *
 * @example
 * await createCheckpoint(BUILD_DIR, '', 'release', async () => {
 *   // Smoke test: Verify binary runs
 *   await spawn(binaryPath, ['--version'])
 * }, {
 *   artifactPath: './out/Release/node', // Archive this binary
 *   sourcePaths: ['build.mjs', 'patches/*.patch'], // Cache key
 * })
 */
export async function createCheckpoint(
  buildDir,
  packageName,
  checkpointName,
  smokeTest,
  data = {},
) {
  // Enforce smoke test requirement
  if (typeof smokeTest !== 'function') {
    throw new Error(
      'createCheckpoint requires a smokeTest callback function. ' +
        `Got: ${typeof smokeTest}. ` +
        'Pattern: createCheckpoint(buildDir, pkg, name, async () => { /* test */ }, data)',
    )
  }

  // Sign binary on macOS BEFORE smoke test (required for execution)
  if (data.binaryPath && process.platform === 'darwin') {
    const binaryPath = path.isAbsolute(data.binaryPath)
      ? data.binaryPath
      : path.join(buildDir, data.binaryPath)

    try {
      // Check if binary is already signed
      const checkResult = await spawn('codesign', ['--verify', binaryPath], {
        stdio: 'ignore',
      })

      // If not signed (non-zero exit), sign it
      if (checkResult.code !== 0) {
        printSubstep(`Signing binary on macOS: ${path.basename(binaryPath)}`)
        await spawn('codesign', ['--sign', '-', '--force', binaryPath])
        printSubstep('Binary signed successfully')
      }
    } catch {
      // Ignore signing errors (codesign may not be available)
      // This is non-critical - smoke test will catch if binary is unusable
    }
  }

  // Run smoke test BEFORE creating checkpoint
  printSubstep(`Smoke testing for checkpoint: ${checkpointName}`)
  try {
    await smokeTest()
  } catch (error) {
    throw new Error(
      `Smoke test failed for checkpoint '${checkpointName}': ${error.message}`,
    )
  }

  printSubstep(`Creating checkpoint: ${checkpointName}`)

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

    printSubstep(`Archiving ${tarBase} ${isDir ? '(directory)' : '(file)'}...`)

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
      await spawn(
        tarBin,
        ['-czf', unixTarballPath, '-C', unixTarDir, tarBase],
        {
          stdio: 'inherit',
        },
      )
    } catch (error) {
      printSubstep(`Tar command: ${tarBin}`)
      printSubstep(
        `Tar args: -czf ${unixTarballPath} -C ${unixTarDir} ${tarBase}`,
      )
      printSubstep(`Working dir exists: ${existsSync(tarDir)}`)
      printSubstep(`Source exists: ${existsSync(artifactPath)}`)
      throw error
    }

    const tarStats = await fs.stat(tarballPath)
    const sizeMB = (tarStats.size / 1024 / 1024).toFixed(2)
    printSubstep(`Checkpoint saved: checkpoint.tar.gz (${sizeMB} MB)`)
  }

  // Compute cache hash if sourcePaths provided
  let cacheHash = null
  if (data.sourcePaths && Array.isArray(data.sourcePaths)) {
    cacheHash = await computeSourceHash(data.sourcePaths)
    printSubstep(`Cache hash computed: ${cacheHash.substring(0, 12)}...`)
  }

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

  printStep(`Restoring checkpoint '${checkpointName}'`)

  // Restore from tarball if artifactPath specified
  if (checkpointData.artifactPath) {
    const tarballPath = checkpointFile.replace('.json', '.tar.gz')
    const artifactPath = path.isAbsolute(checkpointData.artifactPath)
      ? checkpointData.artifactPath
      : path.join(buildDir, checkpointData.artifactPath)

    try {
      const stats = await fs.stat(tarballPath)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
      printSubstep(`Extracting checkpoint.tar.gz (${sizeMB} MB)...`)

      // Determine extraction directory
      const extractDir = options.destDir || path.dirname(artifactPath)
      const targetPath = options.destDir
        ? path.join(options.destDir, path.basename(artifactPath))
        : artifactPath

      // Delete existing artifact to ensure clean state
      // This prevents corruption from previous failed builds
      await safeDelete(targetPath)
      if (options.destDir) {
        printSubstep(
          `Cleaned existing artifact: ${path.basename(targetPath)} (custom destination)`,
        )
      } else {
        printSubstep(
          `Cleaned existing artifact: ${path.basename(artifactPath)}`,
        )
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
        printSubstep(
          `Restored: ${path.basename(artifactPath)} → ${extractDir} (custom destination)`,
        )
      } else {
        printSubstep(`Restored: ${path.basename(artifactPath)} → ${extractDir}`)
      }
    } catch (error) {
      printSubstep(`Warning: Could not restore checkpoint: ${error.message}`)
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
        printStep(
          `Checkpoint '${checkpointName}' exists but source files changed (cache invalidated)`,
        )
        return true
      }
    }
  }

  printStep(`Checkpoint '${checkpointName}' exists and cache valid, skipping`)
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
  const hashComment = await generateHashComment(sourcePaths)
  await fs.writeFile(hashFilePath, hashComment, 'utf-8')

  printSubstep(`Cache hash: ${hashFilePath}`)
}

/**
 * Get current cache hash for source files.
 *
 * @param {string[]} sourcePaths - Source file paths to hash
 * @returns {Promise<string>} SHA256 hash (hex)
 */
export async function getCacheHash(sourcePaths) {
  return await computeSourceHash(sourcePaths)
}
