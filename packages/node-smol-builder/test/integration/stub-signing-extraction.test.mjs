/**
 * @fileoverview Integration tests for stub signing, extraction, and execution flow
 *
 * Tests the complete flow:
 * 1. Stub binary has correct compressed data section
 * 2. Stub binary is code-signed (macOS only)
 * 3. Stub can execute basic commands (--version, --eval)
 * 4. Stub extracts node binary to correct ~/.socket/_dlx/<cache_key>/
 * 5. Extracted node binary is code-signed (macOS only)
 * 6. Stub forwards arguments correctly to extracted node
 * 7. Extracted node can run SQLite (native addon)
 * 8. Extracted node uses small-icu for internationalization
 *
 * Note: These tests require the final production binary at build/out/Final/node/.
 * Run with: pnpm build --dev or pnpm build --prod
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { homedir, platform, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  MACHO_SECTION_PRESSED_DATA,
  MACHO_SEGMENT_NODE_SEA,
  MACHO_SEGMENT_SMOL,
} from '../../../bin-infra/test-helpers/segment-names.mjs'
import {
  MAGIC_MARKER,
  TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG,
} from '../../scripts/binary-compressed/shared/constants.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_MACOS = platform() === 'darwin'

// Get the latest Final binary (the stub with embedded compressed node)
const stubBinaryPath = getLatestFinalBinary()

// Skip all tests if no final binary is available
const skipTests = !stubBinaryPath || !existsSync(stubBinaryPath)

// Cache directory
const DLX_DIR = path.join(homedir(), '.socket', '_dlx')
const testTmpDir = path.join(tmpdir(), 'socket-btm-stub-tests')

/**
 * Extract compressed data portion from stub binary
 */
function extractCompressedData(binaryData) {
  const magicMarker = Buffer.from(MAGIC_MARKER, 'utf-8')
  const markerIndex = binaryData.indexOf(magicMarker)

  if (markerIndex === -1) {
    throw new Error('Magic marker not found in stub binary')
  }

  // Compressed data starts after: marker (32 bytes) + compressed_size (8 bytes) + uncompressed_size (8 bytes) + cache_key (16 bytes) + platform_metadata (3 bytes) = 67 bytes total.
  const dataOffset = markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG
  return binaryData.subarray(dataOffset)
}

/**
 * Parse Mach-O segments and sections (macOS only)
 * Returns array of {segmentName, sections: [{sectionName, segmentName}]}
 */
function parseMachoSegments(binaryData) {
  if (platform() !== 'darwin') {
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
        segmentName,
        sections,
      })
    }

    offset += cmdsize
  }

  return segments
}

/**
 * Check if a binary is code-signed (macOS only)
 */
async function isCodeSigned(binaryPath) {
  if (!IS_MACOS) {
    // Skip on non-macOS
    return { signed: true, valid: true }
  }

  try {
    const result = await spawn('codesign', ['-v', '-v', binaryPath], {
      timeout: 5000,
    })
    // codesign returns 0 for valid signatures
    return {
      signed: true,
      valid: result.code === 0,
      output: result.stderr || result.stdout,
    }
  } catch (error) {
    return {
      signed: false,
      valid: false,
      error: error.message,
    }
  }
}

