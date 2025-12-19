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

import { getBinOutDir } from 'build-infra/lib/constants'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { BINPRESS_DIR } from './paths.mjs'

const logger = getDefaultLogger()
const TOOLS_DIR = getBinOutDir(BINPRESS_DIR)

/**
 * Platform configuration.
 */
const PLATFORM_CONFIG = {
  __proto__: null,
  darwin: {
    toolName: 'binpress',
    binaryFormat: 'Mach-O',
    defaultQuality: 'lzfse',
    qualityOptions: ['lz4', 'zlib', 'lzfse', 'lzma'],
    buildCommand: 'make -f Makefile',
  },
  linux: {
    toolName: 'binpress',
    binaryFormat: 'ELF',
    defaultQuality: 'lzma',
    qualityOptions: ['lzma'],
    buildCommand: 'make -f Makefile',
  },
  win32: {
    toolName: 'binpress.exe',
    binaryFormat: 'PE',
    defaultQuality: 'lzms',
    qualityOptions: ['xpress', 'xpress_huff', 'lzms'],
    buildCommand: 'mingw32-make -f Makefile',
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
 * Build compression tool if it doesn't exist.
 */
async function ensureToolBuilt(config) {
  const toolPath = path.join(TOOLS_DIR, config.toolName)
  const toolPathExe = `${toolPath}.exe`

  // Check if tool exists (with or without .exe extension).
  if (existsSync(toolPath) || existsSync(toolPathExe)) {
    return existsSync(toolPathExe) ? toolPathExe : toolPath
  }

  logger.log(`Building ${config.binaryFormat} compression tool...`)
  logger.log(`  Command: ${config.buildCommand}`)
  logger.log('')

  // Parse the build command to extract binary name and arguments
  const commandParts = config.buildCommand.split(/\s+/)
  const binName = commandParts[0]
  const args = commandParts.slice(1)

  // Resolve binary path using which()
  const binPath = await which(binName, { nothrow: true })
  if (!binPath) {
    throw new Error(
      `Build tool '${binName}' not found in PATH. ` +
        `Please install it: ${binName === 'make' ? 'Install Xcode Command Line Tools on macOS' : `Install ${binName}`}`,
    )
  }

  logger.substep(`Resolved ${binName} to: ${binPath}`)
  logger.substep(`Checking if path exists: ${existsSync(binPath)}`)
  logger.substep(`Arguments: ${args.join(' ')}`)
  logger.log('')

  // Execute the build command using @socketsecurity/lib spawn.
  // Use shell: WIN32 for cross-platform compatibility (true on Windows, false elsewhere).
  // On Windows, shell mode is needed for proper .cmd/.bat script execution.
  // On Unix, direct binary execution avoids shell spawning issues.
  let result
  try {
    result = await spawn(binPath, args, {
      cwd: TOOLS_DIR,
      stdio: 'inherit',
      shell: WIN32,
    })
  } catch (spawnError) {
    // spawn() throws when command exits with non-zero code
    result = spawnError
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    throw new Error(`Failed to build compression tool (exit code: ${exitCode})`)
  }

  // Verify tool was built.
  if (!existsSync(toolPath) && !existsSync(toolPathExe)) {
    throw new Error(`Tool ${config.toolName} was not created after build`)
  }

  return existsSync(toolPathExe) ? toolPathExe : toolPath
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
    const MAGIC_MARKER = '__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER'
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

    const makePath = await which('make', { nothrow: true })
    if (!makePath) {
      throw new Error(
        "Build tool 'make' not found. Required to build self-extracting stub.",
      )
    }

    const makeResult = await spawn(makePath, ['all'], {
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

  // Find binpress binary.
  const binpressPath = await which('binpress', { nothrow: true })
  if (!binpressPath || Array.isArray(binpressPath)) {
    throw new Error(
      'binpress not found. Please build binpress first:\n' +
        '  pnpm --filter binpress run build',
    )
  }

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

// Old implementation below removed - binpress now handles all platforms uniformly.
/*
  // Old non-binpress flow (replaced by binpress for all platforms):
  // Create temporary compressed data file.
  const compressedDataPath = `${outputPath}.data`

  // Build command arguments.
  const args = [inputPath, compressedDataPath]
  if (quality) {
    args.push(`--quality=${quality}`)
  }

  // Execute compression tool using @socketsecurity/lib spawn.
  // Use shell: WIN32 for cross-platform compatibility (true on Windows, false elsewhere).
  let result
  try {
    result = await spawn(toolPath, args, {
      stdio: 'inherit',
      shell: WIN32,
    })
  } catch (spawnError) {
    // spawn() throws when command exits with non-zero code
    result = spawnError
  }

  const exitCode = result.code ?? 0
  if (exitCode !== 0) {
    throw new Error(`Compression failed (exit code: ${exitCode})`)
  }

  // Verify compressed data file was created.
  if (!existsSync(compressedDataPath)) {
    throw new Error(
      `Compressed data file was not created: ${compressedDataPath}`,
    )
  }

  // Get compressed data size.
  const compressedSizeMB = await getFileSizeMB(compressedDataPath)

  logger.log('')
  logger.success('Compression complete!')
  logger.log(`  Original: ${inputSizeMB.toFixed(2)} MB`)
  logger.log(`  Compressed data: ${compressedSizeMB.toFixed(2)} MB`)
  logger.log(
    `  Reduction: ${(((inputSizeMB - compressedSizeMB) / inputSizeMB) * 100).toFixed(1)}%`,
  )
  logger.log(`  Saved: ${(inputSizeMB - compressedSizeMB).toFixed(2)} MB`)
  logger.log('')

  // Combine stub + compressed data to create self-extracting binary.
  // The stub now handles decompression inline, no need to embed binflate.
  logger.log('Creating self-extracting binary...')

  // Get smol_stub (self-extraction stub with inline decompression)
  const stubName = WIN32 ? 'smol_stub.exe' : 'smol_stub'
  const STUB_DIR = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'stub',
  )
  const stubOutDir = path.join(STUB_DIR, 'out')
  let stubPath = path.join(stubOutDir, stubName)
  const stubPathExe = `${stubPath}.exe`

  // Build stub if it doesn't exist
  if (!existsSync(stubPath) && !existsSync(stubPathExe)) {
    logger.log(`Building self-extracting stub for ${targetArch}...`)
    const makePath = await which('make', { nothrow: true })
    if (!makePath) {
      throw new Error(
        "Build tool 'make' not found. Required to build self-extracting stub.",
      )
    }

    const makeResult = await spawn(makePath, ['all'], {
      cwd: STUB_DIR,
      stdio: 'inherit',
      shell: WIN32,
      env: {
        ...process.env,
        TARGET_ARCH: targetArch,
      },
    })

    if (makeResult.code !== 0) {
      throw new Error(
        `Failed to build self-extracting stub (exit code: ${makeResult.code})`,
      )
    }
  }

  // Check for stub (with or without .exe extension on Windows)
  if (existsSync(stubPathExe)) {
    stubPath = stubPathExe
  } else if (!existsSync(stubPath)) {
    throw new Error(
      `Self-extracting stub not found: ${stubPath}${WIN32 ? ` or ${stubPathExe}` : ''}`,
    )
  }

  // Get sizes
  const stubSizeMB = await getFileSizeMB(stubPath)
  logger.log(`  Stub: ${stubSizeMB.toFixed(2)} MB`)
  logger.log(`  Compressed data: ${compressedSizeMB.toFixed(2)} MB`)

  // Get uncompressed size from input file.
  const inputStats = await fs.stat(inputPath)
  const uncompressedSize = inputStats.size

  // Concatenate stub + compressed data (non-macOS platforms only, macOS handled above).
  // Read all files.
  const stub = await fs.readFile(stubPath)
  const compressedData = await fs.readFile(compressedDataPath)

  // Create magic marker and size headers for compressed data.
  const dataMarker = Buffer.from(
    '__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER',
    'utf-8',
  )
  const compressedSizeBuffer = Buffer.alloc(8)
  const uncompressedSizeBuffer = Buffer.alloc(8)

  // Write sizes as uint64 little-endian.
  compressedSizeBuffer.writeBigUInt64LE(BigInt(compressedData.length), 0)
  uncompressedSizeBuffer.writeBigUInt64LE(BigInt(uncompressedSize), 0)

  // Calculate cache key from compressed data (SHA-512 first 16 hex chars).
  // This allows binject to find the extracted binary without running the stub.
  const cacheKeyHex = createHash('sha512')
    .update(compressedData)
    .digest('hex')
    .slice(0, 16)
  // Write cache key as ASCII string (16 bytes: "abcdef1234567890").
  const cacheKeyBuffer = Buffer.from(cacheKeyHex, 'ascii')

  // Concatenate: stub + data_marker + sizes + cache_key + data.
  // Binary format:
  //   [Stub code]
  //   [__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER]
  //   [8-byte: compressed size]
  //   [8-byte: uncompressed size]
  //   [16-byte: cache key (hex string)]
  //   [Compressed data]
  // No binflate embedding - stub handles decompression inline using shared code.
  const combined = Buffer.concat([
    stub,
    dataMarker,
    compressedSizeBuffer,
    uncompressedSizeBuffer,
    cacheKeyBuffer,
    compressedData,
  ])

  // Write self-extracting binary.
  await fs.writeFile(outputPath, combined, { mode: 0o755 })

  // Clean up temporary compressed data file.
  await safeDelete(compressedDataPath)

  // Get final output size.
  const outputSizeMB = await getFileSizeMB(outputPath)
  const reduction = ((inputSizeMB - outputSizeMB) / inputSizeMB) * 100

  logger.log(`  Final binary: ${outputSizeMB.toFixed(2)} MB`)
  logger.log('')
  logger.success('Self-extracting binary created!')
  logger.log(`  Total size: ${outputSizeMB.toFixed(2)} MB`)
  logger.log(`  Total reduction: ${reduction.toFixed(1)}%`)
  logger.log(`  Total saved: ${(inputSizeMB - outputSizeMB).toFixed(2)} MB`)
*/

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

    // Ensure tool is built.
    const toolPath = await ensureToolBuilt(config)

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
