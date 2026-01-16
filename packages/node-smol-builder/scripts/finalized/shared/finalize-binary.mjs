/**
 * Binary finalization phase for Node.js
 *
 * Copies final artifacts to Final directory for distribution.
 * Either compressed binary + decompressor, or stripped binary.
 */

import { existsSync, promises as fs } from 'node:fs'
import { platform } from 'node:os'
import path from 'node:path'

import { getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

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
 * @param {string} options.outputFinalDir - Final directory (destination)
 * @param {string} options.outputFinalBinary - Final binary path
 * @param {string} options.decompressorInCompressed - Decompressor in Compressed directory
 * @param {string} options.decompressorInFinal - Decompressor in Final directory
 * @param {boolean} options.compressed - Whether compression is enabled
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function finalizeBinary(options) {
  const {
    buildDir,
    compressed,
    decompressorInCompressed,
    decompressorInFinal,
    forceRebuild,
    outputCompressedBinary,
    outputFinalBinary,
    outputFinalDir,
    outputStrippedBinary,
  } = options

  if (!(await shouldRun(buildDir, '', 'finalized', forceRebuild))) {
    return
  }

  logger.step('Copying to Build Output (Final)')
  await safeMkdir(outputFinalDir)

  // Determine if we should use compressed binary for final distribution (default: yes for smol builds)
  const shouldUseCompression = compressed && existsSync(outputCompressedBinary)
  const finalBinary = outputFinalBinary

  if (shouldUseCompression) {
    logger.log('Copying compressed distribution package to Final directory...')
    logger.logNewline()

    // Copy compressed binary to Final
    await fs.cp(outputCompressedBinary, finalBinary, {
      force: true,
      preserveTimestamps: true,
    })

    // Copy decompressor tool to Final
    const decompressToolSource = decompressorInCompressed
    const decompressToolDest = decompressorInFinal

    if (existsSync(decompressToolSource)) {
      await fs.cp(decompressToolSource, decompressToolDest, {
        force: true,
        preserveTimestamps: true,
      })
      await fs.chmod(decompressToolDest, 0o755)
    }

    const compressedSize = await getFileSize(finalBinary)
    const decompressToolSize = existsSync(decompressToolDest)
      ? await getFileSize(decompressToolDest)
      : 'N/A'

    logger.substep(`Source: ${outputCompressedBinary}`)
    logger.substep(`Binary: ${compressedSize}`)
    logger.substep(`Decompressor: ${decompressToolSize}`)
    logger.substep(`Location: ${outputFinalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with compressed package')
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
    logger.substep(`Location: ${outputFinalDir}`)
    logger.logNewline()
    logger.success('Final distribution created with uncompressed binary')
    logger.logNewline()
  }

  // Create checkpoint with smoke test
  const finalBinarySize = await getFileSize(finalBinary)
  await createCheckpoint(
    buildDir,
    'finalized',
    async () => {
      // Smoke test: Verify final binary exists and is executable
      if (!existsSync(finalBinary)) {
        throw new Error('Final binary not found')
      }
      const stats = await fs.stat(finalBinary)
      if (stats.size === 0) {
        throw new Error('Final binary is empty')
      }
      // Check executable bit on Unix
      if (platform() !== 'win32' && !(stats.mode & 0o111)) {
        throw new Error('Final binary is not executable')
      }
      logger.substep(`Final binary validated: ${finalBinarySize}`)
    },
    {
      binarySize: finalBinarySize,
      binaryPath: path.relative(buildDir, finalBinary),
      artifactPath: outputFinalDir,
    },
  )

  logger.success('Binary finalized for distribution')
  logger.logNewline()
}
