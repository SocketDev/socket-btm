#!/usr/bin/env node
/**
 * @fileoverview Compressed Binary Build Phase
 *
 * This script handles the "Compressed" build phase:
 * 1. Compress stripped binary using platform-specific compression
 * 2. Create self-extracting binary with built-in decompressor
 * 3. Smoke test compressed binary
 * 4. Create compressed checkpoint
 *
 * The self-extracting stub has decompression built-in (no external binflate needed).
 *
 * This phase depends on the Stripped phase checkpoint.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import {
  createCheckpoint,
  exec,
  getFileSize,
  smokeTestBinary,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { restoreCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { getBinOutDir } from 'build-infra/lib/constants'
import { ALPINE_RELEASE_FILE } from 'build-infra/lib/environment-constants'
import { adHocSign } from 'build-infra/lib/sign'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { BINJECT_DIR, COMPRESS_BINARY_SCRIPT, PACKAGE_ROOT } from './paths.mjs'
import { verifyCompressionTools } from '../../common/shared/compression-tools.mjs'

const logger = getDefaultLogger()

// binject is built from source (not downloaded) for tests.
// Output directory: packages/binject/build/{mode}/out/Final/
const BINJECT_OUT_DIR = getBinOutDir(BINJECT_DIR)

/**
 * Detect if running on musl libc (Alpine Linux).
 */
