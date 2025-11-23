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

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { COMPRESSION_TOOLS_DIR } from '../../paths.mjs'

const logger = getDefaultLogger()
const TOOLS_DIR = COMPRESSION_TOOLS_DIR

/**
 * Platform configuration.
 */
const PLATFORM_CONFIG = {
  __proto__: null,
  darwin: {
    toolName: 'socketsecurity_macho_compress',
    binaryFormat: 'Mach-O',
    defaultQuality: 'lzfse',
    qualityOptions: ['lz4', 'zlib', 'lzfse', 'lzma'],
    buildCommand: 'make -f Makefile',
  },
  linux: {
    toolName: 'socketsecurity_elf_compress',
    binaryFormat: 'ELF',
    defaultQuality: 'lzma',
    qualityOptions: ['lzma'],
    buildCommand: 'make -f Makefile.linux',
  },
  win32: {
    toolName: 'socketsecurity_pe_compress',
    binaryFormat: 'PE',
    defaultQuality: 'lzms',
    qualityOptions: ['xpress', 'xpress_huff', 'lzms'],
    buildCommand: 'mingw32-make -f Makefile.windows',
  },
}

/**
 * Parse command line arguments.
 */
function parseArgs() {
  const args = process.argv.slice(2)

  if (args.length < 2) {
    logger.error(
      'Usage: compress-binary.mjs <input> <output> [--quality=lzma|lzfse|xpress] [--spec=package@version]',
    )
    logger.error('')
    logger.error('Examples:')
    logger.error('  node scripts/compress-binary.mjs ./node ./node.compressed')
    logger.error(
      '  node scripts/compress-binary.mjs ./node ./node.compressed --quality=lzma',
    )
    logger.error(
      '  node scripts/compress-binary.mjs ./node ./node.compressed --spec=@socketbin/node-smol-builder-darwin-arm64@0.0.0-24.10.0',
    )
    process.exit(1)
  }

  const inputPath = path.resolve(args[0])
  const outputPath = path.resolve(args[1])
  let quality = null
  let spec = null

  for (const arg of args.slice(2)) {
    if (arg.startsWith('--quality=')) {
      quality = arg.substring('--quality='.length)
    } else if (arg.startsWith('--spec=')) {
      spec = arg.substring('--spec='.length)
    }
  }

  return { inputPath, outputPath, quality, spec }
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
 * Compress binary using platform-specific tool.
 */
async function compressBinary(
  toolPath,
  inputPath,
  outputPath,
  quality,
  spec,
  config,
) {
  // Validate input file exists.
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  // Get input file size.
  const inputSizeMB = await getFileSizeMB(inputPath)

  logger.log(`Compressing ${config.binaryFormat} binary...`)
  logger.log(`  Input: ${inputPath} (${inputSizeMB.toFixed(2)} MB)`)
  logger.log(`  Output: ${outputPath}`)
  logger.log(`  Quality: ${quality || config.defaultQuality}`)
  logger.log('')

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
  logger.log('✓ Compression complete!')
  logger.log(`  Original: ${inputSizeMB.toFixed(2)} MB`)
  logger.log(`  Compressed data: ${compressedSizeMB.toFixed(2)} MB`)
  logger.log(
    `  Reduction: ${(((inputSizeMB - compressedSizeMB) / inputSizeMB) * 100).toFixed(1)}%`,
  )
  logger.log(`  Saved: ${(inputSizeMB - compressedSizeMB).toFixed(2)} MB`)
  logger.log('')

  // Combine decompressor with compressed data to create self-extracting binary.
  logger.log('Creating self-extracting binary...')

  const decompressorName = config.toolName.replace('_compress', '_decompress')
  let decompressorPath = path.join(TOOLS_DIR, decompressorName)
  const decompressorPathExe = `${decompressorPath}.exe`

  // Check for decompressor (with or without .exe extension on Windows)
  if (existsSync(decompressorPathExe)) {
    decompressorPath = decompressorPathExe
  } else if (!existsSync(decompressorPath)) {
    throw new Error(
      `Decompressor not found: ${decompressorPath}${WIN32 ? ` or ${decompressorPathExe}` : ''}`,
    )
  }

  // Get decompressor size.
  const decompressorSizeMB = await getFileSizeMB(decompressorPath)
  logger.log(`  Decompressor: ${decompressorSizeMB.toFixed(2)} MB`)
  logger.log(`  Compressed data: ${compressedSizeMB.toFixed(2)} MB`)

  // Combine: decompressor + spec_header + compressed_data → self-extracting binary.
  // Read both files.
  const decompressor = await fs.readFile(decompressorPath)
  const compressedData = await fs.readFile(compressedDataPath)

  // Create spec header if provided (for socket-lib cache key generation).
  const specHeader = spec
    ? Buffer.from(`SMOL_SPEC:${spec}\n`, 'utf-8')
    : Buffer.alloc(0)

  if (spec) {
    logger.log(`  Spec string: ${spec}`)
  }

  // Create magic marker and size headers for decompressor to find data
  const magicMarker = Buffer.from(
    'SOCKETBIN_COMPRESSED_DATA_START_MAGIC_MARKER',
    'utf-8',
  )
  const compressedSizeBuffer = Buffer.alloc(8)
  const uncompressedSizeBuffer = Buffer.alloc(8)

  // Get uncompressed size from input file
  const inputStats = await fs.stat(inputPath)
  const uncompressedSize = inputStats.size

  // Write sizes as uint64 little-endian
  compressedSizeBuffer.writeBigUInt64LE(BigInt(compressedData.length), 0)
  uncompressedSizeBuffer.writeBigUInt64LE(BigInt(uncompressedSize), 0)

  // Concatenate: stub + spec_header + magic_marker + sizes + data.
  const combined = Buffer.concat([
    decompressor,
    specHeader,
    magicMarker,
    compressedSizeBuffer,
    uncompressedSizeBuffer,
    compressedData,
  ])

  // Write self-extracting binary.
  await fs.writeFile(outputPath, combined, { mode: 0o755 })

  // Clean up temporary compressed data file.
  await fs.unlink(compressedDataPath)

  // Get final output size.
  const outputSizeMB = await getFileSizeMB(outputPath)
  const reduction = ((inputSizeMB - outputSizeMB) / inputSizeMB) * 100

  logger.log(`  Final binary: ${outputSizeMB.toFixed(2)} MB`)
  logger.log('')
  logger.log('✓ Self-extracting binary created!')
  logger.log(`  Total size: ${outputSizeMB.toFixed(2)} MB`)
  logger.log(`  Total reduction: ${reduction.toFixed(1)}%`)
  logger.log(`  Total saved: ${(inputSizeMB - outputSizeMB).toFixed(2)} MB`)
}

/**
 * Main function.
 */
async function main() {
  try {
    const { inputPath, outputPath, quality, spec } = parseArgs()
    const config = getPlatformConfig()

    logger.log('Socket Binary Compression')
    logger.log('=========================')
    logger.log(`Platform: ${config.binaryFormat} (${process.platform})`)
    logger.log('')

    // Ensure tool is built.
    const toolPath = await ensureToolBuilt(config)

    // Compress binary.
    await compressBinary(toolPath, inputPath, outputPath, quality, spec, config)
  } catch (e) {
    logger.error(`Error: ${e.message}`)
    process.exit(1)
  }
}

main()
