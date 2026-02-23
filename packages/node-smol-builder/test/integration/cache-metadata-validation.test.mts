/**
 * @fileoverview Tests for cache metadata validation
 *
 * Validates that .dlx-metadata.json always contains compression_algorithm="lzfse"
 * for all platforms and stubs.
 */

import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

describe('Cache Metadata Validation', () => {
  let binaryPath: string
  let testCacheDir: string
  let originalSocketHome: string | undefined

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
  })

  afterAll(async () => {
    // Restore original SOCKET_HOME
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

  it('should write compression_algorithm="lzfse" to cache metadata', async () => {
    // Execute binary to trigger cache extraction
    const result = await spawn(binaryPath, ['--version'], {
      timeout: 30_000,
      env: {
        ...process.env,
        SOCKET_HOME: testCacheDir,
      },
    })

    expect(result.code).toBe(0)
    expect(result.stdout).toMatch(/^v\d+\.\d+\.\d+/)

    // Find cache directory (should be ~/.socket/_dlx/<cache_key>/)
    const dlxDir = path.join(testCacheDir, '_dlx')
    expect(existsSync(dlxDir)).toBe(true)

    // Find cache key directory
    const cacheKeyDirs = await fs.readdir(dlxDir)
    expect(cacheKeyDirs.length).toBeGreaterThan(0)

    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    const metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')

    expect(existsSync(metadataPath)).toBe(true)

    // Read and validate metadata
    const metadataContent = await fs.readFile(metadataPath, 'utf8')
    const metadata = JSON.parse(metadataContent)

    // Validate compression_algorithm field exists and is "lzfse"
    expect(metadata.extra).toBeDefined()
    expect(metadata.extra.compression_algorithm).toBe('lzfse')
  })

  it('should not write other compression algorithms to cache metadata', async () => {
    // Execute binary again (should use cache or create new entry)
    const result = await spawn(binaryPath, ['--version'], {
      timeout: 30_000,
      env: {
        ...process.env,
        SOCKET_HOME: testCacheDir,
      },
    })

    expect(result.code).toBe(0)

    // Find all cache directories
    const dlxDir = path.join(testCacheDir, '_dlx')
    const cacheKeyDirs = await fs.readdir(dlxDir)

    // Check all metadata files
    for (const cacheKeyDir of cacheKeyDirs) {
      const metadataPath = path.join(dlxDir, cacheKeyDir, '.dlx-metadata.json')
      if (existsSync(metadataPath)) {
        // eslint-disable-next-line no-await-in-loop
        const metadataContent = await fs.readFile(metadataPath, 'utf8')
        const metadata = JSON.parse(metadataContent)

        // Should NOT be lzma, lzms, or any other algorithm
        expect(metadata.extra.compression_algorithm).not.toBe('lzma')
        expect(metadata.extra.compression_algorithm).not.toBe('lzms')
        expect(metadata.extra.compression_algorithm).not.toBe('xpress')
        expect(metadata.extra.compression_algorithm).not.toBe('xpress_huff')

        // Should ONLY be lzfse
        expect(metadata.extra.compression_algorithm).toBe('lzfse')
      }
    }
  })

  it('should consistently write lzfse across multiple executions', async () => {
    const algorithms = new Set()

    // Execute binary multiple times
    for (let i = 0; i < 3; i++) {
      // eslint-disable-next-line no-await-in-loop
      const result = await spawn(binaryPath, ['--version'], {
        timeout: 30_000,
        env: {
          ...process.env,
          SOCKET_HOME: testCacheDir,
        },
      })

      expect(result.code).toBe(0)

      // Read metadata
      const dlxDir = path.join(testCacheDir, '_dlx')
      // eslint-disable-next-line no-await-in-loop
      const cacheKeyDirs = await fs.readdir(dlxDir)

      for (const cacheKeyDir of cacheKeyDirs) {
        const metadataPath = path.join(
          dlxDir,
          cacheKeyDir,
          '.dlx-metadata.json',
        )
        if (existsSync(metadataPath)) {
          // eslint-disable-next-line no-await-in-loop
          const metadataContent = await fs.readFile(metadataPath, 'utf8')
          const metadata = JSON.parse(metadataContent)
          algorithms.add(metadata.extra.compression_algorithm)
        }
      }
    }

    // Should only have one algorithm: lzfse
    expect(algorithms.size).toBe(1)
    expect(algorithms.has('lzfse')).toBe(true)
  })
})
