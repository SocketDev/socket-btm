#!/usr/bin/env node
/**
 * Cross-platform binary compression script.
 *
 * Uses LZFSE compression across all platforms via binpress:
 * - macOS: LZFSE (Apple Compression framework)
 * - Linux: LZFSE (open-source lzfse library)
 * - Windows: LZFSE (open-source lzfse library)
 *
 * Why This Approach Over UPX?
 *
 * UPX (Ultimate Packer for eXecutables) is a popular packer, but has critical issues:
 * - 50-60% compression vs our 75-79% (20-30% worse)
 * - Breaks macOS code signing (Gatekeeper blocks)
 * - 15-30% antivirus false positive rate (blacklisted packer signature)
 * - Uses self-modifying code (triggers heuristic scanners)
 * - Windows Defender often flags UPX-packed binaries
 *
 * Our approach uses LZFSE compression:
 * - ~75% compression ratio across all platforms
 * - Works with macOS code signing (preserves both inner and outer signatures)
 * - Zero AV false positives (trusted compression library)
 * - No self-modifying code (W^X compliant)
 * - External decompressor (~90 KB) instead of packed executable
 * - Decompresses to memory/tmpfs (fast, no disk I/O)
 *
 * Distribution:
 * - Ship compressed binary + decompressor tool
 * - Total overhead: ~90 KB (vs UPX's self-extracting overhead)
 * - Example: 23 MB binary → 10 MB compressed + 90 KB tool = 10.09 MB
 *
 * Usage:
 *   node scripts/compress-binary.mjs <input> <output> [--target-arch=x64|arm64] [--target-libc=glibc|musl]
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { LIBC_VALUES, MAGIC_MARKER } from './constants.mjs'

const logger = getDefaultLogger()

/**
 * Platform configuration.
 */
const PLATFORM_CONFIG = {
  __proto__: null,
  darwin: {
    binaryFormat: 'Mach-O',
  },
  linux: {
    binaryFormat: 'ELF',
  },
  win32: {
    binaryFormat: 'PE',
  },
}

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    logger.error(
      'Usage: compress-binary.mjs <input> <output> [--target-arch=x64|arm64] [--target-libc=glibc|musl] [--binpress-path=<path>]',
    )
    logger.error('')
    logger.error('Examples:')
    logger.error('  node scripts/compress-binary.mjs ./node ./node.compressed')
    logger.error(
      '  node scripts/compress-binary.mjs ./node ./node.compressed --target-arch=x64 --target-libc=musl',
    )
    process.exit(1)
  }

  const inputPath = path.resolve(args[0])
  const outputPath = path.resolve(args[1])
  // Default to host architecture
  let targetArch = process.arch
  let targetLibc
  let binpressPath

  for (const arg of args.slice(2)) {
    if (arg.startsWith('--target-arch=')) {
      targetArch = arg.substring('--target-arch='.length)
    } else if (arg.startsWith('--target-libc=')) {
      targetLibc = arg.substring('--target-libc='.length)
    } else if (arg.startsWith('--binpress-path=')) {
      binpressPath = arg.substring('--binpress-path='.length)
    }
  }

  return { inputPath, outputPath, targetArch, targetLibc, binpressPath }
}

/**
 * Get platform configuration.
 */
function getPlatformConfig() {
  const platform = process.platform
  const config = PLATFORM_CONFIG[platform]

  if (!config) {
    throw new Error(
      `Unsupported platform: ${platform}. Supported: macOS, Linux, Windows`,
    )
  }

  return config
}

/**
 * Detect libc variant (musl vs glibc) for a Linux binary.
 * Uses ldd to check which C library the binary is linked against.
 *
 * @param {string} binaryPath - Path to binary to analyze
 * @returns {Promise<number>} - LIBC_VALUES.musl, LIBC_VALUES.glibc, or LIBC_VALUES.na
 */
async function _detectLibc(binaryPath) {
  try {
    // Run ldd on the binary and check output.
    const result = await spawn('ldd', [binaryPath], {
      encoding: 'utf8',
      timeout: 5000,
    })

    const output = result.stdout + result.stderr

    // Check for musl first (more specific).
    if (output.includes('musl')) {
      return LIBC_VALUES.musl
    }

    // Check for glibc indicators.
    if (output.includes('libc.so') || output.includes('glibc')) {
      return LIBC_VALUES.glibc
    }

    // Default to glibc (most common on Linux).
    logger.warn(
      `Could not determine libc variant for ${binaryPath}, defaulting to glibc`,
    )
    return LIBC_VALUES.glibc
  } catch (e) {
    logger.warn(
      `Failed to detect libc variant for ${binaryPath}: ${e.message}, defaulting to glibc`,
    )
    return LIBC_VALUES.glibc
  }
}

// NOTE: binpress path resolution is now handled by compression-tools.mjs
// and passed via --binpress-path argument. This ensures DRY - single source of truth
// for tool paths, respecting BUILD_TOOLS_FROM_SOURCE and other env vars.

/**
 * Get file size in MB.
 */
async function getFileSizeMB(filePath) {
  const stats = await fs.stat(filePath)
  return stats.size / 1024 / 1024
}

