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
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

const skipTests = !getLatestFinalBinary() || !existsSync(getLatestFinalBinary())

describe.skipIf(skipTests)('Stub Metadata Writing', () => {
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
    testCacheDir = path.join(tmpdir(), `socket-test-cache-${Date.now()}`)
    await fs.mkdir(testCacheDir, { recursive: true })

    // Set SOCKET_HOME to use test cache directory.
    originalSocketHome = process.env.SOCKET_HOME
    process.env.SOCKET_HOME = testCacheDir

    // Execute binary to trigger cache extraction.
    const result = await spawn(binaryPath, ['--version'], {
      timeout: 30_000,
      env: {
        ...process.env,
        SOCKET_HOME: testCacheDir,
      },
    })

    expect(result.code).toBe(0)

    // Find cache metadata.
    const dlxDir = path.join(testCacheDir, '_dlx')
    expect(existsSync(dlxDir)).toBe(true)

    const cacheKeyDirs = await fs.readdir(dlxDir)
    expect(cacheKeyDirs.length).toBeGreaterThan(0)

    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    expect(existsSync(metadataPath)).toBe(true)

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
      expect(typeof metadata.timestamp).toBe('number')
      // Should be valid millisecond timestamp.
      expect(metadata.timestamp).toBeGreaterThan(0)
    })

    it('should write integrity field', () => {
      expect(metadata.integrity).toBeDefined()
      expect(typeof metadata.integrity).toBe('string')
      expect(metadata.integrity.length).toBeGreaterThan(0)
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

    it('should not write deprecated fields', () => {
      // These fields were removed from the schema.
      expect(metadata.checksum).toBeUndefined()
      expect(metadata.checksum_algorithm).toBeUndefined()
      expect(metadata.platform).toBeUndefined()
      expect(metadata.arch).toBeUndefined()
      expect(metadata.libc).toBeUndefined()
      expect(metadata.extra).toBeUndefined()
    })
  })

  describe('Source metadata', () => {
    it('should write source.type as "extract"', () => {
      expect(metadata.source.type).toBe('extract')
    })

    it('should write source.path', () => {
      expect(metadata.source.path).toBeDefined()
      expect(typeof metadata.source.path).toBe('string')
    })
  })

  describe('Timestamp validation', () => {
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

  describe('Integrity validation', () => {
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

  describe('Cache key validation', () => {
    it('should write 16-character hex cache_key', () => {
      expect(metadata.cache_key).toMatch(/^[\da-f]{16}$/)
    })

    it('should match cache directory name', () => {
      const cacheDirName = path.basename(path.dirname(metadataPath))
      expect(cacheDirName).toBe(metadata.cache_key)
    })
  })

  describe('Update check metadata', () => {
    it('should write update_check field', () => {
      expect(metadata.update_check).toBeDefined()
      expect(typeof metadata.update_check).toBe('object')
    })

    it('should write update_check.last_check as 0 (not yet checked)', () => {
      expect(typeof metadata.update_check.last_check).toBe('number')
      expect(metadata.update_check.last_check).toBe(0)
    })

    it('should write update_check.last_notification as number', () => {
      expect(typeof metadata.update_check.last_notification).toBe('number')
      expect(metadata.update_check.last_notification).toBeGreaterThanOrEqual(0)
    })

    it('should write update_check.latest_known as empty string (unknown)', () => {
      expect(typeof metadata.update_check.latest_known).toBe('string')
      expect(metadata.update_check.latest_known).toBe('')
    })
  })
})
