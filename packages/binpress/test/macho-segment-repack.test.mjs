/**
 * @fileoverview Mach-O SMOL segment repacking validation tests
 *
 * Tests Mach-O-specific SMOL segment replacement logic in smol_repack_lief().
 * These tests validate that:
 * 1. SMOL segments are REPLACED (not appended) during repack
 * 2. SMOL segment structure remains valid after repacking
 * 3. Mach-O binary structure remains valid after repacking
 * 4. Edge cases are handled gracefully
 *
 * IMPORTANT: These tests only run on macOS platforms where Mach-O is native.
 * They explicitly validate the SMOL segment handling that mirrors the PT_NOTE
 * handling for ELF binaries.
 */

import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import {
  MACHO_MAGIC,
  MACHO_LOAD_COMMAND,
  MACHO_HEADER_OFFSET,
  MACHO_HEADER_SIZE,
  MACHO_LC_SEGMENT_64_OFFSET,
  MACHO_LC_SEGMENT_OFFSET,
} from '../../bin-infra/test/helpers/binary-format-constants.mjs'
import {
  execCommand,
  codeSignBinary,
} from '../../bin-infra/test/helpers/test-utils.mjs'

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

/**
 * Parse Mach-O header and return basic information
 * @param {Buffer} machoData - Mach-O binary data
 * @returns {Object} Mach-O header information
 *
 * Note: We only support little-endian binaries.
 */
function parseMachoHeader(machoData) {
  const magic = machoData.readUInt32LE(0)

  const is64bit = magic === MACHO_MAGIC.MH_MAGIC_64

  if (magic !== MACHO_MAGIC.MH_MAGIC_64 && magic !== MACHO_MAGIC.MH_MAGIC) {
    throw new Error(`Invalid Mach-O magic: 0x${magic.toString(16)}`)
  }

  const ncmds = machoData.readUInt32LE(MACHO_HEADER_OFFSET.NCMDS)
  const sizeofcmds = machoData.readUInt32LE(MACHO_HEADER_OFFSET.SIZEOFCMDS)
  const headerSize = is64bit
    ? MACHO_HEADER_SIZE.HEADER_64
    : MACHO_HEADER_SIZE.HEADER_32

  return {
    is64bit,
    ncmds,
    sizeofcmds,
    headerSize,
  }
}

/**
 * Count SMOL segments in Mach-O binary
 * @param {Buffer} machoData - Mach-O binary data
 * @returns {number} Number of SMOL segments
 */
function countSmolSegments(machoData) {
  const header = parseMachoHeader(machoData)
  const { headerSize, is64bit, ncmds } = header

  let offset = headerSize
  let smolCount = 0

  for (let i = 0; i < ncmds; i++) {
    const cmd = machoData.readUInt32LE(offset)
    const cmdsize = machoData.readUInt32LE(offset + 4)

    const isSegmentCommand = is64bit
      ? cmd === MACHO_LOAD_COMMAND.LC_SEGMENT_64
      : cmd === MACHO_LOAD_COMMAND.LC_SEGMENT

    if (isSegmentCommand) {
      const segmentNameOffset = is64bit
        ? MACHO_LC_SEGMENT_64_OFFSET.SEGNAME
        : MACHO_LC_SEGMENT_OFFSET.SEGNAME

      const segmentName = machoData
        .subarray(offset + segmentNameOffset, offset + segmentNameOffset + 16)
        .toString('utf8')
        .replace(/\0.*$/, '')

      if (segmentName === 'SMOL') {
        smolCount++
      }
    }

    offset += cmdsize
  }

  return smolCount
}

/**
 * Find SMOL segments with their content
 * @param {Buffer} machoData - Mach-O binary data
 * @returns {Array} Array of SMOL segment info
 */
