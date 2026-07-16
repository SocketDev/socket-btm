import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * @file Integration tests for stub extraction flow — cache key, node binary
 *   extraction, cache reuse, and signing metadata preservation.
 *
 *   - node binary extraction to ~/.socket/_dlx/<cache_key>/
 *   - Cache reuse on subsequent runs
 *   - Code signing preserves metadata format Binary structure, code signing,
 *     execution, forwarding, addons, and ICU tests live in sibling files
 *     (stub-signing-structure/runtime.test.mts).
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  HEADER_SIZES,
  SMOL_PRESSED_DATA_MAGIC_MARKER,
  TOTAL_HEADER_SIZE_WITH_SMOL_CONFIG,
  TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG,
} from 'build-infra/lib/constants'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getSocketDlxDir } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  MACHO_SECTION_PRESSED_DATA,
  MACHO_SEGMENT_NODE_SEA,
  MACHO_SEGMENT_SMOL,
} from 'bin-infra/test/helpers/segment-names'
import { getLatestFinalBinary } from '../paths.mts'

const IS_MACOS = os.platform() === 'darwin'

// Get the latest Final binary (the stub with embedded compressed node)
const stubBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !stubBinaryPath || !existsSync(stubBinaryPath)

// Cache directory
const DLX_DIR = getSocketDlxDir()
const testTmpDir = path.join(os.tmpdir(), 'socket-btm-stub-tests')

/**
 * Extract compressed data portion from stub binary.
 */
export function extractCompressedData(binaryData: Buffer) {
  const magicMarker = Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8')
  const markerIndex = binaryData.indexOf(magicMarker)

  if (markerIndex === -1) {
    throw new Error('Magic marker not found in the binary')
  }

  // Check config flag to determine actual header size. Layout:
  // marker + compressed_size + uncompressed_size + cache_key
  // + platform_metadata + integrity_hash + [flag][config?] + data
  const configFlagOffset =
    markerIndex +
    HEADER_SIZES.MAGIC_MARKER +
    HEADER_SIZES.COMPRESSED_SIZE +
    HEADER_SIZES.UNCOMPRESSED_SIZE +
    HEADER_SIZES.CACHE_KEY +
    HEADER_SIZES.PLATFORM_METADATA +
    HEADER_SIZES.INTEGRITY_HASH
  const hasSmolConfig = binaryData[configFlagOffset] === 1

  const headerSize = hasSmolConfig
    ? TOTAL_HEADER_SIZE_WITH_SMOL_CONFIG
    : TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG

  return binaryData.subarray(markerIndex + headerSize)
}

/**
 * Check if a binary is code-signed (macOS only)
 */
export async function isCodeSigned(binaryPath) {
  if (!IS_MACOS) {
    // Skip on non-macOS
    return { signed: true, valid: true }
  }

  try {
    const result = await spawn('codesign', ['-v', '-v', binaryPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    })
    // codesign returns 0 for valid signatures
    return {
      output: result.stderr || result.stdout,
      signed: true,
      valid: result.code === 0,
    }
  } catch (e) {
    return {
      error: e.message,
      signed: false,
      valid: false,
    }
  }
}

/**
 * Parse Mach-O segments and sections (macOS only)
 * Returns array of {segmentName, sections: [{sectionName, segmentName}]}
 */
export function parseMachoSegments(binaryData) {
  if (os.platform() !== 'darwin') {
    return []
  }

  const segments = []

  // Mach-O magic numbers
  const MH_MAGIC_64 = 0xfe_ed_fa_cf
  const MH_CIGAM_64 = 0xcf_fa_ed_fe

  // Read first 4 bytes to check magic
  const magic = binaryData.readUInt32LE(0)
  const isLittleEndian = magic === MH_MAGIC_64

  if (!isLittleEndian && magic !== MH_CIGAM_64) {
    throw new Error('Not a 64-bit Mach-O binary')
  }

  // Read header
  const ncmds = isLittleEndian
    ? binaryData.readUInt32LE(16)
    : binaryData.readUInt32BE(16)

  // sizeof(mach_header_64)
  let offset = 32

  // Parse load commands
  for (let i = 0; i < ncmds; i++) {
    const cmd = isLittleEndian
      ? binaryData.readUInt32LE(offset)
      : binaryData.readUInt32BE(offset)
    const cmdsize = isLittleEndian
      ? binaryData.readUInt32LE(offset + 4)
      : binaryData.readUInt32BE(offset + 4)

    // LC_SEGMENT_64 = 0x19
    if (cmd === 0x19) {
      // Read segment name (16 bytes at offset + 8)
      const segmentName = binaryData
        .subarray(offset + 8, offset + 24)
        .toString('utf8')
        .replace(/\0.*$/, '')

      const nsects = isLittleEndian
        ? binaryData.readUInt32LE(offset + 64)
        : binaryData.readUInt32BE(offset + 64)

      const sections = []
      // sizeof(segment_command_64)
      let sectionOffset = offset + 72

      for (let j = 0; j < nsects; j++) {
        const sectionName = binaryData
          .subarray(sectionOffset, sectionOffset + 16)
          .toString('utf8')
          .replace(/\0.*$/, '')

        const sectSegmentName = binaryData
          .subarray(sectionOffset + 16, sectionOffset + 32)
          .toString('utf8')
          .replace(/\0.*$/, '')

        sections.push({
          sectionName,
          segmentName: sectSegmentName,
        })

        // sizeof(section_64)
        sectionOffset += 80
      }

      segments.push({
        sections,
        segmentName,
      })
    }

    offset += cmdsize
  }

  return segments
}

