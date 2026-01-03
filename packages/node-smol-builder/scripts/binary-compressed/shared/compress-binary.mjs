#!/usr/bin/env node
/**
 * Cross-platform binary compression script.
 *
 * Automatically detects the platform and uses the appropriate compression tool:
 * - macOS: socket_macho_compress (Apple Compression framework)
 * - Linux: socket_elf_compress (liblzma)
 * - Windows: socket_pe_compress (Windows Compression API)
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
 * Our approach uses native OS compression APIs:
 * - 75-79% compression ratio (macOS LZMA: 76%, Linux LZMA: 77%, Windows LZMS: 73%)
 * - Works with macOS code signing (preserves both inner and outer signatures)
 * - Zero AV false positives (trusted platform APIs)
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
 *   node scripts/compress-binary.mjs <input> <output> [--quality=lzma|lzfse|xpress]
 *   node scripts/compress-binary.mjs ./node ./node.compressed --quality=lzma
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ALPINE_RELEASE_FILE } from 'build-infra/lib/environment-constants'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
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
    defaultQuality: 'lzfse',
    qualityOptions: ['lz4', 'zlib', 'lzfse', 'lzma'],
  },
  linux: {
    binaryFormat: 'ELF',
    defaultQuality: 'lzma',
    qualityOptions: ['lzma'],
  },
  win32: {
    binaryFormat: 'PE',
    defaultQuality: 'lzms',
    qualityOptions: ['xpress', 'xpress_huff', 'lzms'],
  },
}

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    logger.error(
      'Usage: compress-binary.mjs <input> <output> [--quality=lzma|lzfse|xpress] [--target-arch=x64|arm64]',
    )
    logger.error('')
    logger.error('Examples:')
    logger.error('  node scripts/compress-binary.mjs ./node ./node.compressed')
    logger.error(
      '  node scripts/compress-binary.mjs ./node ./node.compressed --quality=lzma --target-arch=x64',
    )
    process.exit(1)
  }

  const inputPath = path.resolve(args[0])
  const outputPath = path.resolve(args[1])
  let quality = null
  // Default to host architecture
  let targetArch = process.arch

  for (const arg of args.slice(2)) {
    if (arg.startsWith('--quality=')) {
      quality = arg.substring('--quality='.length)
    } else if (arg.startsWith('--target-arch=')) {
      targetArch = arg.substring('--target-arch='.length)
    }
  }

  return { inputPath, outputPath, quality, targetArch }
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

/**
 * Get platform-arch string for downloaded binpress tool path.
 */
/**
 * Detect if running on musl libc (Alpine Linux).
 */
function isMusl() {
  if (process.platform !== 'linux') {
    return false
  }

  // Check for Alpine release file.
  if (existsSync(ALPINE_RELEASE_FILE)) {
    return true
  }

  // Check ldd version for musl.
  try {
    const { execSync } = require('node:child_process')
    const lddVersion = execSync('ldd --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return lddVersion.includes('musl')
  } catch {
    return false
  }
}

function getBinpressPlatformArch() {
  // Use shared platform mapping for binpress tool path.
  // Linux uses musl variant for broader compatibility.
  const libc = isMusl() ? 'musl' : null
  return getPlatformArch(process.platform, process.arch, libc)
}

/**
 * Get path to downloaded binpress tool.
 * binpress is downloaded by download-binsuite-tools.mjs to:
 * packages/node-smol-builder/build/binpress/{platform}-{arch}/binpress[.exe]
 */
function getDownloadedBinpressPath() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const packageRoot = path.join(__dirname, '../../..')
  const platformArch = getBinpressPlatformArch()
  const ext = process.platform === 'win32' ? '.exe' : ''
  const binpressPath = path.join(
    packageRoot,
    'build',
    'binpress',
    platformArch,
    `binpress${ext}`,
  )

  if (!existsSync(binpressPath)) {
    throw new Error(
      `binpress not found at ${binpressPath}.\n` +
        'Download prebuilt binpress:\n' +
        '  node packages/node-smol-builder/scripts/download-binsuite-tools.mjs --tool=binpress\n' +
        'Or download all binsuite tools:\n' +
        '  node packages/node-smol-builder/scripts/download-binsuite-tools.mjs',
    )
  }

  return binpressPath
}

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
 * Compress binary using platform-specific tool.
 */
