/**
 * Binary finalization phase for Node.js
 *
 * Copies final artifacts to Final directory for distribution.
 * The compressed binary is self-extracting (has built-in decompression).
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'

import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

/**
 * Copy final artifacts to Final directory for distribution.
 *
 * @param {object} options - Finalization options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.outputStrippedBinary - Stripped binary path (source if uncompressed)
 * @param {string} options.outputCompressedBinary - Compressed binary path (source if compressed)
 * @param {string} options.outputFinalBinary - Final binary path (directory created from dirname)
 * @param {boolean} options.compressed - Whether compression is enabled
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 * @param {string} options.platform - Target platform (darwin, linux, win32)
 * @param {string} options.arch - Target architecture (x64, arm64)
 * @param {string} [options.libc] - C library (glibc, musl) for Linux
 */
export async function finalizeBinary(options) {
  const {
    arch,
    buildDir,
    compressed,
    forceRebuild,
    libc,
    outputCompressedBinary,
    outputFinalBinary,
    outputStrippedBinary,
    platform,
  } = options

  if (!(await shouldRun(buildDir, '', CHECKPOINTS.FINALIZED, forceRebuild))) {
    return
  }

  logger.step('Copying to Build Output (Final)')
  // Create the directory that will contain the binary.
  const outputBinaryDir = path.dirname(outputFinalBinary)
  await safeMkdir(outputBinaryDir)

  // Determine if we should use compressed binary for final distribution (default: yes for smol builds).
  const shouldUseCompression = compressed && existsSync(outputCompressedBinary)
  const finalBinary = outputFinalBinary

  if (shouldUseCompression) {
    logger.log('Copying self-extracting binary to Final directory...')
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
    logger.log('Copying stripped binary to Final directory...')
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
      binarySize: finalBinarySize,
      binaryPath: path.relative(buildDir, finalBinary),
      artifactPath: outputBinaryDir,
      platform,
      arch,
      libc,
    },
  )

  logger.success('Binary finalized for distribution')
  logger.logNewline()
}
