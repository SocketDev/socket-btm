/**
 * @fileoverview Segment and section validation tests for binpress
 *
 * Validates that compressed binaries have correct segment/section structure:
 * - SMOL segment creation on macOS (Mach-O)
 * - Correct section alignment and offsets
 * - Valid segment headers
 * - Compression metadata in segments
 * - Section size validation
 *
 * These tests ensure binpress creates valid Mach-O/ELF/PE structures
 * that loaders can correctly parse and execute.
 */

import { spawn } from 'node:child_process'
import {
  MACHO_SECTION_PRESSED_DATA,
  MACHO_SEGMENT_SMOL,
} from '../../bin-infra/test-helpers/segment-names.mjs'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')

const BUILD_MODE = getBuildMode()
const BINPRESS_NAME = process.platform === 'win32' ? 'binpress.exe' : 'binpress'
const BINPRESS = path.join(
  PACKAGE_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  BINPRESS_NAME,
)

let testDir

async function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

/**
 * Parse Mach-O segments from binary data
 */
function parseMachoSegments(binaryData) {
  const segments = []

  // Mach-O magic numbers
  const MH_MAGIC_64 = 0xfe_ed_fa_cf
  const MH_CIGAM_64 = 0xcf_fa_ed_fe

  const magic = binaryData.readUInt32LE(0)
  const isLittleEndian = magic === MH_MAGIC_64

  if (!isLittleEndian && magic !== MH_CIGAM_64) {
    // Not Mach-O
    return null
  }

  const ncmds = isLittleEndian
    ? binaryData.readUInt32LE(16)
    : binaryData.readUInt32BE(16)

  // sizeof(mach_header_64)
  let offset = 32

  for (let i = 0; i < ncmds; i++) {
    const cmd = isLittleEndian
      ? binaryData.readUInt32LE(offset)
      : binaryData.readUInt32BE(offset)
    const cmdsize = isLittleEndian
      ? binaryData.readUInt32LE(offset + 4)
      : binaryData.readUInt32BE(offset + 4)

    // LC_SEGMENT_64 = 0x19
    if (cmd === 0x19) {
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

        sections.push({ sectionName })
        // sizeof(section_64)
        sectionOffset += 80
      }

      segments.push({ segmentName, sections })
    }

    offset += cmdsize
  }

  return segments
}

