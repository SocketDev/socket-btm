#!/usr/bin/env node
/**
 * @fileoverview Stripped Binary Build Phase
 *
 * This script handles the "Stripped" build phase:
 * 1. Copy Release binary to Stripped directory
 * 2. Strip debug symbols (platform-specific)
 * 3. Re-sign binary if needed (macOS ARM64)
 * 4. Smoke test stripped binary
 * 5. Create stripped checkpoint
 *
 * This phase depends on the Release phase checkpoint.
 */

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

import { whichSync } from '@socketsecurity/lib/bin'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { PACKAGE_ROOT } from '../../paths.mjs'

const logger = getDefaultLogger()

/**
 * Check if a command exists in PATH.
 */
function commandExists(cmd) {
  return !!whichSync(cmd, { nothrow: true })
}

/**
 * Build stripped binary phase.
 *
 * @param {object} options - Build options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.packageName - Package name
 * @param {string} options.outputReleaseDir - Release directory
 * @param {string} options.outputReleaseBinary - Release binary path
 * @param {string} options.outputStrippedDir - Stripped directory
 * @param {string} options.outputStrippedBinary - Stripped binary path
 * @param {string} options.outDir - Source out directory (to clean)
 * @param {string} options.platform - Target platform (darwin, linux, win32)
 * @param {string} options.arch - Target architecture (arm64, x64)
 * @param {string} options.binaryName - Binary name (node or node.exe)
 * @param {boolean} options.isCrossCompiling - Whether cross-compiling
 * @param {string[]} options.buildSourcePaths - Source paths for cache key
 */