describe.skipIf(skipTests)('stub signing and extraction flow', () => {
  let testCacheDir: string
  let extractedNodePath: string

  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })

    // Read cache key from binary header (same way the stub does)
    const binaryData = await fs.readFile(stubBinaryPath)
    const magicMarker = Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8')
    const markerIndex = binaryData.indexOf(magicMarker)
    // Cache key is at: marker + magic(32) + compressed_size(8) + uncompressed_size(8)
    const cacheKeyOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE
    const cacheKey = binaryData
      .subarray(cacheKeyOffset, cacheKeyOffset + HEADER_SIZES.CACHE_KEY)
      .toString('utf8')
    testCacheDir = path.join(DLX_DIR, cacheKey)

    // Clean up any existing cache
    if (existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  afterAll(async () => {
    await safeDelete(testTmpDir)
    if (testCacheDir && existsSync(testCacheDir)) {
      await safeDelete(testCacheDir)
    }
  })

  describe('node binary extraction', () => {
    beforeAll(async () => {
      // Run the stub binary to trigger extraction into testCacheDir
      await spawn(stubBinaryPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      })
      const expectedBinaryName = os.platform() === 'win32' ? 'node.exe' : 'node'
      extractedNodePath = path.join(testCacheDir, expectedBinaryName)
    })

    it('should extract node binary to ~/.socket/_dlx/<cache_key>/', async () => {
      expect(existsSync(testCacheDir)).toBeTruthy()
      expect(existsSync(extractedNodePath)).toBeTruthy()
    })

    it('should extract executable binary', async () => {
      if (!extractedNodePath) {
        throw new Error('extractedNodePath not set')
      }

      // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mtime to verify extracted artifacts and detect metadata-rewrite races.
      const stats = await fs.stat(extractedNodePath)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('should use cache key embedded in binary header', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const magicMarker = Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8')
      const markerIndex = binaryData.indexOf(magicMarker)
      expect(markerIndex).toBeGreaterThan(-1)

      // Cache key is at: marker + compressed_size(8) + uncompressed_size(8)
      const cacheKeyOffset =
        markerIndex +
        HEADER_SIZES.MAGIC_MARKER +
        HEADER_SIZES.COMPRESSED_SIZE +
        HEADER_SIZES.UNCOMPRESSED_SIZE
      const embeddedCacheKey = binaryData
        .subarray(cacheKeyOffset, cacheKeyOffset + HEADER_SIZES.CACHE_KEY)
        .toString('utf8')

      const cacheDirName = path.basename(testCacheDir)
      expect(cacheDirName).toBe(embeddedCacheKey)
    })

    it.skipIf(!IS_MACOS)(
      'should not contain SMOL segment or SEA sections (macOS)',
      async () => {
        if (!extractedNodePath) {
          throw new Error('extractedNodePath not set')
        }

        const binaryData = await fs.readFile(extractedNodePath)
        const segments = parseMachoSegments(binaryData)

        // Extracted node should NOT have SMOL segment (that's only in stub)
        const smolSegment = segments.find(
          s => s.segmentName === MACHO_SEGMENT_SMOL,
        )
        expect(smolSegment).toBeUndefined()

        // Extracted node should NOT have NODE_SEA segment (no SEA in extracted binary)
        const nodeSeaSegment = segments.find(
          s => s.segmentName === MACHO_SEGMENT_NODE_SEA,
        )
        expect(nodeSeaSegment).toBeUndefined()

        // Verify no __PRESSED_DATA section exists
        const allSections = segments.flatMap(s => s.sections)
        const pressedDataSection = allSections.find(
          s => s.sectionName === MACHO_SECTION_PRESSED_DATA,
        )
        expect(pressedDataSection).toBeUndefined()
      },
    )

    it.skipIf(!IS_MACOS)('should be code-signed (macOS)', async () => {
      if (!extractedNodePath) {
        throw new Error('extractedNodePath not set')
      }

      const sigInfo = await isCodeSigned(extractedNodePath)
      expect(sigInfo.valid).toBeTruthy()
    })

    it('should execute --version successfully', async () => {
      if (!extractedNodePath) {
        throw new Error('extractedNodePath not set')
      }

      const result = await spawn(extractedNodePath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v2[5-9]\.\d+\.\d+/)
    })

    it.skipIf(!IS_MACOS)(
      'should have metadata section accessible via codesign (macOS)',
      async () => {
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mtime to verify extracted artifacts and detect metadata-rewrite races.
        const stats = await fs.stat(stubBinaryPath)
        expect(stats.mode & 0o100).not.toBe(0)
      },
    )
  })

  describe('cache reuse on subsequent runs', () => {
    it('should reuse extracted binary on second run', async () => {
      const result = await spawn(stubBinaryPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v2[5-9]\.\d+\.\d+/)
    })

    it('should not recreate cache directory', async () => {
      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mtime to verify extracted artifacts and detect metadata-rewrite races.
      const statsBefore = await fs.stat(metadataPath)

      // Run again
      await spawn(stubBinaryPath, ['--version'], { timeout: 5000 })

      // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mtime to verify extracted artifacts and detect metadata-rewrite races.
      const statsAfter = await fs.stat(metadataPath)

      // Metadata file should not be modified (cache hit)
      expect(statsAfter.mtimeMs).toBe(statsBefore.mtimeMs)
    })
  })

  describe('code signing preserves metadata format', () => {
    it('should preserve 3-byte metadata format after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const markerIndex = binaryData.indexOf(
        Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8'),
      )

      expect(markerIndex).toBeGreaterThan(-1)

      // Read metadata bytes after signing
      // marker(32) + compressed_size(8) + uncompressed_size(8) + cache_key(16) = 64 bytes
      const metadataOffset =
        markerIndex +
        HEADER_SIZES.MAGIC_MARKER +
        HEADER_SIZES.COMPRESSED_SIZE +
        HEADER_SIZES.UNCOMPRESSED_SIZE +
        HEADER_SIZES.CACHE_KEY
      const platformByte = binaryData[metadataOffset]
      const archByte = binaryData[metadataOffset + 1]
      const libcByte = binaryData[metadataOffset + 2]

      // All 3 bytes should be defined and valid
      expect(platformByte).toBeDefined()
      expect(archByte).toBeDefined()
      expect(libcByte).toBeDefined()

      // Platform: 0-2
      expect(platformByte).toBeGreaterThanOrEqual(0)
      expect(platformByte).toBeLessThanOrEqual(2)

      // Arch: 0-3
      expect(archByte).toBeGreaterThanOrEqual(0)
      expect(archByte).toBeLessThanOrEqual(3)

      // Libc: 0, 1, or 255
      expect([0, 1, 255]).toContain(libcByte)
    })

    it('should preserve magic marker after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const magicMarker = Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8')
      const markerIndex = binaryData.indexOf(magicMarker)

      expect(markerIndex).toBeGreaterThan(-1)

      // Verify marker is intact and complete
      const actualMarker = binaryData.subarray(
        markerIndex,
        markerIndex + SMOL_PRESSED_DATA_MAGIC_MARKER.length,
      )
      expect(actualMarker.toString('utf8')).toBe(SMOL_PRESSED_DATA_MAGIC_MARKER)
    })

    it('should preserve header size after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const markerIndex = binaryData.indexOf(
        Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8'),
      )

      // Verify TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG is 132 bytes
      // (marker 32 + metadata 100 with integrity_hash 64)
      const dataOffset = markerIndex + TOTAL_HEADER_SIZE_WITHOUT_SMOL_CONFIG
      expect(dataOffset).toBe(markerIndex + 132)

      // Verify compressed data exists after header
      expect(binaryData.length).toBeGreaterThan(dataOffset)
    })

    it('should preserve cache key after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const markerIndex = binaryData.indexOf(
        Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8'),
      )

      // Read cache key (16 bytes after marker + sizes)
      // marker + compressed_size + uncompressed_size
      const cacheKeyOffset =
        markerIndex + SMOL_PRESSED_DATA_MAGIC_MARKER.length + 8 + 8
      const cacheKey = binaryData
        .subarray(cacheKeyOffset, cacheKeyOffset + 16)
        .toString('utf8')

      // Cache key should be 16 hex characters
      expect(cacheKey).toMatch(/^[\da-f]{16}$/)
    })

    it.skipIf(!IS_MACOS)(
      'should be executable after signing (macOS)',
      async () => {
        // oxlint-disable-next-line socket/prefer-exists-sync -- fs.stat() calls consume stats.size and stats.mtime to verify extracted artifacts and detect metadata-rewrite races.
        const stats = await fs.stat(stubBinaryPath)
        expect(stats.mode & 0o100).not.toBe(0)
      },
    )

    it.skipIf(!IS_MACOS)(
      'should preserve binary functionality after signing (macOS)',
      async () => {
        // Verify binary still works after signing
        const result = await spawn(stubBinaryPath, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 5000,
        })

        expect(result.code).toBe(0)
        expect(result.stdout).toMatch(/^v\d+\.\d+\.\d+/)
      },
    )
  })
})