beforeAll(async () => {
  testDir = path.join(os.tmpdir(), `binpress-segments-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!existsSync(BINPRESS))('Segment and section validation', () => {
  describe('Mach-O segment structure (macOS)', () => {
    it.skipIf(process.platform !== 'darwin')(
      'should create SMOL segment in compressed binary',
      async () => {
        const inputBinary = path.join(testDir, 'segment_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'segment_compressed')

        // Compress
        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        const data = await fs.readFile(finalPath)
        const segments = parseMachoSegments(data)

        expect(segments).not.toBeNull()

        // Should have SMOL segment
        const smolSegment = segments.find(
          s => s.segmentName === MACHO_SEGMENT_SMOL,
        )
        expect(smolSegment).toBeDefined()
      },
      60_000,
    )

    it.skipIf(process.platform !== 'darwin')(
      'should have __PRESSED_DATA section in SMOL segment',
      async () => {
        const inputBinary = path.join(testDir, 'section_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'section_compressed')

        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        const data = await fs.readFile(finalPath)
        const segments = parseMachoSegments(data)

        const smolSegment = segments.find(
          s => s.segmentName === MACHO_SEGMENT_SMOL,
        )
        expect(smolSegment).toBeDefined()
        expect(smolSegment.sections.length).toBeGreaterThan(0)

        const pressedDataSection = smolSegment.sections.find(
          s => s.sectionName === MACHO_SECTION_PRESSED_DATA,
        )
        expect(pressedDataSection).toBeDefined()
      },
      60_000,
    )

    it.skipIf(process.platform !== 'darwin')(
      'should preserve standard Mach-O segments',
      async () => {
        const inputBinary = path.join(testDir, 'standard_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'standard_compressed')

        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        const data = await fs.readFile(finalPath)
        const segments = parseMachoSegments(data)

        const segmentNames = segments.map(s => s.segmentName)

        // Should have standard segments from stub template
        expect(segmentNames).toContain('__TEXT')
        expect(segmentNames).toContain('__LINKEDIT')

        // Plus our SMOL segment
        expect(segmentNames).toContain(MACHO_SEGMENT_SMOL)

        // Should NOT have __DATA if stub template doesn't have it
        // (stub template is minimal and may only have __DATA_CONST)
      },
      60_000,
    )
  })

  describe('Magic marker validation', () => {
    it('should embed magic marker in compressed binary', async () => {
      const inputBinary = path.join(testDir, 'marker_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'marker_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const data = await fs.readFile(finalPath)

      // Check for magic marker
      const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
      const markerIndex = data.indexOf(marker)

      expect(markerIndex).toBeGreaterThan(-1)
    }, 60_000)

    it('should place magic marker at correct offset', async () => {
      const inputBinary = path.join(testDir, 'offset_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'offset_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const data = await fs.readFile(finalPath)
      const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
      const markerIndex = data.indexOf(marker)

      // Marker should be after stub code
      expect(markerIndex).toBeGreaterThan(1024)
    }, 60_000)

    it('should have exactly 32-byte magic marker', async () => {
      const inputBinary = path.join(testDir, 'marker_size_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'marker_size_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const data = await fs.readFile(finalPath)
      const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')

      expect(marker.length).toBe(32)

      const markerIndex = data.indexOf(marker)
      const foundMarker = data.subarray(markerIndex, markerIndex + 32)

      expect(foundMarker.toString('utf-8')).toBe(
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
    }, 60_000)
  })

  describe('Metadata header validation', () => {
    it('should have correct metadata header size (35 bytes)', async () => {
      const inputBinary = path.join(testDir, 'header_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'header_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const data = await fs.readFile(finalPath)
      const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
      const markerIndex = data.indexOf(marker)

      // After marker: compressed_size(8) + uncompressed_size(8) + cache_key(16) + platform_metadata(3) = 35 bytes
      const metadataStart = markerIndex + 32
      const compressedSize = data.readBigUInt64LE(metadataStart)
      const uncompressedSize = data.readBigUInt64LE(metadataStart + 8)
      const cacheKey = data
        .subarray(metadataStart + 16, metadataStart + 32)
        .toString('utf-8')

      // Validate sizes are reasonable
      expect(Number(compressedSize)).toBeGreaterThan(0)
      expect(Number(uncompressedSize)).toBeGreaterThan(0)
      expect(Number(uncompressedSize)).toBeGreaterThan(Number(compressedSize))

      // Validate cache key format (16 hex chars)
      expect(cacheKey).toMatch(/^[\da-f]{16}$/)
    }, 60_000)

    it('should have 3-byte platform metadata', async () => {
      const inputBinary = path.join(testDir, 'platform_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'platform_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const data = await fs.readFile(finalPath)
      const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
      const markerIndex = data.indexOf(marker)

      // Platform metadata at: marker(32) + sizes(16) + cache_key(16) = offset 64
      const metadataOffset = markerIndex + 64
      const platformByte = data[metadataOffset]
      const archByte = data[metadataOffset + 1]
      const libcByte = data[metadataOffset + 2]

      // All 3 bytes should be valid
      expect([0, 1, 2]).toContain(platformByte)
      expect([0, 1, 2, 3]).toContain(archByte)
      expect([0, 1, 255]).toContain(libcByte)
    }, 60_000)

    it('should start compressed data immediately after 67-byte header', async () => {
      const inputBinary = path.join(testDir, 'data_offset_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'data_offset_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const data = await fs.readFile(finalPath)
      const marker = Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8')
      const markerIndex = data.indexOf(marker)

      // Total header: marker(32) + metadata(35) = 67 bytes
      const dataOffset = markerIndex + 67

      // Verify data exists at this offset
      expect(data.length).toBeGreaterThan(dataOffset)

      // Read a few bytes to verify it's not all zeros
      const dataChunk = data.subarray(dataOffset, dataOffset + 100)
      const allZeros = dataChunk.every(b => b === 0)
      expect(allZeros).toBe(false)
    }, 60_000)
  })

  describe('Binary format validation', () => {
    it('should maintain valid binary format after compression', async () => {
      const inputBinary = path.join(testDir, 'format_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'format_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      // Use file command to verify format
      const fileResult = await execCommand('file', [finalPath])

      if (fileResult.code === 0) {
        const output = fileResult.stdout.toLowerCase()
        expect(output).toContain('executable')

        if (process.platform === 'darwin') {
          expect(output).toContain('mach-o')
        } else if (process.platform === 'linux') {
          expect(output).toContain('elf')
        } else if (process.platform === 'win32') {
          expect(output).toContain('pe')
        }
      }
    }, 60_000)

    it('should produce executable binary', async () => {
      const inputBinary = path.join(testDir, 'exec_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const compressedBinary = path.join(testDir, 'exec_compressed')

      await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

      // On Windows, binpress adds .exe extension automatically
      const finalPath =
        process.platform === 'win32'
          ? `${compressedBinary}.exe`
          : compressedBinary

      const stats = await fs.stat(finalPath)

      // Windows doesn't use Unix-style executable bits, so skip this check on Windows
      if (process.platform !== 'win32') {
        const isExecutable = (stats.mode & 0o111) !== 0
        expect(isExecutable).toBe(true)
      }

      // Should actually execute
      await fs.chmod(finalPath, 0o755)
      const execResult = await execCommand(finalPath, ['--version'])
      expect(execResult.code).toBe(0)
    }, 60_000)
  })

  describe('Segment alignment', () => {
    it.skipIf(process.platform !== 'darwin')(
      'should maintain proper segment alignment on macOS',
      async () => {
        const inputBinary = path.join(testDir, 'align_input')
        await fs.copyFile(BINPRESS, inputBinary)

        const compressedBinary = path.join(testDir, 'align_compressed')

        await execCommand(BINPRESS, [inputBinary, '--output', compressedBinary])

        // On Windows, binpress adds .exe extension automatically
        const finalPath =
          process.platform === 'win32'
            ? `${compressedBinary}.exe`
            : compressedBinary

        // Binary should be valid and executable (loader checks alignment)
        await fs.chmod(finalPath, 0o755)
        const execResult = await execCommand(finalPath, ['--version'])

        expect(execResult.code).toBe(0)
      },
      60_000,
    )
  })
})
