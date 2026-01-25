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
import { CHECKPOINTS } from 'build-infra/lib/constants'
import colors from 'yoctocolors-cjs'

import { whichSync } from '@socketsecurity/lib/bin'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { PACKAGE_ROOT } from './paths.mjs'

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
 * @param {object} config - Build configuration
 * @param {string} config.buildDir - Build directory
 * @param {string} config.packageName - Package name
 * @param {string} config.outputReleaseDir - Release directory
 * @param {string} config.outputReleaseBinary - Release binary path
 * @param {string} config.outputStrippedDir - Stripped directory
 * @param {string} config.outputStrippedBinary - Stripped binary path
 * @param {string} config.outDir - Source out directory (to clean)
 * @param {string} config.platform - Target platform (darwin, linux, win32)
 * @param {string} config.arch - Target architecture (arm64, x64)
 * @param {string} config.binaryName - Binary name (node or node.exe)
 * @param {boolean} config.isCrossCompiling - Whether cross-compiling
 * @param {string[]} config.buildSourcePaths - Source paths for cache key
 * @param {object} [buildOptions] - Optional build options
 * @param {boolean} [buildOptions.skipCheckpoint] - Skip checkpoint creation
 */
export async function buildStripped(config, buildOptions = {}) {
  const { skipCheckpoint = false } = buildOptions
  const {
    arch,
    binaryName,
    buildDir,
    buildSourcePaths,
    isCrossCompiling,
    libc,
    outDir,
    outputReleaseBinary,
    outputStrippedBinary,
    packageName,
    platform,
  } = config

  // Validate required config properties
  const requiredProps = [
    'arch',
    'binaryName',
    'buildDir',
    'outputReleaseBinary',
    'outputStrippedBinary',
    'outputStrippedDir',
    'platform',
  ]
  for (const prop of requiredProps) {
    if (config[prop] === undefined) {
      throw new Error(
        `buildStripped: missing required config property '${prop}'`,
      )
    }
  }

  const IS_MACOS = platform === 'darwin'
  const IS_WINDOWS = platform === 'win32'
  const IS_LINUX = platform === 'linux'
  const IS_MUSL = libc === 'musl'

  // Clean up source/out/ to free disk space (~4-6GB)
  // The final binary has been copied to the Release directory, so source/out/ is no longer needed
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

  // Copy unstripped binary to Stripped directory before stripping.
  // This preserves the original unstripped binary in the Release directory.
  // Note: Copy from outputReleaseBinary (not nodeBinary) since source/out/ was cleaned up above
  logger.step('Copying to Build Output (Stripped)')
  logger.log('Copying unstripped binary to Stripped directory...')
  logger.log('(will strip the copy to preserve original)')
  logger.logNewline()

  const outputStrippedNodeDir = path.dirname(outputStrippedBinary)
  await safeMkdir(outputStrippedNodeDir, { recursive: true })
  await fs.cp(outputReleaseBinary, outputStrippedBinary, {
    force: true,
    preserveTimestamps: true,
  })

  logger.substep(`Stripped directory: ${outputStrippedNodeDir}`)
  logger.substep(`Binary: ${binaryName} (unstripped copy)`)
  logger.logNewline()
  logger.success(
    `Binary copied to ${outputStrippedNodeDir} (ready for stripping)`,
  )
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
  // - Linux: Multi-phase (strip --strip-debug → objcopy section removal → sstrip if available)
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
  } else if (IS_LINUX) {
    // Linux/Alpine: Multi-phase stripping.
    //
    // CRITICAL: Use --strip-debug to ONLY remove debug symbols while preserving the symbol table.
    //
    // Why --strip-debug is required:
    // - pthread debugging tools (libthread_db.so.1) require non-global symbols to be present
    // - strip (no flags) is equivalent to --strip-all on GNU binutils, which removes ALL symbols
    // - Removing the symbol table causes pthread_cond_init to fail with SIGABRT
    // - Node.js heavily uses pthread for threading, so symbol table must be preserved
    //
    // Flag comparison:
    // - strip / --strip-all: Removes ALL symbols including symbol table (breaks pthread)
    // - --strip-unneeded: Removes symbols not needed for relocations (still breaks pthread)
    // - --strip-debug: ONLY removes debug symbols, keeps symbol table (safe for pthread)
    //
    // References:
    // - GNU binutils: https://sourceware.org/binutils/docs/binutils/strip.html
    // - Symbol preservation: https://www.technovelty.org/code/split-debugging-info-symbols.html
    logger.log('Phase 1: Basic stripping')
    await exec('strip', ['--strip-debug', outputStrippedBinary])

    // Phase 2: Remove unnecessary ELF sections if objcopy is available.
    // Architecture-specific optimization: Only safe on ARM64.
    // On x64, objcopy --remove-section causes pthread_cond_init SIGABRT failures.
    // Removing sections like .note.ABI-tag, .note.gnu.build-id, .comment, .gnu.version breaks pthread
    // even when --strip-debug preserves the symbol table.
    // Empirically observed: x64 binaries fail pthread initialization when these ELF note sections are removed,
    // while ARM64 binaries tolerate section removal without issues. The exact mechanism is unclear, but likely
    // related to architecture-specific pthread/libc initialization that relies on ABI metadata in these sections.
    if (arch === 'arm64' && commandExists('objcopy')) {
      logger.log('Phase 2: Removing unnecessary ELF sections (ARM64 only)')
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
    } else if (arch === 'arm64') {
      logger.skip('Phase 2: Skipped (objcopy not available)')
    } else {
      logger.skip(
        'Phase 2: Skipped (objcopy section removal only safe on ARM64, causes pthread issues on x64)',
      )
    }

    // Phase 3: Super strip if available (removes section headers).
    if (commandExists('sstrip')) {
      logger.log('Phase 3: Super strip (removing section headers)')
      await exec('sstrip', [outputStrippedBinary])
    } else {
      logger.skip('Phase 3: Skipped (sstrip not available)')
    }
  } else {
    throw new Error(
      `Unsupported platform for binary stripping: ${platform}. Supported platforms: darwin, linux, win32`,
    )
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

  // Smoke test stripped binary (signing happens automatically inside smoke test for macOS).
  // Will automatically fall back to static verification if cross-compiled.
  logger.step('Testing Stripped Binary')
  const smokeTestPassed = await smokeTestBinary(
    outputStrippedBinary,
    isCrossCompiling ? { arch, libc } : { libc },
  )

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

  logger.success('Binary functional after stripping')
  logger.log('')

  // Clean Stripped directory before checkpoint to ensure only the stripped binary is archived
  // This removes any leftover files from previous stages (e.g., release binary)
  if (!skipCheckpoint) {
    logger.substep('Cleaning checkpoint directory...')
    const strippedDirFiles = await fs.readdir(outputStrippedNodeDir)
    const strippedBinaryName = path.basename(outputStrippedBinary)
    for (const file of strippedDirFiles) {
      if (file !== strippedBinaryName) {
        const filePath = path.join(outputStrippedNodeDir, file)
        await safeDelete(filePath)
        logger.substep(`Removed: ${file}`)
      }
    }
    logger.logNewline()

    // Create checkpoint with smoke test.
    const strippedBinarySize = await getFileSize(outputStrippedBinary)
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.BINARY_STRIPPED,
      async () => {
        // Use smokeTestBinary with automatic fallback for cross-compiled builds
        const validated = await smokeTestBinary(outputStrippedBinary, {
          arch: isCrossCompiling ? arch : undefined,
          libc: IS_MUSL ? 'musl' : 'glibc',
        })
        if (!validated) {
          throw new Error('Stripped binary validation failed')
        }
        logger.substep('Stripped binary validated')
      },
      {
        packageName,
        binarySize: strippedBinarySize,
        binaryPath: path.relative(buildDir, outputStrippedBinary),
        artifactPath: outputStrippedNodeDir,
        // Cache depends on same sources as release
        sourcePaths: buildSourcePaths,
        packageRoot: PACKAGE_ROOT,
        platform,
        arch,
      },
    )
    logger.log('')
  }
}
