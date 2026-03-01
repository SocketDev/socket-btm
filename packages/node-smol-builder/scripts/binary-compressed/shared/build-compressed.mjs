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
import { promises as fs } from 'node:fs'
import path from 'node:path'

import {
  createCheckpoint,
  exec,
  getFileSize,
  smokeTestBinary,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { adHocSign } from 'build-infra/lib/sign'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { COMPRESS_BINARY_SCRIPT, PACKAGE_ROOT } from './paths.mjs'
import { ensureBinpress } from '../../common/shared/compression-tools.mjs'

const logger = getDefaultLogger()

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
    isProdBuild,
    libc,
    outputCompressedBinary,
    outputStrippedBinary,
    packageName,
    platform,
    withLief,
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

  // Ensure binpress binary exists, downloading if needed.
  // Get the binpress path to pass to compress-binary.mjs (DRY - single source of truth).
  // Note: binpress runs on the host system, so we use host defaults (process.platform/arch).
  const binpressPath = await ensureBinpress({
    silent: true,
  })

  logger.substep('binpress ready')

  logger.step('Compressing Binary for Distribution')
  logger.log(
    'Compressing stripped binary using platform-specific compression...',
  )
  logger.logNewline()

  const outputCompressedNodeDir = path.dirname(outputCompressedBinary)
  await safeMkdir(outputCompressedNodeDir, { recursive: true })

  // All platforms use LZFSE compression.
  const compressionQuality = 'lzfse'

  logger.substep(`Input: ${outputStrippedBinary}`)
  logger.substep(`Output: ${outputCompressedBinary}`)
  logger.substep(`Algorithm: ${compressionQuality.toUpperCase()}`)
  logger.logNewline()

  const sizeBeforeCompress = await getFileSize(outputStrippedBinary)
  logger.log(`Size before compression: ${sizeBeforeCompress}`)
  logger.log('Running compression tool...')
  logger.logNewline()

  // Run platform-specific compression.
  // Pass binpress path to avoid duplicate path resolution logic (DRY)
  const compressArgs = [
    COMPRESS_BINARY_SCRIPT,
    outputStrippedBinary,
    outputCompressedBinary,
    `--quality=${compressionQuality}`,
    `--target-arch=${arch}`,
    `--binpress-path=${binpressPath}`,
  ]
  if (libc) {
    compressArgs.push(`--target-libc=${libc}`)
  }
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
    const compressedDirFiles = await fs.readdir(outputCompressedNodeDir)
    const compressedBinaryName = path.basename(outputCompressedBinary)
    for (const file of compressedDirFiles) {
      if (file !== compressedBinaryName) {
        const filePath = path.join(outputCompressedNodeDir, file)
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
      CHECKPOINTS.BINARY_COMPRESSED,
      async () => {
        // Smoke test: Verify compressed binary is executable.
        // Will automatically fall back to static verification if cross-compiled.
        logger.log('Testing compressed binary...')
        const compressedSmokeTest = await smokeTestBinary(
          outputCompressedBinary,
          {
            arch: isCrossCompiling ? arch : undefined,
            libc,
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
        artifactPath: outputCompressedNodeDir,
        // Cache depends on build sources
        sourcePaths: buildSourcePaths,
        packageRoot: PACKAGE_ROOT,
        platform,
        arch,
        libc,
        buildMode: isProdBuild ? 'prod' : 'dev',
        withLief,
      },
    )
  }

  logger.substep(`Compressed directory: ${outputCompressedNodeDir}`)
  logger.substep('Binary: node (self-extracting with built-in decompressor)')
  logger.logNewline()
  logger.success('Binary compressed successfully')
  logger.logNewline()

  return { compressed: true }
}
