/**
 * Binary finalization phase for Node.js.
 *
 * Copies final artifacts to Final directory for distribution.
 * The compressed binary is self-extracting (has built-in decompression).
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { computeBuildInputsFingerprint } from 'build-infra/lib/checkpoint-cache-key'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS, nodeVersionRaw } from 'build-infra/lib/constants'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PACKAGE_ROOT } from '../../paths.mts'

const logger = getDefaultLogger()

/**
 * Copy final artifacts to Final directory for distribution.
 *
 * @param {object} options - Finalization options.
 * @param {string} options.buildDir - Build directory.
 * @param {string} options.outputStrippedBinary - Stripped binary path (source
 *   if uncompressed)
 * @param {string} options.outputCompressedBinary - Compressed binary path
 *   (source if compressed)
 * @param {string} options.outputFinalBinary - Final binary path (directory
 *   created from dirname)
 * @param {boolean} options.compressed - Whether compression is enabled.
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 * @param {string} options.platform - Target platform (darwin, linux, win32)
 * @param {string} options.arch - Target architecture (x64, arm64)
 * @param {string} [options.libc] - C library (glibc, musl) for Linux.
 */
export async function finalizeBinary(options) {
  const {
    arch,
    buildDir,
    compressed,
    forceRebuild,
    libc,
    nodeVersion,
    outputCompressedBinary,
    outputFinalBinary,
    outputStrippedBinary,
    platform,
  } = { __proto__: null, ...options } as typeof options

  // Determine which source binary we'll use for finalization
  const shouldUseCompression = compressed && existsSync(outputCompressedBinary)
  const sourceBinary = shouldUseCompression
    ? outputCompressedBinary
    : outputStrippedBinary

  // shouldRun signature is (buildDir, packageName, checkpointName,
  // force, sourcePaths, options) — packageName omitted here (matches
  // the createCheckpoint() call below which also omits it, so they
  // agree on the checkpoint path <buildDir>/checkpoints/FINALIZED.json).
  // Source-path validation feeds the final binary so checkpoint
  // invalidates when the stripped/compressed input changes; options
  // tags the cache key with platform/arch/libc/nodeVersion so cross-
  // compile builds don't restore a host-tagged binary.
  if (
    !(await shouldRun(
      buildDir,
      undefined,
      CHECKPOINTS.FINALIZED,
      forceRebuild,
      [sourceBinary],
      {
        arch,
        libc,
        nodeVersion,
        platform,
      },
    ))
  ) {
    return
  }

  logger.step('Copying to Build Output (Final)')
  // Create the directory that will contain the binary.
  const outputBinaryDir = path.dirname(outputFinalBinary)
  await safeMkdir(outputBinaryDir)

  const finalBinary = outputFinalBinary

  if (shouldUseCompression) {
    logger.log('Copying self-extracting binary to Final directory…')
    logger.logNewline()

    // Copy compressed binary to Final (self-extracting, no external decompressor needed).
    await fs.cp(outputCompressedBinary, finalBinary, {
      force: true,
      preserveTimestamps: true,
    })

    const compressedSize = await getFileSize(finalBinary)

    logger.substep(`Source: ${outputCompressedBinary}`)
    logger.substep(`Binary: ${compressedSize}`)
    logger.substep(`Location: ${outputBinaryDir}`)
    logger.logNewline()
    logger.success('Final distribution created with self-extracting binary')
    logger.logNewline()
  } else {
    logger.log('Copying stripped binary to Final directory…')
    logger.logNewline()

    await fs.cp(outputStrippedBinary, finalBinary, {
      force: true,
      preserveTimestamps: true,
    })

    const binarySize = await getFileSize(finalBinary)
    logger.substep(`Source: ${outputStrippedBinary}`)
    logger.substep(`Binary: ${binarySize}`)
    logger.substep(`Location: ${outputBinaryDir}`)
    logger.logNewline()
    logger.success('Final distribution created with uncompressed binary')
    logger.logNewline()
  }

  // Create checkpoint with smoke test.
  const finalBinarySize = await getFileSize(finalBinary)
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.FINALIZED,
    async () => {
      // Smoke test: Verify final binary exists and is executable.
      if (!existsSync(finalBinary)) {
        throw new Error('Final binary not found')
      }
      // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size and stats.mode to validate the final binary.
      const stats = await fs.stat(finalBinary)
      if (stats.size === 0) {
        throw new Error('Final binary is empty')
      }
      // Check executable bit on Unix.
      if (os.platform() !== 'win32' && !(stats.mode & 0o111)) {
        throw new Error('Final binary is not executable')
      }
      logger.substep(`Final binary validated: ${finalBinarySize}`)
    },
    {
      arch,
      artifactPath: outputBinaryDir,
      binaryPath: path.relative(buildDir, finalBinary),
      binarySize: finalBinarySize,
      inputsFingerprint: computeBuildInputsFingerprint({
        dirs: [
          path.join(PACKAGE_ROOT, 'additions'),
          path.join(PACKAGE_ROOT, 'patches'),
        ],
        nodeVersion: nodeVersionRaw,
      }),
      libc,
      nodeVersion,
      platform,
    },
  )

  logger.success('Binary finalized for distribution')
  logger.logNewline()
}
