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

import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  existsSync,
  openSync,
  promises as fs,
  readSync,
  renameSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'

import { which } from '@socketsecurity/lib/bin'
import { DARWIN } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  computeSourceHash,
  generateHashComment,
  shouldExtract,
} from './extraction-cache.mjs'
import { adHocSign } from './sign.mjs'
import { extractTarball, toTarPath } from './tarball-utils.mjs'

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
export function hasCheckpoint(buildDir, packageName, checkpointName) {
  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  return existsSync(checkpointFile)
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
 * @param {string} checkpointName - Checkpoint name (e.g., CHECKPOINTS.FINALIZED, CHECKPOINTS.BINARY_RELEASED)
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
 * await createCheckpoint(BUILD_DIR, CHECKPOINTS.FINALIZED, async () => {
 *   await spawn(binaryPath, ['--version'])
 * })
 *
 * // With options
 * await createCheckpoint(BUILD_DIR, CHECKPOINTS.BINARY_RELEASED, async () => {
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
    libc,
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
    libc,
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

  // Build checkpoint identifier with platform/arch/libc if provided
  let checkpointId = checkpointName
  if (platform && arch) {
    const libcSuffix = libc ? `-${libc}` : ''
    checkpointId = `${checkpointName} (${platform}-${arch}${libcSuffix})`
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

  // Track whether checkpoint was already created by concurrent build
  let checkpointAlreadyExists = false

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

    // Use atomic writes: create temp file then rename
    // This prevents race conditions in concurrent CI builds
    // Include timestamp and crypto-random suffix to prevent PID reuse collisions
    const randomId = randomBytes(8).toString('hex')
    const tempTarballPath = `${tarballPath}.tmp.${process.pid}.${Date.now()}.${randomId}`
    const unixTempTarballPath = toTarPath(tempTarballPath)
    const unixTarDir = toTarPath(tarDir)

    try {
      // Create tarball with artifact as top-level entry
      // -c: create archive
      // -z: compress with gzip
      // -f: output file
      // -C: change to directory before archiving (ensures artifact becomes top-level entry)
      // --exclude='._*': exclude macOS AppleDouble resource fork files
      // tarBase: the artifact basename to archive (file or directory)
      //
      // Example: tar -czf checkpoint.tar.gz.tmp.12345 -C /build/dev/out Final
      //   → Creates tarball containing Final/ as top-level entry
      //   → During extraction, preserves directory structure (Final/ is recreated in extractDir)
      await spawn(
        tarBin,
        [
          '-czf',
          unixTempTarballPath,
          '--exclude=._*',
          '-C',
          unixTarDir,
          tarBase,
        ],
        {
          // On macOS, COPYFILE_DISABLE=1 prevents tar from including
          // AppleDouble resource fork files (._* files) which cause
          // compilation errors when extracted on Linux.
          env: DARWIN ? { ...process.env, COPYFILE_DISABLE: '1' } : process.env,
          stdio: 'inherit',
        },
      )

      // Validate temp tarball before rename
      const tempStats = await fs.stat(tempTarballPath)
      if (tempStats.size === 0) {
        rmSync(tempTarballPath, { force: true })
        throw new Error(
          `Tar created empty file (0 bytes). Artifact may not exist or tar command failed: ${artifactPath}`,
        )
      }

      // Check for unreasonably large checkpoints (>2GB indicates unintended files included)
      const MAX_CHECKPOINT_SIZE = 2 * 1024 * 1024 * 1024
      if (tempStats.size > MAX_CHECKPOINT_SIZE) {
        rmSync(tempTarballPath, { force: true })
        throw new Error(
          `Checkpoint tarball exceeds maximum size: ${(tempStats.size / 1024 / 1024).toFixed(1)}MB > 2048MB. ` +
            `This may indicate unintended files were included in checkpoint: ${artifactPath}`,
        )
      }

      // Check gzip magic bytes to ensure tar created valid gzip file
      const fd = openSync(tempTarballPath, 'r')
      try {
        const buffer = Buffer.alloc(2)
        readSync(fd, buffer, 0, 2, 0)
        if (buffer[0] !== 0x1f || buffer[1] !== 0x8b) {
          throw new Error(
            `Tar created invalid gzip file (missing magic bytes 0x1f 0x8b): ${tempTarballPath}`,
          )
        }
      } finally {
        closeSync(fd)
      }

      // Validate tarball integrity by listing contents (catches truncated/corrupted archives)
      const listResult = await spawn(
        tarBin,
        ['-tzf', toTarPath(tempTarballPath)],
        {
          stdio: 'pipe',
        },
      )
      if (listResult.code !== 0) {
        throw new Error(
          'Tarball validation failed - archive appears corrupted or truncated',
        )
      }
      // Verify expected content is present in tarball
      const tarContents = listResult.stdout.toString()
      if (!tarContents.includes(tarBase)) {
        throw new Error(`Tarball missing expected file: ${tarBase}`)
      }

      // Atomically rename temp file to final location (prevents concurrent write corruption)
      // Note: If concurrent builds create the same checkpoint, both will produce identical
      // output (deterministic builds), so it's safe if one overwrites the other. We use
      // unique temp files (PID + random ID) to prevent corruption during creation.
      try {
        renameSync(tempTarballPath, tarballPath)
      } catch (error) {
        // On some platforms, rename may fail if target exists and is being accessed
        if (error.code === 'EEXIST' || error.code === 'EPERM') {
          // Verify existing checkpoint is complete before giving up
          try {
            const existingStats = await fs.stat(tarballPath)
            if (existingStats.size > 0) {
              logger.warn(
                `Checkpoint already exists: ${tarballPath}. Concurrent build detected, skipping overwrite.`,
              )
              rmSync(tempTarballPath, { force: true })
              checkpointAlreadyExists = true
              // Don't return - continue to cleanup code
            } else {
              // Existing checkpoint is incomplete (0 bytes), retry once
              await new Promise(resolve => setTimeout(resolve, 100))
              renameSync(tempTarballPath, tarballPath)
            }
          } catch {
            rmSync(tempTarballPath, { force: true })
            checkpointAlreadyExists = true
          }
        } else {
          // For other errors, let them propagate to the outer catch block
          throw error
        }
      }
    } catch (error) {
      // Clean up temp file on failure
      if (existsSync(tempTarballPath)) {
        rmSync(tempTarballPath, { force: true })
      }
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
        `  5. Tar command: ${tarBin} -czf ${unixTempTarballPath} --exclude=._* -C ${unixTarDir} ${tarBase}`,
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
  let cacheHash
  if (data.sourcePaths && Array.isArray(data.sourcePaths)) {
    // Source-stage checkpoints (source-copied, source-patched) are platform-agnostic
    // because the same patches apply regardless of target platform. Only binary
    // compilation stages (compiled, stripped, compressed, finalized) need
    // platform-specific cache keys.
    const isPlatformAgnostic = checkpointName.startsWith('source-')

    const platformMetadata =
      !isPlatformAgnostic && platform && arch
        ? `${platform}-${arch}${libc ? `-${libc}` : ''}`
        : undefined
    const versionMetadata = data.nodeVersion
      ? `node-${data.nodeVersion}`
      : undefined

    // Include environment variables that affect builds in cache key
    const envVars = [
      process.env.NODE_OPTIONS,
      process.env.UV_THREADPOOL_SIZE,
      process.env.V8_OPTIONS,
    ].filter(Boolean)

    const envMetadata =
      envVars.length > 0
        ? `env-${envVars
            .map(v => createHash('sha256').update(v).digest('hex').slice(0, 8))
            .join('-')}`
        : undefined

    // Include build configuration that affects binary output
    // Validate buildMode to prevent cache poisoning
    if (data.buildMode) {
      const validBuildModes = ['dev', 'prod', 'int4', 'int8']
      if (!validBuildModes.includes(data.buildMode)) {
        throw new Error(
          `Invalid buildMode: "${data.buildMode}". ` +
            `Must be one of: ${validBuildModes.join(', ')}`,
        )
      }
    }
    // Validate withLief to prevent cache poisoning
    if (data.withLief !== undefined && typeof data.withLief !== 'boolean') {
      throw new Error(
        `Invalid withLief: expected boolean, got ${typeof data.withLief}`,
      )
    }
    // Validate configureFlags to prevent cache poisoning
    if (
      data.configureFlags !== undefined &&
      typeof data.configureFlags !== 'string'
    ) {
      throw new Error(
        `Invalid configureFlags: expected string, got ${typeof data.configureFlags}`,
      )
    }
    const buildModeMetadata = data.buildMode
      ? `build-${data.buildMode}`
      : undefined
    const liefMetadata =
      data.withLief !== undefined ? `lief-${data.withLief}` : undefined
    const configureFlagsMetadata = data.configureFlags
      ? `config-${createHash('sha256').update(data.configureFlags).digest('hex').slice(0, 8)}`
      : undefined

    const fullMetadata = [
      platformMetadata,
      versionMetadata,
      envMetadata,
      buildModeMetadata,
      liefMetadata,
      configureFlagsMetadata,
    ]
      .filter(Boolean)
      .join('_')
    cacheHash = computeSourceHash(
      data.sourcePaths,
      fullMetadata || platformMetadata,
    )
    logger.substep(`Cache key: ${cacheHash.substring(0, 12)}...`)
  }

  logger.log('')

  // Only write checkpoint JSON if we actually created the tarball
  // (skip if concurrent build already created it)
  if (!checkpointAlreadyExists) {
    const checkpointData = {
      created: new Date().toISOString(),
      name: checkpointName,
      ...data,
      // Store hash for cache validation
      cacheHash,
    }

    // Write checkpoint JSON atomically using temp file + rename pattern
    // This prevents corruption if process crashes mid-write
    const tempCheckpointFile = `${checkpointFile}.tmp.${process.pid}.${Date.now()}`
    await fs.writeFile(
      tempCheckpointFile,
      JSON.stringify(checkpointData, null, 2),
      'utf8',
    )
    try {
      renameSync(tempCheckpointFile, checkpointFile)
    } catch (error) {
      // Handle concurrent builds writing same checkpoint JSON
      if (error.code === 'EEXIST' || error.code === 'EPERM') {
        logger.warn(
          `Checkpoint JSON already exists: ${checkpointFile}. Concurrent build detected.`,
        )
        rmSync(tempCheckpointFile, { force: true })
        // Don't return - continue to cleanup code
      } else {
        throw error
      }
    }
  }

  // In CI: Progressive cleanup - delete only the immediate previous checkpoint in the chain
  // This keeps the latest checkpoint while cleaning up intermediate ones to save disk space.
  //
  // Trade-off: This aggressive space optimization means earlier checkpoints in the chain
  // may not be available for recovery. If a build needs to restart from an earlier stage
  // (e.g., source-copied), it will need to rebuild from scratch rather than restoring
  // from checkpoint. This is intentional to optimize CI storage usage.
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

      // Ensure currentIndex is valid and there's a next element in the chain
      if (currentIndex >= 0 && currentIndex + 1 < checkpointChain.length) {
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
            // Only delete if checkpoint is >5 minutes old (grace period for concurrent builds)
            const stats = await fs.stat(previousTarball)
            const ageMs = Math.max(0, Date.now() - stats.mtimeMs)
            // 5 minutes
            const CLEANUP_GRACE_PERIOD_MS = 5 * 60 * 1000

            if (ageMs > CLEANUP_GRACE_PERIOD_MS) {
              logger.substep(
                `Removing previous checkpoint: ${previousCheckpointName}.tar.gz (${Math.floor(ageMs / 60_000)}min old)`,
              )
              await safeDelete(previousTarball)

              if (existsSync(previousJson)) {
                await safeDelete(previousJson)
              }
            } else {
              logger.substep(
                `Keeping recent checkpoint: ${previousCheckpointName}.tar.gz (${Math.floor(ageMs / 1000)}s old)`,
              )
            }
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
 * @returns {Promise<object|undefined>} Checkpoint data or undefined if not found
 */
export async function getCheckpointData(buildDir, packageName, checkpointName) {
  const checkpointFile = getCheckpointFile(
    buildDir,
    packageName,
    checkpointName,
  )

  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    try {
      return JSON.parse(content)
    } catch (parseErr) {
      throw new Error(
        `Checkpoint file contains invalid JSON: ${checkpointFile}. ` +
          `File may be corrupted. Run with --clean to rebuild. Parse error: ${parseErr.message}`,
      )
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist - return undefined (checkpoint not found)
      return undefined
    }
    throw err
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
 * @param {string} [options.platform] - Expected platform (darwin, linux, win32) - skips restoration if mismatch
 * @param {string} [options.arch] - Expected architecture (x64, arm64) - skips restoration if mismatch
 * @param {string} [options.libc] - Expected libc (musl, glibc) - skips restoration if mismatch
 * @returns {Promise<boolean>} True if restored, false if checkpoint doesn't exist or validation failed
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

  // Validate platform/arch/libc if specified in options
  // Throw errors instead of warnings to prevent cross-platform checkpoint pollution
  if (
    options.platform &&
    checkpointData.platform &&
    options.platform !== checkpointData.platform
  ) {
    throw new Error(
      `Checkpoint platform mismatch: expected ${options.platform}, got ${checkpointData.platform}. ` +
        'Cannot restore checkpoint across platforms. Run with --clean to rebuild for target platform.',
    )
  }

  if (
    options.arch &&
    checkpointData.arch &&
    options.arch !== checkpointData.arch
  ) {
    throw new Error(
      `Checkpoint arch mismatch: expected ${options.arch}, got ${checkpointData.arch}. ` +
        'Cannot restore checkpoint across architectures. Run with --clean to rebuild for target architecture.',
    )
  }

  if (
    options.libc &&
    checkpointData.libc &&
    options.libc !== checkpointData.libc
  ) {
    throw new Error(
      `Checkpoint libc mismatch: expected ${options.libc}, got ${checkpointData.libc}. ` +
        'Cannot restore checkpoint across libc implementations. Run with --clean to rebuild for target libc.',
    )
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

    // Validate artifactPath doesn't escape buildDir (defense-in-depth)
    if (!path.isAbsolute(checkpointData.artifactPath)) {
      const normalized = path.normalize(artifactPath)
      const normalizedBuildDir = path.normalize(buildDir)
      if (!normalized.startsWith(normalizedBuildDir)) {
        throw new Error(
          `Checkpoint artifactPath escapes build directory: ${checkpointData.artifactPath}`,
        )
      }
    }

    try {
      const stats = await fs.stat(tarballPath)
      const initialModTime = stats.mtimeMs
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

      // Validate checkpoint integrity
      if (stats.size === 0) {
        logger.warn(`Checkpoint file is empty: ${tarballPath}`)
        return false
      }

      // Quick validation: check gzip magic bytes (0x1f 0x8b)
      try {
        // Check minimum gzip size (header 10 bytes + footer 8 bytes = 18 bytes minimum)
        // This detects truncated archives that would fail during extraction
        if (stats.size < 18) {
          logger.warn(
            `Checkpoint file too small to be valid gzip (${stats.size} bytes): ${tarballPath}`,
          )
          return false
        }

        const fd = openSync(tarballPath, 'r')
        try {
          // Check gzip header (magic bytes)
          const headerBuffer = Buffer.alloc(2)
          readSync(fd, headerBuffer, 0, 2, 0)

          if (headerBuffer[0] !== 0x1f || headerBuffer[1] !== 0x8b) {
            logger.warn(
              `Checkpoint file is not a valid gzip archive: ${tarballPath}`,
            )
            return false
          }

          // Check gzip footer (CRC32 and ISIZE in last 8 bytes) to detect truncated archives
          const footerBuffer = Buffer.alloc(8)
          readSync(fd, footerBuffer, 0, 8, stats.size - 8)

          const crc32 = footerBuffer.readUInt32LE(0)
          const isize = footerBuffer.readUInt32LE(4)

          // Both CRC32 and ISIZE being zero is highly unlikely for valid archives
          // This detects truncated files that have valid headers but corrupted/missing footers
          if (crc32 === 0 && isize === 0) {
            logger.warn(
              `Checkpoint gzip footer is invalid (likely truncated file): ${tarballPath}`,
            )
            return false
          }
        } finally {
          closeSync(fd)
        }
      } catch (err) {
        logger.warn(`Failed to validate checkpoint file: ${err.message}`)
        return false
      }

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

      // Extract tarball using shared utility with path traversal protection.
      // Add retry logic to handle TOCTOU race where checkpoint is deleted between
      // validation and extraction (e.g., concurrent build's cleanup)
      let extractAttempts = 0
      const MAX_EXTRACT_ATTEMPTS = 3
      let extractError

      while (extractAttempts < MAX_EXTRACT_ATTEMPTS) {
        try {
          // Re-validate checkpoint exists before extraction (catches TOCTOU deletion)
          // eslint-disable-next-line no-await-in-loop
          const preExtractStats = await fs.stat(tarballPath)
          if (preExtractStats.size === 0) {
            throw new Error('Checkpoint file became empty before extraction')
          }

          // Check if checkpoint was replaced (mtime changed significantly)
          const mtimeDelta = Math.abs(preExtractStats.mtimeMs - initialModTime)
          if (mtimeDelta > 10 * 1000) {
            throw new Error(
              'Checkpoint was replaced during restoration (mtime changed). ' +
                'This indicates concurrent builds creating new checkpoints. ' +
                'Rebuild with --clean to create fresh checkpoints.',
            )
          }

          // eslint-disable-next-line no-await-in-loop
          await extractTarball(tarballPath, extractDir)
          extractError = undefined
          // Success
          break
        } catch (err) {
          extractError = err
          extractAttempts++

          // Detect permanent deletion vs transient race
          if (err.code === 'ENOENT' || err.message.includes('ENOENT')) {
            // Check if cleanup deleted the file (was >5min old)
            const ageMs = Math.max(0, Date.now() - initialModTime)
            if (ageMs > 5 * 60 * 1000) {
              // Checkpoint was old and cleanup deleted it - don't retry
              throw new Error(
                `Checkpoint was permanently deleted by cleanup (${Math.floor(ageMs / 60_000)}min old): ${tarballPath}. ` +
                  'Rebuild with --clean to create fresh checkpoints.',
              )
            }

            // Transient race - retry if attempts remain
            if (extractAttempts < MAX_EXTRACT_ATTEMPTS) {
              logger.warn(
                `Checkpoint deleted during restoration, retrying (${extractAttempts}/${MAX_EXTRACT_ATTEMPTS})...`,
              )
              // eslint-disable-next-line no-await-in-loop
              await new Promise(resolve =>
                setTimeout(resolve, 1000 * extractAttempts),
              )
              continue
            }
          }

          // Max attempts reached or different error
          break
        }
      }

      if (extractError) {
        if (
          extractError.code === 'ENOENT' ||
          extractError.message.includes('ENOENT')
        ) {
          throw new Error(
            `Checkpoint was deleted during restoration after ${MAX_EXTRACT_ATTEMPTS} attempts: ${tarballPath}. ` +
              'This may indicate concurrent builds or checkpoint cleanup. ' +
              'Try rebuilding with --clean to create fresh checkpoints.',
          )
        }
        throw new Error(`Checkpoint extraction failed: ${extractError.message}`)
      }

      // Verify extraction succeeded with single stat() call (avoid TOCTOU race)
      let extractedStats
      try {
        extractedStats = await fs.stat(targetPath)
      } catch (err) {
        if (err.code === 'ENOENT') {
          throw new Error(
            `Checkpoint extraction failed: expected artifact not found after extraction: ${path.basename(targetPath)}`,
          )
        }
        throw err
      }

      // Verify artifact is not empty (basic sanity check for files)
      if (extractedStats.isFile() && extractedStats.size === 0) {
        throw new Error(
          `Checkpoint extraction failed: artifact is empty after extraction: ${path.basename(targetPath)}`,
        )
      }

      if (options.destDir) {
        logger.info(
          `Restored: ${path.basename(artifactPath)} → ${extractDir} (custom destination)`,
        )
      } else {
        logger.info(`Restored: ${path.basename(artifactPath)} → ${extractDir}`)
      }
    } catch (error) {
      throw new Error(
        `Checkpoint restoration failed for ${path.basename(artifactPath)}: ${error.message}. ` +
          'Build artifacts may be corrupted. Try cleaning checkpoints and rebuilding.',
      )
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
 * @param {object} [options] - Build options for cross-compilation validation
 * @param {string} [options.platform] - Target platform (darwin, linux, win32)
 * @param {string} [options.arch] - Target architecture (x64, arm64)
 * @param {string} [options.libc] - Target libc (glibc, musl) for Linux
 * @returns {Promise<boolean>} True if should run, false if should skip
 */
export async function shouldRun(
  buildDir,
  packageName,
  checkpointName,
  force = false,
  sourcePaths = undefined,
  options = {},
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

    // Force rebuild if checkpoint has no cache hash but we need to validate sources
    if (!checkpointData?.cacheHash) {
      logger.substep(
        `Checkpoint '${checkpointName}' exists but has no cache hash (sources need validation)`,
      )
      return true
    }

    // Source-stage checkpoints (source-copied, source-patched) are platform-agnostic
    // because the same patches apply regardless of target platform. Only binary
    // compilation stages need platform-specific cache keys.
    const isPlatformAgnostic = checkpointName.startsWith('source-')

    let currentCacheHash
    if (isPlatformAgnostic) {
      // Source checkpoints: validate ONLY source file content (no platform metadata)
      currentCacheHash = computeSourceHash(sourcePaths)
    } else {
      // Binary checkpoints: include platform/arch/libc in validation
      // NOTE: For cross-compilation, options.platform/arch SHOULD be provided explicitly.
      // Falls back to process.platform/process.arch for same-platform builds.
      const targetPlatform = options.platform || process.platform
      const targetArch = options.arch || process.arch
      const targetLibc = options.libc || undefined

      if (!targetPlatform || !targetArch) {
        logger.substep(
          `Checkpoint '${checkpointName}' missing target platform metadata (requires rebuild)`,
        )
        return true
      }

      // For Linux binary checkpoints, libc MUST be specified
      if (targetPlatform === 'linux' && !targetLibc) {
        logger.substep(
          `Checkpoint '${checkpointName}' requires explicit libc for Linux binary validation (requires rebuild)`,
        )
        return true
      }

      const platformMetadata = `${targetPlatform}-${targetArch}${targetLibc ? `-${targetLibc}` : ''}`
      const versionMetadata = options.nodeVersion
        ? `node-${options.nodeVersion}`
        : undefined

      // Include environment variables that affect builds in cache key (must match createCheckpoint logic)
      const envVars = [
        process.env.NODE_OPTIONS,
        process.env.UV_THREADPOOL_SIZE,
        process.env.V8_OPTIONS,
      ].filter(Boolean)

      const envMetadata =
        envVars.length > 0
          ? `env-${envVars
              .map(v =>
                createHash('sha256').update(v).digest('hex').slice(0, 8),
              )
              .join('-')}`
          : undefined

      // Include build configuration that affects binary output (must match createCheckpoint logic)
      // Validate buildMode to prevent cache poisoning
      if (options.buildMode) {
        const validBuildModes = ['dev', 'prod', 'int4', 'int8']
        if (!validBuildModes.includes(options.buildMode)) {
          throw new Error(
            `Invalid buildMode: "${options.buildMode}". ` +
              `Must be one of: ${validBuildModes.join(', ')}`,
          )
        }
      }
      // Validate withLief to prevent cache poisoning
      if (
        options.withLief !== undefined &&
        typeof options.withLief !== 'boolean'
      ) {
        throw new Error(
          `Invalid withLief: expected boolean, got ${typeof options.withLief}`,
        )
      }
      // Validate configureFlags to prevent cache poisoning
      if (
        options.configureFlags !== undefined &&
        typeof options.configureFlags !== 'string'
      ) {
        throw new Error(
          `Invalid configureFlags: expected string, got ${typeof options.configureFlags}`,
        )
      }
      const buildModeMetadata = options.buildMode
        ? `build-${options.buildMode}`
        : undefined
      const liefMetadata =
        options.withLief !== undefined ? `lief-${options.withLief}` : undefined
      const configureFlagsMetadata = options.configureFlags
        ? `config-${createHash('sha256').update(options.configureFlags).digest('hex').slice(0, 8)}`
        : undefined

      const fullMetadata = [
        platformMetadata,
        versionMetadata,
        envMetadata,
        buildModeMetadata,
        liefMetadata,
        configureFlagsMetadata,
      ]
        .filter(Boolean)
        .join('_')
      currentCacheHash = computeSourceHash(
        sourcePaths,
        fullMetadata || platformMetadata,
      )
    }

    if (currentCacheHash !== checkpointData.cacheHash) {
      logger.substep(
        `Checkpoint '${checkpointName}' exists but source files changed (cache invalidated)`,
      )
      return true
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

  // Generate and write hash atomically
  const hashComment = generateHashComment(sourcePaths)
  const tempHashFile = `${hashFilePath}.tmp.${process.pid}.${Date.now()}`
  await fs.writeFile(tempHashFile, hashComment, 'utf-8')
  try {
    renameSync(tempHashFile, hashFilePath)
  } catch (error) {
    // Handle concurrent builds writing same hash file
    if (error.code === 'EEXIST' || error.code === 'EPERM') {
      // Concurrent build already wrote hash file - safe to ignore since
      // deterministic builds produce identical hashes
      rmSync(tempHashFile, { force: true })
      return
    }
    throw error
  }

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