async function compressBinary(
  _toolPath,
  inputPath,
  outputPath,
  quality,
  config,
  _targetArch,
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

  logger.log(`Compressing ${config.binaryFormat} binary...`)
  logger.log(`  Input: ${inputPath} (${inputSizeMB.toFixed(2)} MB)`)
  logger.log(`  Output: ${outputPath}`)
  logger.log(`  Quality: ${quality || config.defaultQuality}`)
  logger.log('')

  // binpress handles full flow (compression + embedding) for all platforms.
  // Get stub path first (needed for binpress).
  const stubName = WIN32 ? 'smol_stub.exe' : 'smol_stub'
  const STUB_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'stub',
  )
  const stubOutDir = path.join(STUB_DIR, 'out')
  let stubPath = path.join(stubOutDir, stubName)
  const stubPathExe = `${stubPath}.exe`

  // Build stub if it doesn't exist.
  if (!existsSync(stubPath) && !existsSync(stubPathExe)) {
    logger.log('Building stub...')

    // Determine platform-specific Makefile.
    const platform = process.platform
    let makefileName
    let makeTool = 'make'

    if (platform === 'darwin') {
      makefileName = 'Makefile.macos'
    } else if (platform === 'linux') {
      makefileName = 'Makefile.linux'
    } else if (platform === 'win32') {
      makefileName = 'Makefile.windows'
      makeTool = 'mingw32-make'
    } else {
      throw new Error(`Unsupported platform: ${platform}`)
    }

    const makePath = await which(makeTool, { nothrow: true })
    if (!makePath) {
      throw new Error(
        `Build tool '${makeTool}' not found. Required to build self-extracting stub.`,
      )
    }

    const makeResult = await spawn(makePath, ['-f', makefileName, 'all'], {
      cwd: STUB_DIR,
      stdio: 'inherit',
      shell: WIN32,
    })

    if (makeResult.code !== 0) {
      throw new Error(
        `Failed to build self-extracting stub (exit code: ${makeResult.code})`,
      )
    }

    logger.log('')
  }

  // Check for stub (with or without .exe extension on Windows).
  if (existsSync(stubPathExe)) {
    stubPath = stubPathExe
  } else if (!existsSync(stubPath)) {
    throw new Error(
      `Self-extracting stub not found: ${stubPath}${WIN32 ? ` or ${stubPathExe}` : ''}`,
    )
  }

  // Use the downloaded binpress path (already validated in main()).
  const binpressPath = _toolPath

  logger.log('Using binpress to update stub with compressed data...')

  // binpress handles compression + embedding in one call for all platforms.
  // Interface: binpress <input> -u <stub> -o <output>
  let result
  try {
    result = await spawn(
      binpressPath,
      [inputPath, '-u', stubPath, '-o', outputPath],
      { stdio: 'inherit' },
    )
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
    const { inputPath, outputPath, quality, targetArch } = parseArgs()
    const config = getPlatformConfig()

    logger.log('Socket Binary Compression')
    logger.log('=========================')
    logger.log(`Platform: ${config.binaryFormat} (${process.platform})`)
    logger.log('')

    // Get downloaded binpress tool path.
    const toolPath = getDownloadedBinpressPath()

    // Compress binary.
    await compressBinary(
      toolPath,
      inputPath,
      outputPath,
      quality,
      config,
      targetArch,
    )
  } catch (e) {
    logger.error(`Error: ${e.message}`)
    process.exit(1)
  }
}

main()
