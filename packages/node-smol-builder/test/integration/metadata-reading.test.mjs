/**
 * @fileoverview Tests for metadata reading correctness
 *
 * Validates that stubs correctly read metadata bytes from binaries and write
 * correct values to .dlx-metadata.json cache files.
 *
 * Tests verify:
 * - Platform byte is correctly read and written to cache metadata
 * - Architecture byte is correctly read and written to cache metadata
 * - Libc byte is correctly read and written to cache metadata
 * - Platform/arch/libc mappings match binary metadata bytes
 */

import { existsSync, promises as fs } from 'node:fs'
import { tmpdir, platform, arch } from 'node:os'
import path from 'node:path'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  MAGIC_MARKER,
  HEADER_SIZES,
  PLATFORM_VALUES,
  ARCH_VALUES,
  LIBC_VALUES,
} from '../../scripts/binary-compressed/shared/constants.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

const skipTests = !getLatestFinalBinary() || !existsSync(getLatestFinalBinary())

describe.skipIf(skipTests)('Metadata Reading Correctness', () => {
  let binaryPath
  let testCacheDir
  let originalSocketHome

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

    // Clean up test cache directory
    if (testCacheDir && existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  it('should correctly read platform byte from binary', async () => {
    // Read binary metadata bytes
    const binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))
    expect(markerIndex).toBeGreaterThan(-1)

    // Read platform byte from binary (offset: marker + sizes + cache_key = 64)
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY
    const platformByte = binaryData[metadataOffset]

    // Execute binary to extract to cache
    const result = await spawn(binaryPath, ['--version'], {
      timeout: 30_000,
      env: {
        ...process.env,
        SOCKET_HOME: testCacheDir,
      },
    })

    expect(result.code).toBe(0)

    // Find cache directory
    const dlxDir = path.join(testCacheDir, '_dlx')
    expect(existsSync(dlxDir)).toBe(true)

    const cacheKeyDirs = await fs.readdir(dlxDir)
    expect(cacheKeyDirs.length).toBeGreaterThan(0)

    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    const metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    expect(existsSync(metadataPath)).toBe(true)

    // Read cache metadata
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

    // Verify platform byte matches
    const expectedPlatform =
      platformByte === 0 ? 'linux' : platformByte === 1 ? 'darwin' : 'win32'
    expect(metadata.platform).toBe(expectedPlatform)
  })

  it('should correctly read architecture byte from binary', async () => {
    // Read binary metadata bytes
    const binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY
    const archByte = binaryData[metadataOffset + 1]

    // Find cache metadata (already extracted in previous test)
    const dlxDir = path.join(testCacheDir, '_dlx')
    const cacheKeyDirs = await fs.readdir(dlxDir)
    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    const metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

    // Verify arch byte matches
    const expectedArch =
      archByte === 0
        ? 'x64'
        : archByte === 1
          ? 'arm64'
          : archByte === 2
            ? 'ia32'
            : 'arm'
    expect(metadata.arch).toBe(expectedArch)
  })

  it('should correctly read libc byte from binary on Linux', async () => {
    if (platform() !== 'linux') {
      // Skip on non-Linux
      return
    }

    // Read binary metadata bytes
    const binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY
    const libcByte = binaryData[metadataOffset + 2]

    // Find cache metadata
    const dlxDir = path.join(testCacheDir, '_dlx')
    const cacheKeyDirs = await fs.readdir(dlxDir)
    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    const metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

    // Verify libc byte matches (on Linux)
    const expectedLibc =
      libcByte === 0 ? 'glibc' : libcByte === 1 ? 'musl' : undefined
    expect(metadata.extra.libc).toBe(expectedLibc)
  })

  it('should have n/a libc on non-Linux platforms', async () => {
    if (platform() === 'linux') {
      // Skip on Linux
      return
    }

    // Read binary metadata bytes
    const binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY
    const libcByte = binaryData[metadataOffset + 2]

    // On non-Linux, libc byte should be 255 (n/a)
    expect(libcByte).toBe(LIBC_VALUES.na)

    // Find cache metadata
    const dlxDir = path.join(testCacheDir, '_dlx')
    const cacheKeyDirs = await fs.readdir(dlxDir)
    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    const metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

    // Verify libc is undefined (n/a on non-Linux)
    expect(metadata.extra.libc).toBeUndefined()
  })

  it('should match current platform metadata', async () => {
    // Read binary metadata bytes
    const binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY

    const platformByte = binaryData[metadataOffset]
    const archByte = binaryData[metadataOffset + 1]
    const libcByte = binaryData[metadataOffset + 2]

    // Verify bytes match current platform
    expect(platformByte).toBe(PLATFORM_VALUES[platform()])
    expect(archByte).toBe(ARCH_VALUES[arch()])

    if (platform() === 'linux') {
      // On Linux, libc should be 0 (glibc) or 1 (musl)
      expect([LIBC_VALUES.glibc, LIBC_VALUES.musl]).toContain(libcByte)
    } else {
      // On non-Linux, libc should be 255 (n/a)
      expect(libcByte).toBe(LIBC_VALUES.na)
    }
  })

  it('should write metadata that matches binary bytes exactly', async () => {
    // Read binary metadata bytes
    const binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))
    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY

    const platformByte = binaryData[metadataOffset]
    const archByte = binaryData[metadataOffset + 1]
    const libcByte = binaryData[metadataOffset + 2]

    // Find cache metadata
    const dlxDir = path.join(testCacheDir, '_dlx')
    const cacheKeyDirs = await fs.readdir(dlxDir)
    const cacheKeyDir = path.join(dlxDir, cacheKeyDirs[0])
    const metadataPath = path.join(cacheKeyDir, '.dlx-metadata.json')
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'))

    // Verify platform matches
    const platformMapping = { 0: 'linux', 1: 'darwin', 2: 'win32' }
    expect(metadata.platform).toBe(platformMapping[platformByte])

    // Verify arch matches
    const archMapping = { 0: 'x64', 1: 'arm64', 2: 'ia32', 3: 'arm' }
    expect(metadata.arch).toBe(archMapping[archByte])

    // Verify libc matches (if on Linux)
    if (platform() === 'linux') {
      const libcMapping = { 0: 'glibc', 1: 'musl' }
      expect(metadata.extra.libc).toBe(libcMapping[libcByte])
    } else {
      expect(libcByte).toBe(255)
      expect(metadata.extra.libc).toBeUndefined()
    }
  })
})
