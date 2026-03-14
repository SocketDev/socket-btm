/**
 * @fileoverview Compress macOS binaries using Apple's Compression framework.
 *
 * This script integrates socket_macho_compress with the Node.js build process.
 * It provides an alternative to UPX that works with macOS code signing.
 *
 * Features:
 *   - Compresses Mach-O binaries using LZFSE
 *   - Preserves code signature compatibility
 *   - ~20-30% size reduction beyond stripping
 *   - Creates decompressor for runtime execution
 *
 * Usage:
 *   node compress-macho.mjs <input_binary> [output_binary] [--quality=lzfse]
 *
 * Example:
 *   node compress-macho.mjs <build-dir>/out/Signed/node/node <build-dir>/out/Compressed/node/node
 */

import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to compression tools.
const TOOLS_DIR = path.join(__dirname, '..', 'additions', 'tools')
const COMPRESS_TOOL = path.join(TOOLS_DIR, 'socket_macho_compress')
const DECOMPRESS_TOOL = path.join(TOOLS_DIR, 'socket_macho_decompress')

/**
 * Build compression tools if needed.
 */
async function buildTools() {
  if (existsSync(COMPRESS_TOOL) && existsSync(DECOMPRESS_TOOL)) {
    logger.success('Compression tools already built')
    return
  }

  logger.log('Building compression tools...')
  logger.log(`  Directory: ${TOOLS_DIR}`)
  logger.log('')

  try {
    const { stderr, stdout } = await spawn('make', ['all'], {
      cwd: TOOLS_DIR,
      env: { ...process.env },
    })

    if (stdout) {
      logger.log(stdout)
    }
    if (stderr) {
      logger.error(stderr)
    }

    if (!existsSync(COMPRESS_TOOL)) {
      throw new Error('Compressor tool was not built')
    }
    if (!existsSync(DECOMPRESS_TOOL)) {
      throw new Error('Decompressor tool was not built')
    }

    logger.success('Tools built successfully')
    logger.log('')
  } catch (error) {
    logger.fail('Failed to build tools:')
    logger.error(error.message)
    throw error
  }
}

/**
 * Compress a Mach-O binary.
 */
async function compressBinary(inputPath, outputPath, quality = 'lzfse') {
  logger.log('Compressing binary...')
  logger.log(`  Input: ${inputPath}`)
  logger.log(`  Output: ${outputPath}`)
  logger.log(`  Quality: ${quality}`)
  logger.log('')

  // Ensure input exists.
  if (!existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }

  // Create output directory.
  await mkdir(path.dirname(outputPath), { recursive: true })

  // Run compression tool.
  try {
    const args = [inputPath, outputPath, `--quality=${quality}`]
    const { stderr, stdout } = await spawn(COMPRESS_TOOL, args)

    if (stdout) {
      logger.log(stdout)
    }
    if (stderr) {
      logger.error(stderr)
    }

    if (!existsSync(outputPath)) {
      throw new Error('Compressed binary was not created')
    }

    logger.log('')
    logger.success('Compression complete')
  } catch (error) {
    logger.fail('Compression failed:')
    logger.error(error.message)
    throw error
  }
}

/**
 * Main function.
 */
async function main() {
  const args = process.argv.slice(2)

  if (args.length < 1) {
    logger.error(
      'Usage: node compress-macho.mjs <input_binary> [output_binary]',
    )
    logger.error()
    logger.error('Example:')
    logger.error(
      '  node compress-macho.mjs <build-dir>/out/Signed/node/node <build-dir>/out/Compressed/node/node',
    )
    logger.error()
    logger.error('Compression: LZFSE (~35-45% reduction)')
    process.exitCode = 1
    return
  }

  const inputPath = args[0]
  const outputPath =
    args[1] || inputPath.replace(/(\.[^.]+)?$/, '.compressed$1')

  // Parse quality argument.
  let quality = 'lzfse'
  for (const arg of args) {
    if (arg.startsWith('--quality=')) {
      quality = arg.substring(10)
    }
  }

  try {
    // Build tools if needed.
    await buildTools()

    // Compress binary.
    await compressBinary(inputPath, outputPath, quality)

    logger.log('')
    logger.log('📝 Next steps:')
    logger.log('')
    logger.log('1. Test the compressed binary:')
    logger.log(`   ${DECOMPRESS_TOOL} ${outputPath} --version`)
    logger.log('')
    logger.log('2. Sign the compressed binary (macOS):')
    logger.log(`   codesign --sign - --force ${outputPath}`)
    logger.log('')
    logger.log('3. Distribute the compressed binary with the decompressor')
    logger.log(`   cp ${DECOMPRESS_TOOL} <distribution-directory>/`)
    logger.log('')
  } catch {
    logger.error()
    logger.fail('Compression failed')
    process.exitCode = 1
  }
}

main()