function findSmolSegments(machoData) {
  const header = parseMachoHeader(machoData)
  const { headerSize, is64bit, ncmds } = header

  let offset = headerSize
  const segments = []

  for (let i = 0; i < ncmds; i++) {
    const cmd = machoData.readUInt32LE(offset)
    const cmdsize = machoData.readUInt32LE(offset + 4)

    const isSegmentCommand = is64bit
      ? cmd === MACHO_LOAD_COMMAND.LC_SEGMENT_64
      : cmd === MACHO_LOAD_COMMAND.LC_SEGMENT

    if (isSegmentCommand) {
      const segmentNameOffset = is64bit
        ? MACHO_LC_SEGMENT_64_OFFSET.SEGNAME
        : MACHO_LC_SEGMENT_OFFSET.SEGNAME

      const segmentName = machoData
        .subarray(offset + segmentNameOffset, offset + segmentNameOffset + 16)
        .toString('utf8')
        .replace(/\0.*$/, '')

      if (segmentName === 'SMOL') {
        let fileoff
        let filesize

        if (is64bit) {
          // Use constants for correct offsets
          fileoff = Number(
            machoData.readBigUInt64LE(
              offset + MACHO_LC_SEGMENT_64_OFFSET.FILEOFF,
            ),
          )
          filesize = Number(
            machoData.readBigUInt64LE(
              offset + MACHO_LC_SEGMENT_64_OFFSET.FILESIZE,
            ),
          )
        } else {
          fileoff = machoData.readUInt32LE(
            offset + MACHO_LC_SEGMENT_OFFSET.FILEOFF,
          )
          filesize = machoData.readUInt32LE(
            offset + MACHO_LC_SEGMENT_OFFSET.FILESIZE,
          )
        }

        segments.push({
          offset: fileoff,
          size: filesize,
          content: machoData.subarray(fileoff, fileoff + filesize),
        })
      }
    }

    offset += cmdsize
  }

  return segments
}

/**
 * Search for magic marker in SMOL segments
 * @param {Buffer} machoData - Mach-O binary data
 * @param {string} marker - Marker string to search for
 * @returns {boolean} True if marker found
 */
function hasMarkerInSmolSegment(machoData, marker) {
  const segments = findSmolSegments(machoData)
  const markerBuffer = Buffer.from(marker, 'utf-8')

  for (const segment of segments) {
    if (segment.content.includes(markerBuffer)) {
      return true
    }
  }

  return false
}