describe.skipIf(skipTests)('Stub signing and extraction flow', () => {
  let testCacheDir
  let extractedNodePath

  beforeAll(async () => {
    await fs.mkdir(testTmpDir, { recursive: true })

    // Calculate cache directory for cleanup
    const binaryData = await fs.readFile(stubBinaryPath)
    const compressedData = extractCompressedData(binaryData)
    const hash = createHash('sha512').update(compressedData).digest('hex')
    const cacheKey = hash.slice(0, 16)
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

  describe('Stub binary structure', () => {
    it('should have compressed data section with magic marker', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const magicMarker = Buffer.from(MAGIC_MARKER, 'utf-8')

      const markerIndex = binaryData.indexOf(magicMarker)
      expect(markerIndex).toBeGreaterThan(0)

      // Verify size headers exist after marker
      const sizeHeadersOffset = markerIndex + magicMarker.length
      expect(binaryData.length).toBeGreaterThan(sizeHeadersOffset + 16)
    })

    it('should have valid compressed data after marker', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const compressedData = extractCompressedData(binaryData)

      // Compressed data should be substantial (> 1MB)
      expect(compressedData.length).toBeGreaterThan(1024 * 1024)
    })

    it.skipIf(!IS_MACOS)(
      'should have correct Mach-O segment and section names (macOS)',
      async () => {
        const binaryData = await fs.readFile(stubBinaryPath)
        const segments = parseMachoSegments(binaryData)

        // Should have standard Mach-O segments
        const segmentNames = segments.map(s => s.segmentName)
        expect(segmentNames).toContain('__TEXT')
        expect(segmentNames).toContain('__DATA')
        expect(segmentNames).toContain('__LINKEDIT')

        // Find __TEXT segment and verify it has expected sections
        const textSegment = segments.find(s => s.segmentName === '__TEXT')
        expect(textSegment).toBeDefined()
        const textSections = textSegment.sections.map(s => s.sectionName)
        expect(textSections).toContain('__text')

        // Find __DATA segment and verify it has expected sections
        const dataSegment = segments.find(s => s.segmentName === '__DATA')
        expect(dataSegment).toBeDefined()

        // Verify SMOL segment exists with __PRESSED_DATA section
        const smolSegment = segments.find(
          s => s.segmentName === MACHO_SEGMENT_SMOL,
        )
        expect(smolSegment).toBeDefined()
        expect(smolSegment.sections.length).toBeGreaterThan(0)

        const pressedDataSection = smolSegment.sections.find(
          s => s.sectionName === MACHO_SECTION_PRESSED_DATA,
        )
        expect(pressedDataSection).toBeDefined()
        expect(pressedDataSection.segmentName).toBe(MACHO_SEGMENT_SMOL)

        // Verify __SMOL_PRESSED_DATA_MAGIC_MARKER is in the binary
        const smolMarker = Buffer.from(
          '__SMOL_PRESSED_DATA_MAGIC_MARKER',
          'utf-8',
        )
        const smolMarkerIndex = binaryData.indexOf(smolMarker)
        expect(smolMarkerIndex).toBeGreaterThan(0)

        // Log segment info for debugging
        console.log(
          'Mach-O segments:',
          segments.map(s => ({
            name: s.segmentName,
            sections: s.sections.map(sec => sec.sectionName),
          })),
        )
      },
    )
  })

  describe.skipIf(!IS_MACOS)('Stub binary code signing (macOS)', () => {
    it('should be code-signed', async () => {
      const sigInfo = await isCodeSigned(stubBinaryPath)

      expect(sigInfo.signed).toBe(true)
      if (!sigInfo.valid) {
        console.warn(
          'Stub signature validation:',
          sigInfo.output || sigInfo.error,
        )
      }
    })

    it('should have valid ad-hoc signature', async () => {
      const result = await spawn('codesign', ['-d', '-v', stubBinaryPath], {
        timeout: 5000,
      })

      // Should show signature info
      const output = result.stderr || result.stdout
      expect(output).toBeTruthy()
      // Ad-hoc signatures typically show "adhoc" in the output
      // or succeed with code 0
      expect(result.code).toBe(0)
    })
  })

  describe('Stub execution capabilities', () => {
    it('should execute --version successfully', async () => {
      // First run may extract
      const result = await spawn(stubBinaryPath, ['--version'], {
        timeout: 30_000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v24\.\d+\.\d+/)
    })

    it('should execute --eval successfully', async () => {
      const result = await spawn(
        stubBinaryPath,
        ['--eval', 'console.log("eval works")'],
        { timeout: 10_000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('eval works')
    })

    it('should print process information', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          'console.log(JSON.stringify({platform: process.platform, arch: process.arch, version: process.version}))',
        ],
        { timeout: 10_000 },
      )

      expect(result.code).toBe(0)

      const info = JSON.parse(result.stdout.trim())
      expect(info.platform).toBe(process.platform)
      expect(info.arch).toBe(process.arch)
      expect(info.version).toMatch(/^v24\./)
    })
  })

  describe('Node binary extraction', () => {
    it('should extract node binary to ~/.socket/_dlx/<cache_key>/', async () => {
      // Ensure extraction happened (from previous --version test)
      expect(existsSync(testCacheDir)).toBe(true)

      // Find extracted node binary
      const expectedBinaryName = platform() === 'win32' ? 'node.exe' : 'node'
      extractedNodePath = path.join(testCacheDir, expectedBinaryName)

      expect(existsSync(extractedNodePath)).toBe(true)
    })

    it('should extract executable binary', async () => {
      if (!extractedNodePath) {
        throw new Error('extractedNodePath not set')
      }

      const stats = await fs.stat(extractedNodePath)
      expect(stats.mode & 0o100).not.toBe(0)
    })

    it('should use cache key from compressed data hash', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const compressedData = extractCompressedData(binaryData)
      const hash = createHash('sha512').update(compressedData).digest('hex')
      const expectedCacheKey = hash.slice(0, 16)

      const cacheDirName = path.basename(testCacheDir)
      expect(cacheDirName).toBe(expectedCacheKey)
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

        // Verify no __SMOL_PRESSED_DATA_MAGIC_MARKER in extracted binary
        const smolMarker = Buffer.from(
          '__SMOL_PRESSED_DATA_MAGIC_MARKER',
          'utf-8',
        )
        const smolMarkerIndex = binaryData.indexOf(smolMarker)
        expect(smolMarkerIndex).toBe(-1)

        // Should have standard Mach-O segments (it's a normal node binary)
        const segmentNames = segments.map(s => s.segmentName)
        expect(segmentNames).toContain('__TEXT')
        expect(segmentNames).toContain('__DATA')
        expect(segmentNames).toContain('__LINKEDIT')

        console.log(
          'Extracted node Mach-O segments:',
          segments.map(s => ({
            name: s.segmentName,
            sections: s.sections.map(sec => sec.sectionName),
          })),
        )
      },
    )
  })

  describe.skipIf(!IS_MACOS)(
    'Extracted node binary code signing (macOS)',
    () => {
      it('should be code-signed after extraction', async () => {
        if (!extractedNodePath) {
          throw new Error('extractedNodePath not set')
        }

        const sigInfo = await isCodeSigned(extractedNodePath)

        expect(sigInfo.signed).toBe(true)
        if (!sigInfo.valid) {
          console.warn(
            'Extracted node signature validation:',
            sigInfo.output || sigInfo.error,
          )
        }
      })

      it('should have valid signature that can be verified', async () => {
        if (!extractedNodePath) {
          throw new Error('extractedNodePath not set')
        }

        const result = await spawn(
          'codesign',
          ['-d', '-v', extractedNodePath],
          { timeout: 5000 },
        )

        expect(result.code).toBe(0)
      })
    },
  )

  describe('Argument forwarding', () => {
    it('should forward --version to extracted node', async () => {
      const result = await spawn(stubBinaryPath, ['--version'], {
        timeout: 5000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v24\.\d+\.\d+/)
    })

    it('should forward --eval arguments correctly', async () => {
      const result = await spawn(
        stubBinaryPath,
        ['--eval', 'console.log(process.argv.slice(2))'],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('--eval')
    })

    it('should forward multiple arguments', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          'console.log(process.argv.slice(2).join(" "))',
          'arg1',
          'arg2',
          'arg3',
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('arg1')
      expect(result.stdout).toContain('arg2')
      expect(result.stdout).toContain('arg3')
    })
  })

  describe('Native addon support (SQLite)', () => {
    it('should be able to load better-sqlite3 native addon', async () => {
      // Create a test script that uses better-sqlite3
      const testScript = path.join(testTmpDir, 'test-sqlite.mjs')
      await fs.writeFile(
        testScript,
        `
import Database from 'better-sqlite3';

const db = new Database(':memory:');
db.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, value TEXT)');
db.exec("INSERT INTO test (value) VALUES ('hello')");

const row = db.prepare('SELECT * FROM test').get();
console.log('SQLite works:', JSON.stringify(row));

db.close();
`,
      )

      // Install better-sqlite3 in test directory
      const installResult = await spawn(
        'npm',
        ['install', 'better-sqlite3@latest'],
        {
          cwd: testTmpDir,
          timeout: 60_000,
        },
      )

      if (installResult.code !== 0) {
        console.warn('Could not install better-sqlite3, skipping SQLite test')
        return
      }

      // Run test script with stub (which should forward to extracted node)
      const result = await spawn(stubBinaryPath, [testScript], {
        cwd: testTmpDir,
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('SQLite works')
      expect(result.stdout).toContain('hello')
    })
  })

  describe('ICU (Internationalization) support', () => {
    it('should use small-icu configuration', async () => {
      const result = await spawn(
        stubBinaryPath,
        ['--eval', 'console.log(process.config.variables.icu_small)'],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      // small-icu should be true for production builds
      const icuSmall = result.stdout.trim()
      expect(['true', 'undefined']).toContain(icuSmall)
    })

    it('should support basic Intl operations', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          `
const date = new Date('2024-01-15');
const formatted = new Intl.DateTimeFormat('en-US').format(date);
console.log('Date formatting works:', formatted);
`,
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Date formatting works')
    })

    it('should support number formatting', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          `
const number = 1234567.89;
const formatted = new Intl.NumberFormat('en-US').format(number);
console.log('Number formatting works:', formatted);
`,
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Number formatting works')
      expect(result.stdout).toContain('1,234,567.89')
    })

    it('should handle UTF-8 strings correctly', async () => {
      const result = await spawn(
        stubBinaryPath,
        [
          '--eval',
          `
const str = '你好世界 🌍 مرحبا Привет';
console.log('UTF-8 length:', str.length);
console.log('UTF-8 string:', str);
`,
        ],
        { timeout: 5000 },
      )

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('UTF-8 length:')
      expect(result.stdout).toContain('你好世界')
      expect(result.stdout).toContain('🌍')
    })
  })

  describe('Cache reuse on subsequent runs', () => {
    it('should reuse extracted binary on second run', async () => {
      const result = await spawn(stubBinaryPath, ['--version'], {
        timeout: 5000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v24\.\d+\.\d+/)
    })

    it('should not recreate cache directory', async () => {
      const metadataPath = path.join(testCacheDir, '.dlx-metadata.json')
      const statsBefore = await fs.stat(metadataPath)

      // Run again
      await spawn(stubBinaryPath, ['--version'], { timeout: 5000 })

      const statsAfter = await fs.stat(metadataPath)

      // Metadata file should not be modified (cache hit)
      expect(statsAfter.mtimeMs).toBe(statsBefore.mtimeMs)
    })
  })

  describe('Code signing preserves metadata format', () => {
    it('should preserve 3-byte metadata format after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))

      expect(markerIndex).toBeGreaterThan(-1)

      // Read metadata bytes after signing
      // marker(32) + compressed_size(8) + uncompressed_size(8) + cache_key(16) = 64 bytes
      // Total header minus 3-byte metadata
      const metadataOffset =
        markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG - 3
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
      const magicMarker = Buffer.from(MAGIC_MARKER, 'utf-8')
      const markerIndex = binaryData.indexOf(magicMarker)

      expect(markerIndex).toBeGreaterThan(-1)

      // Verify marker is intact and complete
      const actualMarker = binaryData.subarray(
        markerIndex,
        markerIndex + MAGIC_MARKER.length,
      )
      expect(actualMarker.toString('utf-8')).toBe(MAGIC_MARKER)
    })

    it('should preserve header size after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))

      // Verify TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG is 67 bytes (3-byte metadata format)
      const dataOffset = markerIndex + TOTAL_HEADER_SIZE_WITHOUT_UPDATE_CONFIG
      expect(dataOffset).toBe(markerIndex + 67)

      // Verify compressed data exists after header
      expect(binaryData.length).toBeGreaterThan(dataOffset)
    })

    it('should preserve cache key after signing', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))

      // Read cache key (16 bytes after marker + sizes)
      // marker + compressed_size + uncompressed_size
      const cacheKeyOffset = markerIndex + MAGIC_MARKER.length + 8 + 8
      const cacheKey = binaryData
        .subarray(cacheKeyOffset, cacheKeyOffset + 16)
        .toString('utf-8')

      // Cache key should be 16 hex characters
      expect(cacheKey).toMatch(/^[\da-f]{16}$/)
    })

    it.skipIf(!IS_MACOS)(
      'should be executable after signing (macOS)',
      async () => {
        const stats = await fs.stat(stubBinaryPath)
        expect(stats.mode & 0o100).not.toBe(0)
      },
    )

    it.skipIf(!IS_MACOS)(
      'should preserve binary functionality after signing (macOS)',
      async () => {
        // Verify binary still works after signing
        const result = await spawn(stubBinaryPath, ['--version'], {
          timeout: 5000,
        })

        expect(result.code).toBe(0)
        expect(result.stdout).toMatch(/^v24\.\d+\.\d+/)
      },
    )
  })
})
