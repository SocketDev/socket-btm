/**
 * @fileoverview Helper utilities for working with compressed binaries and cache extraction.
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { homedir, platform } from 'node:os'
import path from 'node:path'

import { spawn } from '@socketsecurity/lib/spawn'

import {
  MAGIC_MARKER,
  TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG,
} from '../../scripts/binary-compressed/shared/constants.mjs'

/**
 * Extract compressed data portion from self-extracting binary.
 * The decompressor calculates cache keys from compressed data only,
 * not from the entire binary (decompressor stub + data).
 *
 * @param {Buffer} binaryData - Full self-extracting binary buffer
 * @returns {Buffer} Compressed data portion after magic marker and size headers
 */
export function extractCompressedData(binaryData) {
  const magicMarker = Buffer.from(MAGIC_MARKER, 'utf-8')
  const markerIndex = binaryData.indexOf(magicMarker)

  if (markerIndex === -1) {
    throw new Error('Magic marker not found in compressed binary')
  }

  // Compressed data starts after: marker + compressed_size + uncompressed_size + cache_key + platform_metadata
  const dataOffset = markerIndex + TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG
  return binaryData.subarray(dataOffset)
}

/**
 * Calculate cache key for a compressed binary.
 * Matches the decompressor's dlx_calculate_cache_key() function.
 *
 * @param {string} compressedBinaryPath - Path to compressed binary
 * @returns {Promise<string>} Cache key (first 16 hex chars of SHA-512 hash)
 */
export async function calculateCacheKey(compressedBinaryPath) {
  const binaryData = await fs.readFile(compressedBinaryPath)
  const compressedData = extractCompressedData(binaryData)
  const hash = createHash('sha512').update(compressedData).digest('hex')
  return hash.slice(0, 16)
}

/**
 * Get the path to the extracted binary in the cache for a compressed binary.
 *
 * @param {string} compressedBinaryPath - Path to compressed binary
 * @returns {Promise<string>} Path to extracted binary in ~/.socket/_dlx/
 */
export async function getExtractedBinaryPath(compressedBinaryPath) {
  const cacheKey = await calculateCacheKey(compressedBinaryPath)
  const dlxDir = path.join(homedir(), '.socket', '_dlx')
  const cacheDir = path.join(dlxDir, cacheKey)

  // Cache path: ~/.socket/_dlx/<hash>/node (or node.exe on Windows)
  const platformName = platform()
  const binaryName = platformName === 'win32' ? 'node.exe' : 'node'

  return path.join(cacheDir, binaryName)
}

/**
 * Extract binary to cache by running it once.
 * This triggers the decompression and writes the binary to ~/.socket/_dlx/
 *
 * @param {string} compressedBinaryPath - Path to compressed binary
 * @param {number} [timeout=60000] - Timeout in milliseconds (default: 60s for initial extraction)
 * @returns {Promise<string>} Path to extracted binary
 */
export async function extractToCache(compressedBinaryPath, timeout = 60_000) {
  // Run the binary once to trigger extraction.
  // Use longer timeout for first extraction (decompression takes time).
  const result = await spawn(compressedBinaryPath, ['--version'], {
    timeout,
  })

  if (result.code !== 0) {
    throw new Error(
      `Failed to extract binary (exit code ${result.code}): ${result.stderr}`,
    )
  }

  // Return the path to the extracted binary
  return await getExtractedBinaryPath(compressedBinaryPath)
}
