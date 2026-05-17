/**
 * @fileoverview Tests for stub metadata writing.
 *
 * Validates that stubs write correct metadata to .dlx-metadata.json cache files.
 *
 * Tests verify:
 * - All required metadata fields are present
 * - SRI integrity hash is correct format
 * - Sizes are correct
 * - Timestamps are valid
 * - Source type is "extract"
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mts'

const skipTests = !getLatestFinalBinary() || !existsSync(getLatestFinalBinary())

describe.skipIf(skipTests)('stub Metadata Writing', () => {
  let binaryPath: string
  let testCacheDir: string
  let originalSocketHome: string | undefined
  let metadataPath: string
  let metadata: any

  beforeAll(async () => {
    binaryPath = getLatestFinalBinary()
    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`)
    }

    // Create temporary cache directory.
    testCacheDir = path.join(os.tmpdir(), `socket-test-cache-${Date.now()}`)
    await fs.mkdir(testCacheDir, { recursive: true })

    // Set SOCKET_HOME to use test cache directory.
    originalSocketHome = process.env.SOCKET_HOME
    process.env.SOCKET_HOME = testCacheDir

    // Execute binary to trigger cache extraction.
    const result = await spawn(binaryPath, ['--version'], {
      env: {
        ...process.env,
        SOCKET_HOME: testCacheDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })

    expect(result.code).toBe(0)

    // Find cache metadata.
    const dlxDir = path.join(testCacheDir, '_dlx')
    expect(existsSync(dlxDir)).toBeTruthy()

    const cacheKeyDirs = await fs.readdir(dlxDir)
    expect(cacheKeyDirs.length).toBeGreaterThan(0)

    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    expect(existsSync(metadataPath)).toBeTruthy()

    // Read metadata for all tests.
    metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
  })

  afterAll(async () => {
    // Restore original SOCKET_HOME.
    if (originalSocketHome) {
      process.env.SOCKET_HOME = originalSocketHome
    } else {
      delete process.env.SOCKET_HOME
    }

    // Clean up test cache directory.
    if (testCacheDir && existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  describe('required metadata fields', () => {
    it('should write version field', () => {
      expect(metadata.version).toBeDefined()
      expect(metadata.version).toBe('1.0.0')
    })

    it('should write cache_key field', () => {
      expect(metadata.cache_key).toBeDefined()
      expectTypeOf(metadata.cache_key).toBeString()
      expect(metadata.cache_key).toMatch(/^[\da-f]{16}$/)
    })

    it('should write timestamp field', () => {
      expect(metadata.timestamp).toBeDefined()
      expectTypeOf(metadata.timestamp).toBeNumber()
      // Should be valid millisecond timestamp.
      expect(metadata.timestamp).toBeGreaterThan(0)
    })

    it('should write integrity field', () => {
      expect(metadata.integrity).toBeDefined()
      expectTypeOf(metadata.integrity).toBeString()
      expect(metadata.integrity.length).toBeGreaterThan(0)
    })

    it('should write size field', () => {
      expect(metadata.size).toBeDefined()
      expectTypeOf(metadata.size).toBeNumber()
      expect(metadata.size).toBeGreaterThan(0)
    })

    it('should write source field', () => {
      expect(metadata.source).toBeDefined()
      expectTypeOf(metadata.source).toBeObject()
    })

    it('should not write deprecated fields', () => {
      // These fields were removed from the schema.
      expect(metadata.checksum).toBeUndefined()
      expect(metadata.checksum_algorithm).toBeUndefined()
      expect(metadata.platform).toBeUndefined()
      expect(metadata.arch).toBeUndefined()
      expect(metadata.libc).toBeUndefined()
      // extra is in active use for compression_algorithm
    })
  })

  describe('source metadata', () => {
    it('should write source.type as "extract"', () => {
      expect(metadata.source.type).toBe('extract')
    })

    it('should write source.path', () => {
      expect(metadata.source.path).toBeDefined()
      expectTypeOf(metadata.source.path).toBeString()
    })
  })

  describe('timestamp validation', () => {
    it('should write recent timestamp', () => {
      const now = Date.now()
      const fiveMinutesAgo = now - 5 * 60 * 1000

      // Timestamp should be within last 5 minutes.
      expect(metadata.timestamp).toBeGreaterThan(fiveMinutesAgo)
      expect(metadata.timestamp).toBeLessThanOrEqual(now)
    })

    it('should write millisecond timestamp', () => {
      // Timestamps should be in milliseconds (13+ digits for recent dates).
      expect(metadata.timestamp.toString().length).toBeGreaterThanOrEqual(13)
    })
  })

  describe('integrity validation', () => {
    it('should write valid SRI integrity hash', () => {
      // SRI format: sha512-<base64>
      expect(metadata.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
    })

    it('should write integrity with correct base64 length', () => {
      // SHA-512 = 64 bytes, base64 encoded = 86 chars, plus "sha512-" prefix.
      const base64Part = metadata.integrity.replace('sha512-', '')
      // Base64 of 64 bytes = ceil(64/3)*4 = 88 chars, but with padding it's 86 + padding.
      expect(base64Part.length).toBeGreaterThanOrEqual(86)
    })
  })

  describe('cache key validation', () => {
    it('should write 16-character hex cache_key', () => {
      expect(metadata.cache_key).toMatch(/^[\da-f]{16}$/)
    })

    it('should match cache directory name', () => {
      const cacheDirName = path.basename(path.dirname(metadataPath))
      expect(cacheDirName).toBe(metadata.cache_key)
    })
  })

  describe('update check metadata', () => {
    it('should write update_check field', () => {
      expect(metadata.update_check).toBeDefined()
      expectTypeOf(metadata.update_check).toBeObject()
    })

    it('should write update_check.last_check as 0 (not yet checked)', () => {
      expectTypeOf(metadata.update_check.last_check).toBeNumber()
      expect(metadata.update_check.last_check).toBe(0)
    })

    it('should write update_check.last_notification as number', () => {
      expectTypeOf(metadata.update_check.last_notification).toBeNumber()
      expect(metadata.update_check.last_notification).toBeGreaterThanOrEqual(0)
    })

    it('should write update_check.latest_known as empty string (unknown)', () => {
      expectTypeOf(metadata.update_check.latest_known).toBeString()
      expect(metadata.update_check.latest_known).toBe('')
    })
  })
})
