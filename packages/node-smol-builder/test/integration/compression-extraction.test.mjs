/**
 * @fileoverview Integration tests for final binary extraction to ~/.socket/_dlx/
 *
 * Tests:
 * - Final binary decompression on first run
 * - Cache directory creation at ~/.socket/_dlx/<cache_key>/
 * - Cache hit detection on subsequent runs
 * - Metadata file generation and validation
 * - Cross-platform cache key calculation (SHA-512)
 *
 * Validates dlxBinary caching pattern compatibility:
 * - generateCacheKey: https://github.com/SocketDev/socket-lib/blob/v5.0.0/src/dlx/cache.ts#L16
 * - DlxMetadata schema: https://github.com/SocketDev/socket-lib/blob/v5.0.0/src/dlx/binary.ts#L49-L130
 *
 * Note: These tests require the final production binary at build/out/Final/node.
 * Run with: pnpm build --dev or pnpm build --prod
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { nodeVersionRaw } from 'build-infra/lib/node-version'
import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Get the latest Final binary from build/{dev,prod}/out/Final/node
const compressedBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !compressedBinaryPath || !existsSync(compressedBinaryPath)

// Cache directory (matches dlx_cache_common.h)
const DLX_DIR = path.join(homedir(), '.socket', '_dlx')

// Test tmp directory
const testTmpDir = path.join(tmpdir(), 'socket-btm-compression-tests')

/**
 * Extract compressed data portion from self-extracting binary.
 * The decompressor calculates cache keys from compressed data only,
 * not from the entire binary (decompressor stub + data).
 * @param {Buffer} binaryData - Full self-extracting binary buffer
 * @returns {Buffer} Compressed data portion after magic marker and size headers
 */
function extractCompressedData(binaryData) {
  const magicMarker = Buffer.from(
    '__SOCKETSEC_COMPRESSED_DATA_MAGIC_MARKER',
    'utf-8',
  )
  const markerIndex = binaryData.indexOf(magicMarker)

  if (markerIndex === -1) {
    throw new Error('Magic marker not found in compressed binary')
  }

  // Compressed data starts after: marker (40 bytes) + compressed_size (8 bytes) + uncompressed_size (8 bytes)
  const dataOffset = markerIndex + magicMarker.length + 8 + 8
  return binaryData.subarray(dataOffset)
}