// Only run on macOS where Mach-O is native
describe.skipIf(process.platform !== 'darwin' || !existsSync(BINPRESS))(
  'Mach-O SMOL Segment Repacking Validation',
  () => {
    let testDir

    beforeAll(async () => {
      // Create test directory
      testDir = path.join(
        PACKAGE_DIR,
        'build',
        BUILD_MODE,
        'test-tmp-macho-segment',
      )
      await safeMkdir(testDir)
    })

    afterAll(async () => {
      // Clean up test directory
      if (testDir) {
        await safeDelete(testDir)
      }
    })

    it('should replace SMOL segment (not append)', async () => {
      // Step 1: Create initial compressed stub (binpress compressing itself)
      const initialStub = path.join(testDir, 'initial-stub')
      const compressResult = await execCommand(BINPRESS, [
        BINPRESS,
        '-o',
        initialStub,
      ])

      expect(compressResult.code).toBe(0)
      expect(existsSync(initialStub)).toBe(true)

      // Parse Mach-O and count SMOL segments
      const initialMachoData = await fs.readFile(initialStub)
      const initialSmolCount = countSmolSegments(initialMachoData)

      // Should have exactly 1 SMOL segment with compressed data
      expect(initialSmolCount).toBe(1)

      // Verify marker is present
      const hasInitialMarker = hasMarkerInSmolSegment(
        initialMachoData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasInitialMarker).toBe(true)

      // Step 2: Update stub with new data (update with binpress again)
      const updatedStub = path.join(testDir, 'updated-stub')
      const updateResult = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      expect(updateResult.code).toBe(0)
      expect(existsSync(updatedStub)).toBe(true)

      // Parse updated Mach-O and verify SMOL is replaced, not appended
      const updatedMachoData = await fs.readFile(updatedStub)
      const updatedSmolCount = countSmolSegments(updatedMachoData)

      // CRITICAL: Should still have same number of SMOL segments
      // (replaced, not appended)
      expect(updatedSmolCount).toBe(initialSmolCount)
      expect(updatedSmolCount).toBe(1)

      // Verify marker is still present
      const hasUpdatedMarker = hasMarkerInSmolSegment(
        updatedMachoData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasUpdatedMarker).toBe(true)
    }, 60_000)

    it('should maintain Mach-O binary validity after repack', async () => {
      const initialStub = path.join(testDir, 'validity-stub')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const updatedStub = path.join(testDir, 'validity-updated')
      const updateResult = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      expect(updateResult.code).toBe(0)

      // Verify Mach-O magic bytes (little-endian)
      const machoData = await fs.readFile(updatedStub)

      const magic = machoData.readUInt32LE(0)
      const MH_MAGIC_64 = 0xfe_ed_fa_cf

      // Should be Mach-O 64-bit (little-endian - we only support little-endian)
      expect(magic).toBe(MH_MAGIC_64)

      // Verify binary is executable
      await fs.chmod(updatedStub, 0o755)
      await codeSignBinary(updatedStub)

      const execResult = await execCommand(updatedStub, ['--version'])

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('binpress')
    }, 60_000)

    it('should have valid SMOL segment structure after repack', async () => {
      const initialStub = path.join(testDir, 'structure-stub')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const updatedStub = path.join(testDir, 'structure-updated')
      await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      const machoData = await fs.readFile(updatedStub)

      // Parse and validate SMOL segment structure
      const segments = findSmolSegments(machoData)

      // Should have exactly one SMOL segment
      expect(segments.length).toBe(1)

      const smolSegment = segments[0]
      expect(smolSegment.size).toBeGreaterThan(0)

      // Verify marker is at a valid position
      const markerIndex = smolSegment.content.indexOf(
        Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8'),
      )
      expect(markerIndex).toBeGreaterThanOrEqual(0)
    }, 60_000)

    it('should handle multiple sequential updates', async () => {
      // Create initial stub
      const stub1 = path.join(testDir, 'multi-stub-1')
      await execCommand(BINPRESS, [BINPRESS, '-o', stub1])

      const machoData1 = await fs.readFile(stub1)
      const smolCount1 = countSmolSegments(machoData1)
      expect(smolCount1).toBe(1)

      // Update 1: Update with binpress
      const stub2 = path.join(testDir, 'multi-stub-2')
      const result2 = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        stub1,
        '-o',
        stub2,
      ])
      expect(result2.code).toBe(0)

      const machoData2 = await fs.readFile(stub2)
      const smolCount2 = countSmolSegments(machoData2)
      // Should not increase
      expect(smolCount2).toBe(smolCount1)
      expect(smolCount2).toBe(1)

      // Update 2: Update again with binpress
      const stub3 = path.join(testDir, 'multi-stub-3')
      const result3 = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        stub2,
        '-o',
        stub3,
      ])
      expect(result3.code).toBe(0)

      const machoData3 = await fs.readFile(stub3)
      const smolCount3 = countSmolSegments(machoData3)
      // Should still be the same
      expect(smolCount3).toBe(smolCount1)
      expect(smolCount3).toBe(1)

      // Verify final binary is executable
      await fs.chmod(stub3, 0o755)
      await codeSignBinary(stub3)

      const execResult = await execCommand(stub3, ['--version'])
      expect(execResult.code).toBe(0)
    }, 90_000)

    it('should preserve marker after repack', async () => {
      const initialStub = path.join(testDir, 'marker-stub')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const initialData = await fs.readFile(initialStub)
      const hasInitialMarker = hasMarkerInSmolSegment(
        initialData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasInitialMarker).toBe(true)

      // Update stub
      const updatedStub = path.join(testDir, 'marker-updated')
      await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      const updatedData = await fs.readFile(updatedStub)
      const hasUpdatedMarker = hasMarkerInSmolSegment(
        updatedData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasUpdatedMarker).toBe(true)
    }, 60_000)

    it('should create initial compressed binary', async () => {
      // Test initial compression (not update mode)
      const outputStub = path.join(testDir, 'new-compressed-stub')

      const result = await execCommand(BINPRESS, [BINPRESS, '-o', outputStub])

      // Should succeed
      expect(result.code).toBe(0)

      // Verify output has SMOL segment with marker
      const outputData = await fs.readFile(outputStub)
      const hasMarker = hasMarkerInSmolSegment(
        outputData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasMarker).toBe(true)
    }, 60_000)

    it('should maintain correct load command count', async () => {
      const initialStub = path.join(testDir, 'loadcmd-stub')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const initialData = await fs.readFile(initialStub)
      const initialHeader = parseMachoHeader(initialData)
      const initialNcmds = initialHeader.ncmds

      const updatedStub = path.join(testDir, 'loadcmd-updated')
      await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      const updatedData = await fs.readFile(updatedStub)
      const updatedHeader = parseMachoHeader(updatedData)
      const updatedNcmds = updatedHeader.ncmds

      // Load command count should remain the same
      // (SMOL segment replaced, not appended)
      expect(updatedNcmds).toBe(initialNcmds)
    }, 60_000)
  },
)