function detectHostLibc() {
  if (process.platform !== 'linux') {
    return null
  }

  // Check for Alpine release file.
  if (existsSync(ALPINE_RELEASE_FILE)) {
    return 'musl'
  }

  // Check ldd version for musl.
  try {
    const { execSync } = require('node:child_process')
    const lddVersion = execSync('ldd --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return lddVersion.includes('musl') ? 'musl' : 'glibc'
  } catch {
    // Default to glibc if detection fails
    return 'glibc'
  }
}

/**
 * Build binject injection tool if it doesn't exist.
 */
async function ensureBinjectBuilt() {
  // Check if binject binary exists.
  const binjectBinaryName =
    process.platform === 'win32' ? 'binject.exe' : 'binject'
  const binjectBinaryPath = path.join(BINJECT_OUT_DIR, binjectBinaryName)
  const binjectExists = existsSync(binjectBinaryPath)

  if (binjectExists) {
    logger.substep('Binary injection tool already built: binject')
    return
  }

  logger.step('Building Binary Injection Tool (binject)')
  logger.log('Building binject for SEA binary injection...')
  logger.logNewline()

  // Try to restore from checkpoint chain (finalized, then lief-built).
  const binjectBuildDir = path.join(BINJECT_DIR, 'build')
  const checkpointChain = ['finalized', 'lief-built']

  let checkpointRestored = false
  for (const checkpoint of checkpointChain) {
    logger.substep(`Checking checkpoint: ${checkpoint}`)
    checkpointRestored = await restoreCheckpoint(
      binjectBuildDir,
      'binject',
      checkpoint,
      { destDir: BINJECT_OUT_DIR },
    )

    if (checkpointRestored) {
      logger.substep(`Restored binject from checkpoint: ${checkpoint}`)

      // Verify binject was restored.
      const binjectRestored = existsSync(binjectBinaryPath)
      if (binjectRestored) {
        logger.logNewline()
        logger.success(`binject restored from checkpoint: ${checkpoint}`)
        logger.logNewline()
        return
      }

      logger.warn(
        'Checkpoint restored but binary not found, trying next checkpoint...',
      )
    }
  }

  // Build from source.
  logger.substep('No checkpoint available, building from source...')
  logger.logNewline()

  // Use pnpm to run the build script which handles LIEF on macOS.
  const pnpmPath = await which('pnpm', { nothrow: true })
  if (!pnpmPath) {
    printError('Build Tool Not Found', "Build tool 'pnpm' not found in PATH", [
      'Install pnpm: npm install -g pnpm',
      'binject is required for binary injection in tests',
    ])
    throw new Error("Build tool 'pnpm' not found. Install it first.")
  }

  logger.substep(`Using pnpm: ${pnpmPath}`)
  logger.substep('Command: pnpm run build')
  logger.substep(`Directory: ${path.relative(PACKAGE_ROOT, BINJECT_DIR)}`)
  logger.logNewline()

  // Execute pnpm run build in binject directory.
  let result
  try {
    result = await spawn(pnpmPath, ['run', 'build'], {
      cwd: BINJECT_DIR,
      stdio: 'inherit',
      shell: WIN32,
    })
  } catch (spawnError) {
    result = spawnError
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    printError(
      'binject Build Failed',
      `Failed to build binject (exit code: ${exitCode})`,
      [
        'Check that build dependencies are installed',
        'Check build logs above for compilation errors',
        'binject is required for binary injection in tests',
      ],
    )
    throw new Error(`Failed to build binject (exit code: ${exitCode})`)
  }

  // Verify binject was built.
  const binjectBuilt = existsSync(binjectBinaryPath)
  if (!binjectBuilt) {
    printError(
      'binject Binary Not Created',
      'Build completed but binject binary was not created',
      [`Missing: ${binjectBinaryPath}`],
    )
    throw new Error('binject binary was not created after build')
  }

  logger.logNewline()
  logger.success('binject built successfully')
  logger.logNewline()
}

/**
 * Build compressed binary phase.
 *
 * @param {object} config - Build configuration
 * @param {string} config.buildDir - Build directory
 * @param {string} config.packageName - Package name
 * @param {string} config.outputStrippedBinary - Stripped binary path
 * @param {string} config.outputCompressedDir - Compressed directory
 * @param {string} config.outputCompressedBinary - Compressed binary path
 * @param {string} config.platform - Target platform (darwin, linux, win32)
 * @param {string} [config.libc] - Target libc (musl, glibc) - Linux only
 * @param {string} config.arch - Target architecture (arm64, x64)
 * @param {boolean} config.isCrossCompiling - Whether cross-compiling
 * @param {string[]} config.buildSourcePaths - Source paths for cache key
 * @param {object} [buildOptions] - Optional build options
 * @param {boolean} [buildOptions.skipCheckpoint] - Skip checkpoint creation
 */
export async function buildCompressed(config, buildOptions = {}) {
  const { skipCheckpoint = false } = buildOptions
  const {
    arch,
    buildDir,
    buildSourcePaths,
    isCrossCompiling,
    libc,
    outputCompressedBinary,
    outputCompressedDir,
    outputStrippedBinary,
    packageName,
    platform,
  } = config

  // Validate required config properties
  const requiredProps = [
    'arch',
    'buildDir',
    'outputCompressedBinary',
    'outputCompressedDir',
    'outputStrippedBinary',
    'platform',
  ]
  for (const prop of requiredProps) {
    if (config[prop] === undefined) {
      throw new Error(
        `buildCompressed: missing required config property '${prop}'`,
      )
    }
  }

  const IS_MACOS = platform === 'darwin'

  // Verify compression tools exist (downloaded by workflow).
  // Only the HOST compressor (binpress) is needed - stub has built-in decompression.
  verifyCompressionTools({
    hostArch: process.arch,
    hostPlatform: process.platform,
    hostLibc: detectHostLibc(),
    silent: true,
    targetArch: arch,
    targetPlatform: platform,
    targetLibc: libc,
  })

  logger.substep('Compression tools available (host)')

  // Build binject tool (needed for tests).
  await ensureBinjectBuilt()

  logger.step('Compressing Binary for Distribution')
  logger.log(
    'Compressing stripped binary using platform-specific compression...',
  )
  logger.logNewline()

  await safeMkdir(outputCompressedDir)

  // Select compression quality based on platform.
  // macOS: LZFSE (faster) or LZMA (better compression).
  // Linux: LZMA (best for ELF).
  // Windows: LZMS (best for PE).
  const compressionQuality = IS_MACOS ? 'lzfse' : 'lzma'

  logger.substep(`Input: ${outputStrippedBinary}`)
  logger.substep(`Output: ${outputCompressedBinary}`)
  logger.substep(`Algorithm: ${compressionQuality.toUpperCase()}`)
  logger.logNewline()

  const sizeBeforeCompress = await getFileSize(outputStrippedBinary)
  logger.log(`Size before compression: ${sizeBeforeCompress}`)
  logger.log('Running compression tool...')
  logger.logNewline()

  // Run platform-specific compression.
  const compressArgs = [
    COMPRESS_BINARY_SCRIPT,
    outputStrippedBinary,
    outputCompressedBinary,
    `--quality=${compressionQuality}`,
    `--target-arch=${arch}`,
  ]
  // Shell required on Windows for the compression script to spawn executables
  await exec(process.execPath, compressArgs, { cwd: PACKAGE_ROOT })

  const sizeAfterCompress = await getFileSize(outputCompressedBinary)
  logger.log(`Size after compression: ${sizeAfterCompress}`)
  logger.logNewline()

  // Sign the compressed stub on macOS (ad-hoc signature)
  // The stub needs to be signed so it can execute properly
  await adHocSign(outputCompressedBinary, async () => {
    logger.step('Signing Compressed Stub')
    logger.log('Ad-hoc signing the self-extracting binary...')
    logger.logNewline()
  })

  // Clean Compressed directory before checkpoint to ensure only compressed binary is archived.
  // This removes any leftover files from previous stages (e.g., stripped binary).
  // Note: No external binflate is bundled - the stub has built-in decompression.
  if (!skipCheckpoint) {
    logger.substep('Cleaning checkpoint directory...')
    const compressedDirFiles = await fs.readdir(outputCompressedDir)
    const compressedBinaryName = path.basename(outputCompressedBinary)
    for (const file of compressedDirFiles) {
      if (file !== compressedBinaryName) {
        const filePath = path.join(outputCompressedDir, file)
        await safeDelete(filePath)
        logger.substep(`Removed: ${file}`)
      }
    }
    logger.logNewline()

    // Create checkpoint for Compressed build with smoke test.
    // This is the final checkpoint - calculate checksum for cache validation.
    const compressedBinaryContent = await fs.readFile(outputCompressedBinary)
    const compressedChecksum = createHash('sha256')
      .update(compressedBinaryContent)
      .digest('hex')

    const compressedBinarySize = await getFileSize(outputCompressedBinary)
    await createCheckpoint(
      buildDir,
      'binary-compressed',
      async () => {
        // Smoke test: Verify compressed binary is executable.
        // Will automatically fall back to static verification if cross-compiled.
        logger.log('Testing compressed binary...')
        const compressedSmokeTest = await smokeTestBinary(
          outputCompressedBinary,
          null,
          {
            expectedArch: isCrossCompiling ? arch : undefined,
            isMusl: libc === 'musl',
          },
        )

        if (!compressedSmokeTest) {
          printError(
            'Compressed Binary Failed',
            'Compressed binary failed smoke test',
            [
              'Compression may have corrupted the binary',
              'Decompressor may have issues',
              'Try rebuilding: pnpm build --clean',
            ],
          )
          throw new Error('Compressed binary failed smoke test')
        }

        logger.success('Compressed binary functional')
        logger.log('')
      },
      {
        packageName,
        binarySize: compressedBinarySize,
        checksum: compressedChecksum,
        binaryPath: path.relative(buildDir, outputCompressedBinary),
        artifactPath: outputCompressedDir,
        // Cache depends on build sources
        sourcePaths: buildSourcePaths,
        packageRoot: PACKAGE_ROOT,
        platform,
        arch,
      },
    )
  }

  logger.substep(`Compressed directory: ${outputCompressedDir}`)
  logger.substep('Binary: node (self-extracting with built-in decompressor)')
  logger.logNewline()
  logger.success('Binary compressed successfully')
  logger.logNewline()

  return { compressed: true }
}