describe.skipIf(skipTests)('Final binary extraction to ~/.socket/_dlx/', () => {
  let testCacheDir

  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
    // Cleanup test cache directory if created
    if (testCacheDir && existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  describe('Cache directory structure', () => {
    it('should extract to ~/.socket/_dlx/<cache_key>/ on first run', async () => {
      // Calculate expected cache key (SHA-512 of compressed data only, first 16 chars)
      // The decompressor calculates cache key from compressed data portion only,
      // not from the entire self-extracting binary (decompressor stub + data).
      // This ensures cache keys are content-addressable and stable across decompressor updates.
      const binaryData = await fs.readFile(compressedBinaryPath)
      const compressedData = extractCompressedData(binaryData)

      // Calculate cache key from compressed data only (matches decompressor's dlx_calculate_cache_key)
      const hash = createHash('sha512').update(compressedData).digest('hex')
      const cacheKey = hash.slice(0, 16)

      testCacheDir = path.join(DLX_DIR, cacheKey)

      // Clean up any existing cache
      if (existsSync(testCacheDir)) {
        await safeDelete(testCacheDir)
      }

      // Execute compressed binary
      // 30s for first decompression
      const execResult = await spawn(compressedBinaryPath, ['--version'], {
        timeout: 30_000,
      })

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('v24')

      // Verify cache directory was created
      expect(existsSync(testCacheDir)).toBe(true)

      // Verify cache contains extracted binary
      // Note: The decompressor uses platform names directly (darwin, win32, linux)
      const platformSuffix = platform()
      const expectedBinaryName = `node-smol-${platformSuffix}-${process.arch}`

      const cachedBinaryPath = path.join(testCacheDir, expectedBinaryName)
      expect(existsSync(cachedBinaryPath)).toBe(true)

      // Verify binary is executable
      const stats = await fs.stat(cachedBinaryPath)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('should create .dlx-metadata.json in cache directory', async () => {
      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      expect(existsSync(metadataPath)).toBe(true)

      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

      // Verify core DlxMetadata fields
      expect(metadata.version).toBe('1.0.0')
      expect(metadata.cache_key).toBeTruthy()
      expect(metadata.timestamp).toBeTruthy()
      expect(metadata.checksum).toBeTruthy()
      expect(metadata.checksum_algorithm).toBe('sha512')
      expect(metadata.platform).toBe(
        platform() === 'darwin'
          ? 'darwin'
          : platform() === 'win32'
            ? 'win32'
            : 'linux',
      )
      expect(metadata.arch).toBe(process.arch)
      expect(metadata.size).toBeGreaterThan(0)
      expect(metadata.source).toBeDefined()
      expect(metadata.source.type).toBe('decompression')

      // Verify compression-specific fields in extra
      expect(metadata.extra).toBeDefined()
      expect(metadata.extra.compressed_size).toBeGreaterThan(0)
      expect(metadata.extra.compression_algorithm).toBeTruthy()
      expect(metadata.extra.compression_ratio).toBeGreaterThan(0)
    })

    it('should use cached binary on subsequent runs', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        // Skip if cache not created in previous test
        return
      }

      // Second run should be much faster (cache hit)
      const startTime = Date.now()
      // Should be fast (< 5s)
      const execResult = await spawn(compressedBinaryPath, ['--version'], {
        timeout: 5000,
      })
      const duration = Date.now() - startTime

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('v24')

      // Cache hit should be faster than first decompression
      expect(duration).toBeLessThan(5000)
    })

    it('should use platform-specific compression algorithm', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

      const expectedAlgorithm =
        platform() === 'darwin'
          ? 'lzfse'
          : platform() === 'win32'
            ? 'lzms'
            : 'lzma'

      expect(metadata.extra.compression_algorithm).toBe(expectedAlgorithm)
    })
  })

  describe('Stdout/Stdin pipe handling', () => {
    it('should output to stdout on first run (cache miss with extraction)', async () => {
      // Clear cache to force extraction
      if (testCacheDir && existsSync(testCacheDir)) {
        await safeDelete(testCacheDir)
      }

      // Run --version with piped output
      const result = await spawn(compressedBinaryPath, ['--version'], {
        stdio: 'pipe',
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain(nodeVersionRaw)
    })

    it('should output to stdout on subsequent runs (cache hit)', async () => {
      // Run --version again (cache should exist from previous test)
      const result = await spawn(compressedBinaryPath, ['--version'], {
        stdio: 'pipe',
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain(nodeVersionRaw)
    })
  })

  describe('Cache key calculation', () => {
    it('should match SHA-512 based cache key format (16 hex chars only)', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

      // Cache key format: <sha512-16chars> (NO platform/arch suffix)
      // Matches dlxBinary generateCacheKey behavior
      const cacheKeyPattern = /^[\da-f]{16}$/
      expect(metadata.cache_key).toMatch(cacheKeyPattern)

      // Verify cache directory name matches cache_key
      const cacheDirName = path.basename(testCacheDir)
      expect(cacheDirName).toBe(metadata.cache_key)
    })

    it('should be content-addressable (same binary = same cache key)', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      // Recalculate cache key to verify it matches (hash compressed data only, not entire binary)
      const binaryData = await fs.readFile(compressedBinaryPath)
      const compressedData = extractCompressedData(binaryData)
      const hash = createHash('sha512').update(compressedData).digest('hex')
      const expectedCacheKey = hash.slice(0, 16)

      const cacheDirName = path.basename(testCacheDir)
      expect(cacheDirName).toBe(expectedCacheKey)
    })
  })

  describe('Decompressor binary', () => {
    it('should exist alongside compressed binary', () => {
      const compressedDir = path.dirname(compressedBinaryPath)
      const decompressorName =
        platform() === 'darwin'
          ? 'binflate'
          : platform() === 'win32'
            ? 'binflate.exe'
            : 'binflate'

      const decompressorPath = path.join(compressedDir, decompressorName)
      expect(existsSync(decompressorPath)).toBe(true)
    })

    it('should be executable', async () => {
      const compressedDir = path.dirname(compressedBinaryPath)
      const decompressorName =
        platform() === 'darwin'
          ? 'binflate'
          : platform() === 'win32'
            ? 'binflate.exe'
            : 'binflate'

      const decompressorPath = path.join(compressedDir, decompressorName)

      if (platform() !== 'win32') {
        const stats = await fs.stat(decompressorPath)
        expect(stats.mode & 0o100).not.toBe(0)
      }
    })
  })

  describe('Cache cleanup and invalidation', () => {
    it('should handle missing cache directory gracefully', async () => {
      if (!testCacheDir || !existsSync(testCacheDir)) {
        return
      }

      // Delete cache directory
      await safeDelete(testCacheDir)

      // Binary should recreate cache
      const execResult = await spawn(compressedBinaryPath, ['--version'], {
        timeout: 30_000,
      })

      expect(execResult.code).toBe(0)
      expect(existsSync(testCacheDir)).toBe(true)
    })
  })
})
