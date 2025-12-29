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
import { restoreCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { getBinOutDir } from 'build-infra/lib/constants'
import { adHocSign } from 'build-infra/lib/sign'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  BINFLATE_DIR,
  BINJECT_DIR,
  BINPRESS_DIR,
  COMPRESS_BINARY_SCRIPT,
  PACKAGE_ROOT,
} from './paths.mjs'

const logger = getDefaultLogger()

// Tool output directory within external packages
// These packages build to build/${BUILD_MODE}/out/ (controlled by BUILD_MODE env var)
const BINPRESS_OUT_DIR = getBinOutDir(BINPRESS_DIR)
const BINFLATE_OUT_DIR = getBinOutDir(BINFLATE_DIR)
const BINJECT_OUT_DIR = getBinOutDir(BINJECT_DIR)

/**
 * Platform configuration for compression tools.
 * Note: Tool names are simplified (no platform prefix) after Makefile refactor.
 * Compress tools are in binpress/out/, decompress tools are in binflate/out/.
 */
const PLATFORM_CONFIG = {
  __proto__: null,
  darwin: {
    toolName: 'binpress',
    decompressorName: 'binflate',
    binaryFormat: 'Mach-O',
    buildCommand: 'make -f Makefile.macos',
  },
  linux: {
    toolName: 'binpress',
    decompressorName: 'binflate',
    binaryFormat: 'ELF',
    buildCommand: 'make -f Makefile.linux',
  },
  'linux-musl': {
    toolName: 'binpress',
    decompressorName: 'binflate',
    binaryFormat: 'ELF',
    buildCommand: 'make -f Makefile.linux',
  },
  win32: {
    toolName: 'binpress.exe',
    decompressorName: 'binflate.exe',
    binaryFormat: 'PE',
    buildCommand: 'mingw32-make -f Makefile.windows',
  },
}

/**
 * Build compression tools if they don't exist.
 *
 * @param {string} platform - Target platform (darwin, linux, win32)
 */
