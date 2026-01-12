/**
 * @fileoverview Tests for stub metadata writing
 *
 * Validates that stubs write correct metadata to .dlx-metadata.json cache files.
 *
 * Tests verify:
 * - All required metadata fields are present
 * - Compression algorithm is always "lzfse"
 * - Sizes and checksums are correct
 * - Timestamps are valid
 * - Source type is "decompression"
 * - Compression ratio is calculated correctly
 */

import { existsSync, promises as fs } from 'node:fs'
import { tmpdir, platform, arch } from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

const skipTests = !getLatestFinalBinary() || !existsSync(getLatestFinalBinary())

describe.skipIf(skipTests)('Stub Metadata Writing', () => {
  let binaryPath
  let testCacheDir
  let originalSocketHome
  let metadataPath
  let metadata

  beforeAll(async () => {
    binaryPath = getLatestFinalBinary()
    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`)
    }

    // Create temporary cache directory
    testCacheDir = path.join(tmpdir(), `socket-test-cache-${Date.now()}`)
    await fs.mkdir(testCacheDir, { recursive: true })

    // Set SOCKET_HOME to use test cache directory
    originalSocketHome = process.env.SOCKET_HOME
    process.env.SOCKET_HOME = testCacheDir

    // Execute binary to trigger cache extraction
    const result = await spawn(binaryPath, ['--version'], {
      timeout: 30_000,
      env: {
        ...process.env,
        SOCKET_HOME: testCacheDir,
      },
    })

    expect(result.code).toBe(0)

    // Find cache metadata
    const dlxDir = path.join(testCacheDir, '_dlx')
    expect(existsSync(dlxDir)).toBe(true)

    const cacheKeyDirs = await fs.readdir(dlxDir)
    expect(cacheKeyDirs.length).toBeGreaterThan(0)

    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    expect(existsSync(metadataPath)).toBe(true)

    // Read metadata for all tests
    metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
  })

  afterAll(async () => {
    // Restore original SOCKET_HOME
    if (originalSocketHome) {
      process.env.SOCKET_HOME = originalSocketHome
    } else {
      delete process.env.SOCKET_HOME
    }

    // Clean up test cache directory
    if (testCacheDir && existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  describe('Required metadata fields', () => {
    it('should write version field', () => {
      expect(metadata.version).toBeDefined()
      expect(metadata.version).toBe('1.0.0')
    })

    it('should write cache_key field', () => {
      expect(metadata.cache_key).toBeDefined()
      expect(typeof metadata.cache_key).toBe('string')
      expect(metadata.cache_key).toMatch(/^[\da-f]{16}$/)
    })

    it('should write timestamp field', () => {
      expect(metadata.timestamp).toBeDefined()
      expect(typeof metadata.timestamp).toBe('string')
      // Should be valid ISO 8601 timestamp
      expect(new Date(metadata.timestamp).toString()).not.toBe('Invalid Date')
    })

    it('should write checksum field', () => {
      expect(metadata.checksum).toBeDefined()
      expect(typeof metadata.checksum).toBe('string')
      expect(metadata.checksum.length).toBeGreaterThan(0)
    })

    it('should write checksum_algorithm field', () => {
      expect(metadata.checksum_algorithm).toBeDefined()
      expect(metadata.checksum_algorithm).toBe('sha512')
    })

    it('should write platform field', () => {
      expect(metadata.platform).toBeDefined()
      expect(['linux', 'darwin', 'win32']).toContain(metadata.platform)
      expect(metadata.platform).toBe(platform())
    })

    it('should write arch field', () => {
      expect(metadata.arch).toBeDefined()
      expect(['x64', 'arm64', 'ia32', 'arm']).toContain(metadata.arch)
      expect(metadata.arch).toBe(arch())
    })

    it('should write size field', () => {
      expect(metadata.size).toBeDefined()
      expect(typeof metadata.size).toBe('number')
      expect(metadata.size).toBeGreaterThan(0)
    })

    it('should write source field', () => {
      expect(metadata.source).toBeDefined()
      expect(typeof metadata.source).toBe('object')
    })

    it('should write extra field', () => {
      expect(metadata.extra).toBeDefined()
      expect(typeof metadata.extra).toBe('object')
    })
  })

  describe('Source metadata', () => {
    it('should write source.type as "decompression"', () => {
      expect(metadata.source.type).toBe('decompression')
    })

    it('should write source.path', () => {
      expect(metadata.source.path).toBeDefined()
      expect(typeof metadata.source.path).toBe('string')
    })
  })

  describe('Compression metadata', () => {
    it('should write compression_algorithm as "lzfse"', () => {
      expect(metadata.extra.compression_algorithm).toBe('lzfse')
    })

    it('should write compressed_size', () => {
      expect(metadata.extra.compressed_size).toBeDefined()
      expect(typeof metadata.extra.compressed_size).toBe('number')
      expect(metadata.extra.compressed_size).toBeGreaterThan(0)
    })

    it('should write compression_ratio', () => {
      expect(metadata.extra.compression_ratio).toBeDefined()
      expect(typeof metadata.extra.compression_ratio).toBe('number')
      expect(metadata.extra.compression_ratio).toBeGreaterThan(0)
    })

    it('should calculate compression_ratio correctly', () => {
      // Compression ratio = uncompressed_size / compressed_size
      const expectedRatio = metadata.size / metadata.extra.compressed_size
      expect(metadata.extra.compression_ratio).toBeCloseTo(expectedRatio, 5)
    })

    it('should have compression_ratio > 1.0', () => {
      // Ratio > 1.0 means compressed is smaller than uncompressed
      expect(metadata.extra.compression_ratio).toBeGreaterThan(1.0)
    })

    it('should have compressed_size < uncompressed_size', () => {
      // Compressed data should be smaller than uncompressed
      expect(metadata.extra.compressed_size).toBeLessThan(metadata.size)
    })
  })

  describe('Platform-specific metadata', () => {
    it('should write libc field on Linux', () => {
      if (platform() === 'linux') {
        expect(metadata.extra.libc).toBeDefined()
        expect(['glibc', 'musl']).toContain(metadata.extra.libc)
      }
    })

    it('should not write libc field on non-Linux', () => {
      if (platform() !== 'linux') {
        expect(metadata.extra.libc).toBeUndefined()
      }
    })
  })

  describe('Timestamp validation', () => {
    it('should write recent timestamp', () => {
      const timestamp = new Date(metadata.timestamp)
      const now = new Date()
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000)

      // Timestamp should be within last 5 minutes
      expect(timestamp.getTime()).toBeGreaterThan(fiveMinutesAgo.getTime())
      expect(timestamp.getTime()).toBeLessThanOrEqual(now.getTime())
    })

    it('should write ISO 8601 format timestamp', () => {
      // ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
      const iso8601Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      expect(metadata.timestamp).toMatch(iso8601Pattern)
    })
  })

  describe('Checksum validation', () => {
    it('should write valid SHA-512 checksum', () => {
      // SHA-512 produces 128 hex characters
      expect(metadata.checksum).toMatch(/^[\da-f]{128}$/)
    })
  })

  describe('Cache key validation', () => {
    it('should write 16-character hex cache_key', () => {
      expect(metadata.cache_key).toMatch(/^[\da-f]{16}$/)
    })

    it('should match cache directory name', () => {
      const cacheDirName = path.basename(path.dirname(metadataPath))
      expect(cacheDirName).toBe(metadata.cache_key)
    })
  })
})