export async function buildStripped({
  arch,
  binaryName,
  buildDir,
  buildSourcePaths,
  isCrossCompiling,
  outDir,
  outputReleaseBinary,
  outputStrippedBinary,
  outputStrippedDir,
  packageName,
  platform,
}) {
  const IS_MACOS = platform === 'darwin'
  const IS_WINDOWS = platform === 'win32'

  // Clean up source/out/ to free disk space (~4-6GB)
  // The final binary has been copied to out/Release/, so source/out/ is no longer needed
  logger.step('Cleaning Build Artifacts')
  logger.log(
    'Removing source/out/ directory to free disk space (~4-6GB of intermediate build files)...',
  )
  if (existsSync(outDir)) {
    await safeDelete(outDir)
    logger.success('Build artifacts cleaned (source/out/ removed)')
  } else {
    logger.substep('No build artifacts to clean')
  }
  logger.log('')

  // Copy unstripped binary to build/out/Stripped before stripping.
  // This preserves the original unstripped binary in build/out/Release.
  // Note: Copy from outputReleaseBinary (not nodeBinary) since source/out/ was cleaned up above
  logger.step('Copying to Build Output (Stripped)')
  logger.log('Copying unstripped binary to build/out/Stripped directory...')
  logger.log('(will strip the copy to preserve original)')
  logger.logNewline()

  await safeMkdir(outputStrippedDir)
  await fs.cp(outputReleaseBinary, outputStrippedBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Stripped directory: ${outputStrippedDir}`)
  logger.substep(`Binary: ${binaryName} (unstripped copy)`)
  logger.logNewline()
  logger.success('Binary copied to build/out/Stripped (ready for stripping)')
  logger.logNewline()

  // Strip debug symbols to reduce size.
  // IMPORTANT: Strip the COPY in Stripped directory, not the original.
  logger.step('Optimizing Binary Size')
  const sizeBeforeStrip = await getFileSize(outputStrippedBinary)
  logger.log(`Size before stripping: ${sizeBeforeStrip}`)
  logger.log('Removing debug symbols and unnecessary sections...')
  logger.log('')

  // Platform-specific stripping with enhanced optimization:
  // - macOS: Multi-phase (strip → llvm-strip if available)
  // - Linux: Aggressive (strip --strip-all → objcopy section removal → sstrip if available)
  // - Windows: Skip stripping (no strip command)
  if (IS_WINDOWS) {
    logger.skip('Windows detected - skipping strip (not supported)')
    logger.log('')
  } else if (IS_MACOS) {
    // macOS: Multi-phase stripping for maximum size reduction.
    logger.log('Phase 1: Basic stripping')
    await exec('strip', [outputStrippedBinary])

    // Phase 2: Try llvm-strip for more aggressive optimization.
    if (commandExists('llvm-strip')) {
      logger.log('Phase 2: Aggressive LLVM stripping')
      await exec('llvm-strip', [outputStrippedBinary])
    } else {
      logger.skip('Phase 2: Skipped (llvm-strip not available)')
    }
  } else {
    // Linux/Alpine: Aggressive multi-phase stripping.
    logger.log('Phase 1: Aggressive stripping')
    await exec('strip', ['--strip-all', outputStrippedBinary])

    // Phase 2: Remove unnecessary ELF sections if objcopy is available.
    if (commandExists('objcopy')) {
      logger.log('Phase 2: Removing unnecessary ELF sections')
      const sections = [
        '.note.ABI-tag',
        '.note.gnu.build-id',
        '.comment',
        '.gnu.version',
      ]
      for (const section of sections) {
        try {
          await exec('objcopy', [
            `--remove-section=${section}`,
            outputStrippedBinary,
          ])
        } catch {
          // Section might not exist, continue.
          logger.skip(`Skipped ${section} (not present)`)
        }
      }
    } else {
      logger.skip('Phase 2: Skipped (objcopy not available)')
    }

    // Phase 3: Super strip if available (removes section headers).
    if (commandExists('sstrip')) {
      logger.log('Phase 3: Super strip (removing section headers)')
      await exec('sstrip', [outputStrippedBinary])
    } else {
      logger.skip('Phase 3: Skipped (sstrip not available)')
    }
  }

  const sizeAfterStrip = await getFileSize(outputStrippedBinary)
  logger.log(`Size after stripping: ${sizeAfterStrip}`)

  // Parse and check size.
  const sizeMatch = sizeAfterStrip.match(/^(\d+)([KMG])/)
  if (sizeMatch) {
    const size = Number.parseInt(sizeMatch[1], 10)
    const unit = sizeMatch[2]

    if (unit === 'M' && size >= 20 && size <= 30) {
      logger.log(
        `${colors.green('✓')} Binary size is optimal (20-30MB with V8 Lite Mode)`,
      )
    } else if (unit === 'M' && size < 20) {
      logger.warn(
        `Binary smaller than expected: ${sizeAfterStrip} (expected ~23-27MB)`,
      )
      logger.substep('Some features may be missing')
      logger.substep('Verify configure flags were applied correctly')
    } else if (unit === 'M' && size > 35) {
      logger.warn(
        `Binary larger than expected: ${sizeAfterStrip} (expected ~23-27MB)`,
      )
      logger.substep('Debug symbols may not be fully stripped')
      logger.substep('Configure flags may not be applied')
      logger.substep('Binary will still work but will be larger')
    }
  }

  logger.log('')

  // Re-sign after stripping for macOS ARM64 (strip invalidates code signature).
  if (IS_MACOS && arch === 'arm64') {
    logger.step('Code Signing (macOS ARM64 - After Stripping)')
    logger.log(
      'Re-signing binary after stripping for macOS ARM64 compatibility...',
    )
    logger.log(
      '(strip command invalidates code signature, re-signing required)',
    )
    logger.logNewline()
    await exec('codesign', ['--sign', '-', '--force', outputStrippedBinary])
    logger.success('Binary re-signed successfully after stripping')
    logger.logNewline()

    // Smoke test after signing to ensure signature is valid.
    if (isCrossCompiling) {
      logger.log(
        'Skipping smoke test (binary cross-compiled for different architecture)',
      )
      logger.log('')
    } else {
      logger.log('Testing binary after signing...')
      const signTestPassed = await smokeTestBinary(outputStrippedBinary)

      if (!signTestPassed) {
        printError(
          'Binary Corrupted After Signing',
          'Binary failed smoke test after code signing',
          [
            'Code signing may have corrupted the binary',
            'Try rebuilding: pnpm build --clean',
            'Report this issue if it persists',
          ],
        )
        throw new Error('Binary corrupted after signing')
      }

      logger.log(`${colors.green('✓')} Binary functional after signing`)
      logger.log('')
    }
  }

  // Smoke test binary after stripping (ensure strip didn't corrupt it).
  if (isCrossCompiling) {
    logger.log(
      'Skipping smoke test (binary cross-compiled for different architecture)',
    )
  } else {
    logger.log('Testing binary after stripping...')
    const smokeTestPassed = await smokeTestBinary(outputStrippedBinary)

    if (!smokeTestPassed) {
      printError(
        'Binary Corrupted After Stripping',
        'Binary failed smoke test after stripping',
        [
          'Strip command may have corrupted the binary',
          'Try rebuilding: pnpm build --clean',
          'Report this issue if it persists',
        ],
      )
      throw new Error('Binary corrupted after stripping')
    }

    logger.log(`${colors.green('✓')} Binary functional after stripping`)
  }
  logger.log('')

  // Create checkpoint with smoke test.
  const strippedBinarySize = await getFileSize(outputStrippedBinary)
  await createCheckpoint(
    buildDir,
    packageName,
    'binary-stripped',
    async () => {
      if (isCrossCompiling) {
        // Skip smoke test for cross-compiled binaries
        logger.substep(
          'Skipping smoke test (binary cross-compiled for different architecture)',
        )
        return
      }
      // Smoke test: Verify stripped binary is executable and runs.
      const versionResult = await spawn(outputStrippedBinary, ['--version'], {
        timeout: 5000,
      })
      if (versionResult.code !== 0) {
        throw new Error('Stripped binary failed to execute --version')
      }
      logger.substep('Stripped binary executable validated')
    },
    {
      binarySize: strippedBinarySize,
      binaryPath: path.relative(buildDir, outputStrippedBinary),
      artifactPath: outputStrippedBinary,
      // Cache depends on same sources as release
      sourcePaths: buildSourcePaths,
      packageRoot: PACKAGE_ROOT,
      platform,
      arch,
    },
  )
  logger.log('')
}