async function ensureCompressionToolsBuilt(platform) {
  const config = PLATFORM_CONFIG[platform]
  if (!config) {
    throw new Error(
      `Unsupported platform: ${platform}. Supported: macOS, Linux, Windows`,
    )
  }

  // Check if both compress and decompress tools exist in out/ directories
  const compressorPath = path.join(BINPRESS_OUT_DIR, config.toolName)
  const decompressorPath = path.join(BINFLATE_OUT_DIR, config.decompressorName)

  const compressorExists = existsSync(compressorPath)
  const decompressorExists = existsSync(decompressorPath)

  if (compressorExists && decompressorExists) {
    logger.substep(
      `Compression tools already built: ${config.toolName}, ${config.decompressorName}`,
    )
    return
  }

  logger.step(`Building ${config.binaryFormat} Compression Tools`)
  logger.log(
    `Building platform-specific compression tools for ${config.binaryFormat} binaries...`,
  )
  logger.logNewline()

  // Parse the build command
  const commandParts = config.buildCommand.split(/\s+/)
  const binName = commandParts[0]
  const args = commandParts.slice(1)

  // Add 'all' target to build both compress and decompress tools
  args.push('all')

  // Resolve binary path
  const binPath = await which(binName, { nothrow: true })
  if (!binPath) {
    printError(
      'Build Tool Not Found',
      `Build tool '${binName}' not found in PATH`,
      [
        binName === 'make'
          ? 'Install Xcode Command Line Tools on macOS: xcode-select --install'
          : `Install ${binName}`,
        'Compression tools are required for binary compression',
        'Or skip compression: pnpm build --no-compress-binary',
      ],
    )
    throw new Error(
      `Build tool '${binName}' not found. Install it first or use --no-compress-binary`,
    )
  }

  logger.substep(`Using ${binName}: ${binPath}`)
  logger.substep(`Command: ${binName} ${args.join(' ')}`)
  logger.logNewline()

  // Build binpress (compressor)
  logger.substep(
    `Building compressor in ${path.relative(PACKAGE_ROOT, BINPRESS_DIR)}`,
  )
  let result
  try {
    result = await spawn(binPath, args, {
      cwd: BINPRESS_DIR,
      stdio: 'inherit',
      shell: WIN32,
    })
  } catch (spawnError) {
    result = spawnError
  }

  let exitCode = result.code ?? 0
  if (exitCode !== 0) {
    printError(
      'Compressor Build Failed',
      `Failed to build binpress (exit code: ${exitCode})`,
      [
        'Check that gcc/clang and make are installed',
        'Check build logs above for compilation errors',
        'Or skip compression: pnpm build --no-compress-binary',
      ],
    )
    throw new Error(`Failed to build binpress (exit code: ${exitCode})`)
  }

  // Build binflate (decompressor)
  logger.substep(
    `Building decompressor in ${path.relative(PACKAGE_ROOT, BINFLATE_DIR)}`,
  )
  try {
    result = await spawn(binPath, args, {
      cwd: BINFLATE_DIR,
      stdio: 'inherit',
      shell: WIN32,
    })
  } catch (spawnError) {
    result = spawnError
  }

  exitCode = result.code ?? 0
  if (exitCode !== 0) {
    printError(
      'Decompressor Build Failed',
      `Failed to build binflate (exit code: ${exitCode})`,
      [
        'Check that gcc/clang and make are installed',
        'Check build logs above for compilation errors',
        'Or skip compression: pnpm build --no-compress-binary',
      ],
    )
    throw new Error(`Failed to build binflate (exit code: ${exitCode})`)
  }

  // Verify tools were built
  const compressorBuilt = existsSync(compressorPath)
  const decompressorBuilt = existsSync(decompressorPath)

  if (!compressorBuilt || !decompressorBuilt) {
    printError(
      'Compression Tools Not Created',
      'Build completed but tools were not created',
      [
        !compressorBuilt && `Missing compressor: ${compressorPath}`,
        !decompressorBuilt && `Missing decompressor: ${decompressorPath}`,
        'Check build logs for errors',
      ].filter(Boolean),
    )
    throw new Error(
      'Compression tools were not created after build. Check build logs.',
    )
  }

  logger.logNewline()
  logger.success(`${config.binaryFormat} compression tools built successfully`)
  logger.substep(`Compressor: ${config.toolName}`)
  logger.substep(`Decompressor: ${config.decompressorName}`)
  logger.logNewline()
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
 * @param {string} config.decompressorName - Decompressor tool name
 * @param {string} config.decompressorInCompressed - Decompressor path in Compressed dir
 * @param {string} config.platform - Target platform (darwin, linux, linux-musl, win32)
 * @param {string} config.arch - Target architecture (arm64, x64)
 * @param {boolean} config.shouldCompress - Whether to compress (default: true)
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
    decompressorInCompressed,
    decompressorName,
    isCrossCompiling,
    outputCompressedBinary,
    outputCompressedDir,
    outputStrippedBinary,
    packageName,
    platform,
    shouldCompress = true,
  } = config

  // Validate required config properties
  const requiredProps = [
    'arch',
    'buildDir',
    'decompressorInCompressed',
    'decompressorName',
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

  // Build compression tools if needed (before checking if they exist)
  if (shouldCompress) {
    await ensureCompressionToolsBuilt(platform)
  }

  // Build binject tool (needed for tests)
  await ensureBinjectBuilt()

  // Check if compression tools exist before attempting compression.
  const compressionToolsExist = existsSync(BINPRESS_DIR)

  if (shouldCompress && !compressionToolsExist) {
    printError(
      'Compression Tools Not Found',
      'Binary compression requested but compression tools are missing',
      [
        `Expected tools directory: ${path.relative(PACKAGE_ROOT, BINPRESS_DIR)}`,
        'Build compression tools first: pnpm --filter @socketsecurity/binpress run build',
        'Or skip compression: pnpm build --no-compress-binary',
      ],
    )
    throw new Error(
      'Compression tools not found. Build them first or use --no-compress-binary',
    )
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

  // Copy decompression tool to Compressed directory BEFORE checkpoint creation
  // This ensures the decompressor is included in the checkpoint archive
  logger.step('Bundling Decompression Tool')
  logger.log('Copying platform-specific decompression tool for distribution...')
  logger.logNewline()

  const decompressToolSource = path.join(BINFLATE_OUT_DIR, decompressorName)
  const decompressToolDest = decompressorInCompressed

  if (!existsSync(decompressToolSource)) {
    printError(
      'Decompression Tool Not Found',
      `Decompressor tool is missing: ${decompressorName}`,
      [
        `Expected at: ${path.relative(PACKAGE_ROOT, decompressToolSource)}`,
        'Build decompression tools: pnpm --filter @socketsecurity/binflate run build',
        'The decompressor must be bundled with the compressed binary',
      ],
    )
    throw new Error(
      `Decompression tool not found: ${decompressorName}. Build decompression tools first.`,
    )
  }

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

  // Clean Compressed directory before checkpoint to ensure only compressed binary and decompressor are archived
  // This removes any leftover files from previous stages (e.g., stripped binary)
  if (!skipCheckpoint) {
    logger.substep('Cleaning checkpoint directory...')
    const compressedDirFiles = await fs.readdir(outputCompressedDir)
    const compressedBinaryName = path.basename(outputCompressedBinary)
    const decompressorBinaryName = path.basename(decompressorInCompressed)
    for (const file of compressedDirFiles) {
      if (file !== compressedBinaryName && file !== decompressorBinaryName) {
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
        const isMusl = platform === 'linux-musl'
        const compressedSmokeTest = await smokeTestBinary(
          outputCompressedBinary,
          null,
          {
            expectedArch: isCrossCompiling ? arch : undefined,
            isMusl,
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
  logger.substep('Binary: node (compressed)')
  logger.substep(`Decompressor: ${decompressorName}`)
  logger.logNewline()
  logger.success('Binary compressed successfully')
  logger.logNewline()

  return { compressed: true }
}
