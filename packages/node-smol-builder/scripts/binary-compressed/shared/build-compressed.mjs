#!/usr/bin/env node
/**
 * @fileoverview Compressed Binary Build Phase
 *
 * This script handles the "Compressed" build phase:
 * 1. Compress stripped binary using platform-specific compression
 * 2. Create self-extracting binary
 * 3. Smoke test compressed binary
 * 4. Create compressed checkpoint
 * 5. Bundle decompression tool
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
import colors from 'yoctocolors-cjs'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  ADDITIONS_COMPRESSION_TOOLS_DIR,
  COMPRESS_BINARY_SCRIPT,
  COMPRESSION_TOOLS_DIR,
  PACKAGE_ROOT,
} from '../../paths.mjs'

const logger = getDefaultLogger()

/**
 * Build compressed binary phase.
 *
 * @param {object} options - Build options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.packageName - Package name
 * @param {string} options.outputStrippedBinary - Stripped binary path
 * @param {string} options.outputCompressedDir - Compressed directory
 * @param {string} options.outputCompressedBinary - Compressed binary path
 * @param {string} options.decompressorName - Decompressor tool name
 * @param {string} options.decompressorInCompressed - Decompressor path in Compressed dir
 * @param {string} options.platform - Target platform (darwin, linux, win32)
 * @param {string} options.arch - Target architecture (arm64, x64)
 * @param {boolean} options.shouldCompress - Whether to compress (default: true)
 * @param {boolean} options.isCrossCompiling - Whether cross-compiling
 * @param {string[]} options.buildSourcePaths - Source paths for cache key
 */
export async function buildCompressed({
  arch,
  buildDir,
  buildSourcePaths,
  decompressorInCompressed,
  decompressorName,
  isCrossCompiling,
  outputCompressedBinary,
  outputCompressedDir,
  outputStrippedBinary,
  packageName,
  platform,
  shouldCompress = true,
}) {
  const IS_MACOS = platform === 'darwin'

  // Check if compression tools exist before attempting compression.
  const compressionToolsExist = existsSync(COMPRESSION_TOOLS_DIR)

  if (shouldCompress && !compressionToolsExist) {
    logger.warn('Binary compression requested but compression tools not found')
    logger.warn(
      `Expected tools directory: ${path.relative(PACKAGE_ROOT, COMPRESSION_TOOLS_DIR)}`,
    )
    logger.skip(
      'Skipping compression (build will continue with uncompressed binary)',
    )
    logger.logNewline()
    return { compressed: false }
  }

  if (!shouldCompress || !compressionToolsExist) {
    logger.log('')
    logger.skip('Binary compression skipped (--no-compress-binary flag)')
    logger.log('   Compression is enabled by default for smol builds')
    logger.log(
      '   Remove --no-compress-binary flag to enable binary compression',
    )
    logger.log('')
    return { compressed: false }
  }

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

  // Read socketbin package spec from actual package.json for socket-lib cache key generation.
  // Format: @socketbin/cli-{platform}-{arch}@{version}
  // This enables deterministic cache keys based on the published package.
  // Note: This path only exists in published npm packages, not in the dev monorepo.
  const socketbinPkgPath = path.join(
    path.dirname(PACKAGE_ROOT),
    `socketbin-cli-${platform}-${arch}`,
    'package.json',
  )
  let socketbinSpec = null
  if (existsSync(socketbinPkgPath)) {
    try {
      const socketbinPkg = JSON.parse(
        await fs.readFile(socketbinPkgPath, 'utf-8'),
      )
      socketbinSpec = `${socketbinPkg.name}@${socketbinPkg.version}`
      logger.substep(`Found socketbin package: ${socketbinSpec}`)
    } catch {
      // Failed to read or parse package.json - use fallback
      logger.substep('Using fallback cache key generation')
    }
  } else {
    // Expected in dev builds - socketbin packages only exist when published
    logger.substep('Using fallback cache key generation (dev mode)')
  }

  logger.substep(`Input: ${outputStrippedBinary}`)
  logger.substep(`Output: ${outputCompressedBinary}`)
  logger.substep(`Algorithm: ${compressionQuality.toUpperCase()}`)
  if (socketbinSpec) {
    logger.substep(`Spec: ${socketbinSpec}`)
  }
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
  ]
  if (socketbinSpec) {
    compressArgs.push(`--spec=${socketbinSpec}`)
  }
  // Shell required on Windows for the compression script to spawn executables
  await exec(process.execPath, compressArgs, { cwd: PACKAGE_ROOT })

  const sizeAfterCompress = await getFileSize(outputCompressedBinary)
  logger.log(`Size after compression: ${sizeAfterCompress}`)
  logger.logNewline()

  // Skip signing compressed binary - it's a self-extracting binary (decompressor + compressed data),
  // not a standard Mach-O executable. The decompressor is already signed if needed.
  // When executed, the decompressor extracts and runs the original Node.js binary.
  logger.skip('Skipping code signing for self-extracting binary...')
  logger.substep(
    '✓ Compressed binary ready (self-extracting, no signature needed)',
  )
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
    packageName,
    'binary-compressed',
    async () => {
      if (isCrossCompiling) {
        // Skip smoke test for cross-compiled binaries
        logger.log(
          'Skipping smoke test (binary cross-compiled for different architecture)',
        )
        logger.log('')
        return
      }
      // Smoke test: Verify compressed binary is executable.
      logger.log('Testing compressed binary...')
      const compressedSmokeTest = await smokeTestBinary(outputCompressedBinary)

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

      logger.log(`${colors.green('✓')} Compressed binary functional`)
      logger.log('')
    },
    {
      binarySize: compressedBinarySize,
      checksum: compressedChecksum,
      binaryPath: path.relative(buildDir, outputCompressedBinary),
      artifactPath: outputCompressedBinary,
      // Cache depends on build sources
      sourcePaths: buildSourcePaths,
      packageRoot: PACKAGE_ROOT,
      platform,
      arch,
    },
  )

  logger.substep(`Compressed directory: ${outputCompressedDir}`)
  logger.substep('Binary: node (compressed)')
  logger.logNewline()
  logger.success('Binary compressed successfully')
  logger.logNewline()

  // Copy decompression tool to Compressed directory for distribution.
  logger.step('Bundling Decompression Tool')
  logger.log('Copying platform-specific decompression tool for distribution...')
  logger.logNewline()

  const decompressToolSource = path.join(
    ADDITIONS_COMPRESSION_TOOLS_DIR,
    decompressorName,
  )
  const decompressToolDest = decompressorInCompressed

  if (existsSync(decompressToolSource)) {
    await fs.cp(decompressToolSource, decompressToolDest, {
      force: true,
      preserveTimestamps: true,
    })

    // Ensure tool is executable.
    await exec('chmod', ['+x', decompressToolDest])

    const toolSize = await getFileSize(decompressToolDest)
    logger.substep(`Tool: ${decompressorName} (${toolSize})`)
    logger.substep(`Location: ${outputCompressedDir}`)
    logger.logNewline()
    logger.success('Decompression tool bundled for distribution')
    logger.logNewline()
  } else {
    logger.skip(`Decompression tool not found: ${decompressorName}`)
    logger.substep(
      'Build compression tools first: cd compression-tools && make all',
    )
    logger.logNewline()
  }

  return { compressed: true }
}