/**
 * Check if a binary is already compressed by looking for the magic marker.
 * @param {string} filePath - Path to binary to check
 * @returns {Promise<boolean>} true if binary is already compressed
 */
async function isCompressedBinary(filePath) {
  try {
    const fileHandle = await fs.open(filePath, 'r')
    const BUFFER_SIZE = 4096
    const buffer = Buffer.alloc(BUFFER_SIZE)
    let totalRead = 0

    try {
      while (true) {
        const { bytesRead } = await fileHandle.read(
          buffer,
          0,
          BUFFER_SIZE,
          totalRead,
        )
        if (bytesRead === 0) {
          break
        }

        // Check if magic marker is in this buffer
        const bufferStr = buffer.toString('binary', 0, bytesRead)
        if (bufferStr.includes(MAGIC_MARKER)) {
          return true
        }

        totalRead += bytesRead
        // Only check first few MB (marker should be near beginning after stub)
        if (totalRead > 5 * 1024 * 1024) {
          break
        }
      }
    } finally {
      await fileHandle.close()
    }

    return false
  } catch {
    // If we can't read the file, assume not compressed
    return false
  }
}

/**
 * Compress binary using binpress (LZFSE compression).
 */
async function compressBinary(
  _toolPath,
  inputPath,
  outputPath,
  config,
  targetArch,
  targetLibc,
) {
  // Validate input file exists.
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  // Check if binary is already compressed
  if (await isCompressedBinary(inputPath)) {
    logger.log('')
    logger.warn('Input binary is already compressed!')
    logger.log('')
    logger.log(`The binary at ${inputPath} appears to be already compressed`)
    logger.log('(detected binpress magic marker).')
    logger.log('')
    logger.log('Skipping compression to avoid double-compression.')
    logger.log(
      'Tip: If you need to re-compress, first extract the binary using:',
    )
    logger.log(`  binflate ${inputPath} -o extracted-binary`)
    logger.log('')
    process.exit(0)
  }

  // Get input file size.
  const inputSizeMB = await getFileSizeMB(inputPath)

  logger.log(`Compressing ${config.binaryFormat} binary with LZFSE...`)
  logger.log(`  Input: ${inputPath} (${inputSizeMB.toFixed(2)} MB)`)
  logger.log(`  Output: ${outputPath}`)
  logger.log('')

  // binpress handles full flow (compression + embedding) for all platforms.
  // Stubs are embedded in binpress during its build process.
  // Use the downloaded binpress path (already validated in main()).
  const binpressPath = _toolPath

  logger.log('Using binpress to compress binary with stub...')

  // binpress handles compression + embedding in one call for all platforms.
  // Interface: binpress <input> -o <output> [--target-platform] [--target-arch] [--target-libc musl/glibc]
  // The stub is embedded during compression automatically
  const binpressArgs = [inputPath, '-o', outputPath]

  // Pass target platform (host platform for native builds)
  binpressArgs.push('--target-platform', process.platform)
  logger.log(`  Target platform: ${process.platform}`)

  // Pass target architecture
  binpressArgs.push('--target-arch', targetArch)
  logger.log(`  Target architecture: ${targetArch}`)

  if (targetLibc) {
    binpressArgs.push('--target-libc', targetLibc)
    logger.log(`  Target libc: ${targetLibc}`)
  }

  let result
  try {
    result = await spawn(binpressPath, binpressArgs, {
      stdio: 'inherit',
    })
  } catch (spawnError) {
    result = spawnError
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    throw new Error(`binpress failed (exit code: ${exitCode})`)
  }

  // Get output size.
  const outputSizeMB = await getFileSizeMB(outputPath)

  logger.log('')
  logger.success('Compression complete!')
  logger.log(`  Original: ${inputSizeMB.toFixed(2)} MB`)
  logger.log(`  Compressed: ${outputSizeMB.toFixed(2)} MB`)
  logger.log(
    `  Reduction: ${(((inputSizeMB - outputSizeMB) / inputSizeMB) * 100).toFixed(1)}%`,
  )
  logger.log(`  Saved: ${(inputSizeMB - outputSizeMB).toFixed(2)} MB`)

  // binpress handled everything - we're done.
  return
}

/**
 * Main function.
 */
async function main() {
  try {
    const { binpressPath, inputPath, outputPath, targetArch, targetLibc } =
      parseArgs()
    const config = getPlatformConfig()

    // Require binpress path to be passed (DRY - resolved by caller via compression-tools.mjs)
    if (!binpressPath) {
      throw new Error(
        'Missing --binpress-path argument.\n' +
          'This script should be called from build-compressed.mjs which resolves the binpress path.',
      )
    }

    if (!existsSync(binpressPath)) {
      throw new Error(`binpress not found at provided path: ${binpressPath}`)
    }

    logger.log('Socket Binary Compression (LZFSE)')
    logger.log('==================================')
    logger.log(`Platform: ${config.binaryFormat} (${process.platform})`)
    logger.log('')

    // Compress binary using the provided binpress path.
    await compressBinary(
      binpressPath,
      inputPath,
      outputPath,
      config,
      targetArch,
      targetLibc,
    )
  } catch (e) {
    logger.error(`Error: ${e.message}`)
    process.exit(1)
  }
}

main()
