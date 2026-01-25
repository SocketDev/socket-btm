/**
 * @fileoverview PE section repacking validation tests
 *
 * Tests PE-specific .pressed_data section replacement logic in smol_repack_lief_pe().
 * These tests validate that:
 * 1. PE sections are REPLACED (not appended) during repack
 * 2. PE section structure remains valid after repacking
 * 3. PE binary structure remains valid after repacking
 * 4. Edge cases are handled gracefully
 *
 * IMPORTANT: These tests only run on Windows platforms where PE is native.
 * They explicitly validate the PE section handling that mirrors the PT_NOTE
 * handling for ELF binaries and SMOL segment handling for Mach-O binaries.
 */

import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import { execCommand } from '../../bin-infra/test-helpers/test-utils.mjs'

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
 * Parse PE header and return basic information
 * @param {Buffer} peData - PE binary data
 * @returns {Object} PE header information
 */
function parsePeHeader(peData) {
  // Validate DOS header magic "MZ"
  if (peData[0] !== 0x4d || peData[1] !== 0x5a) {
    throw new Error('Invalid DOS magic (expected MZ)')
  }

  // Get offset to PE header from DOS header (at offset 0x3c)
  const peOffset = peData.readUInt32LE(0x3c)

  // Validate PE signature "PE\0\0"
  if (
    peData[peOffset] !== 0x50 ||
    peData[peOffset + 1] !== 0x45 ||
    peData[peOffset + 2] !== 0x00 ||
    peData[peOffset + 3] !== 0x00
  ) {
    throw new Error('Invalid PE signature')
  }

  // COFF header starts after PE signature (4 bytes)
  const coffHeaderOffset = peOffset + 4

  // Machine type (2 bytes) - not used but validates structure
  // const machine = peData.readUInt16LE(coffHeaderOffset)

  // Number of sections (2 bytes, at offset +2)
  const numberOfSections = peData.readUInt16LE(coffHeaderOffset + 2)

  // Size of optional header (2 bytes, at offset +16)
  const sizeOfOptionalHeader = peData.readUInt16LE(coffHeaderOffset + 16)

  // Section headers start after: PE signature (4) + COFF header (20) + optional header
  const sectionHeadersOffset = coffHeaderOffset + 20 + sizeOfOptionalHeader

  return {
    peOffset,
    coffHeaderOffset,
    numberOfSections,
    sectionHeadersOffset,
  }
}

/**
 * Parse section headers and return array of section info
 * @param {Buffer} peData - PE binary data
 * @returns {Array} Array of section information
 */
function parseSections(peData) {
  const header = parsePeHeader(peData)
  const { numberOfSections, sectionHeadersOffset } = header

  const sections = []

  // Each section header is 40 bytes
  const SECTION_HEADER_SIZE = 40

  for (let i = 0; i < numberOfSections; i++) {
    const offset = sectionHeadersOffset + i * SECTION_HEADER_SIZE

    // Section name (8 bytes, null-padded)
    const nameBuffer = peData.subarray(offset, offset + 8)
    const name = nameBuffer.toString('utf8').replace(/\0.*$/, '')

    // Virtual size (4 bytes, at offset +8)
    const virtualSize = peData.readUInt32LE(offset + 8)

    // Virtual address (4 bytes, at offset +12)
    const virtualAddress = peData.readUInt32LE(offset + 12)

    // Size of raw data (4 bytes, at offset +16)
    const sizeOfRawData = peData.readUInt32LE(offset + 16)

    // Pointer to raw data (4 bytes, at offset +20)
    const pointerToRawData = peData.readUInt32LE(offset + 20)

    sections.push({
      name,
      virtualSize,
      virtualAddress,
      sizeOfRawData,
      pointerToRawData,
      content:
        sizeOfRawData > 0
          ? peData.subarray(pointerToRawData, pointerToRawData + sizeOfRawData)
          : Buffer.alloc(0),
    })
  }

  return sections
}

/**
 * Count .pressed_data sections in PE binary
 * @param {Buffer} peData - PE binary data
 * @returns {number} Number of .pressed_data sections
 */
function countPressedDataSections(peData) {
  const sections = parseSections(peData)
  return sections.filter(s => s.name === '.pressed').length
}

/**
 * Find .pressed_data sections with their content
 * @param {Buffer} peData - PE binary data
 * @returns {Array} Array of .pressed_data section info
 */
function findPressedDataSections(peData) {
  const sections = parseSections(peData)
  return sections.filter(s => s.name === '.pressed')
}

/**
 * Search for magic marker in .pressed_data sections
 * @param {Buffer} peData - PE binary data
 * @param {string} marker - Marker string to search for
 * @returns {boolean} True if marker found
 */
function hasMarkerInPressedDataSection(peData, marker) {
  const sections = findPressedDataSections(peData)
  const markerBuffer = Buffer.from(marker, 'utf-8')

  for (const section of sections) {
    if (section.content.includes(markerBuffer)) {
      return true
    }
  }

  return false
}

// Only run on Windows where PE is native
describe.skipIf(process.platform !== 'win32' || !existsSync(BINPRESS))(
  'PE Section Repacking Validation',
  () => {
    let testDir

    beforeAll(async () => {
      // Create test directory
      testDir = path.join(
        PACKAGE_DIR,
        'build',
        BUILD_MODE,
        'test-tmp-pe-section',
      )
      await safeMkdir(testDir)
    })

    afterAll(async () => {
      // Clean up test directory
      if (testDir) {
        await safeDelete(testDir)
      }
    })

    it('should replace .pressed_data section (not append)', async () => {
      // Step 1: Create initial compressed stub
      const initialStub = path.join(testDir, 'initial-stub.exe')
      const compressResult = await execCommand(BINPRESS, [
        BINPRESS,
        '-o',
        initialStub,
      ])

      expect(compressResult.code).toBe(0)
      expect(existsSync(initialStub)).toBe(true)

      // Parse PE and count .pressed_data sections
      const initialPeData = await fs.readFile(initialStub)
      const initialSectionCount = countPressedDataSections(initialPeData)

      // Should have exactly 1 .pressed_data section with compressed data
      expect(initialSectionCount).toBe(1)

      // Verify marker is present
      const hasInitialMarker = hasMarkerInPressedDataSection(
        initialPeData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasInitialMarker).toBe(true)

      // Step 2: Update stub with new data (compress binpress itself)
      const updatedStub = path.join(testDir, 'updated-stub.exe')
      const updateResult = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      expect(updateResult.code).toBe(0)
      expect(existsSync(updatedStub)).toBe(true)

      // Parse updated PE and verify section is replaced, not appended
      const updatedPeData = await fs.readFile(updatedStub)
      const updatedSectionCount = countPressedDataSections(updatedPeData)

      // CRITICAL: Should still have same number of .pressed_data sections
      // (replaced, not appended)
      expect(updatedSectionCount).toBe(initialSectionCount)
      expect(updatedSectionCount).toBe(1)

      // Verify marker is still present
      const hasUpdatedMarker = hasMarkerInPressedDataSection(
        updatedPeData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasUpdatedMarker).toBe(true)
    }, 60_000)

    it('should maintain PE binary validity after repack', async () => {
      const initialStub = path.join(testDir, 'validity-stub.exe')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const updatedStub = path.join(testDir, 'validity-updated.exe')
      const updateResult = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      expect(updateResult.code).toBe(0)

      // Verify PE magic bytes
      const peData = await fs.readFile(updatedStub)

      // DOS magic "MZ"
      expect(peData[0]).toBe(0x4d)
      expect(peData[1]).toBe(0x5a)

      // PE signature at e_lfanew offset
      const peOffset = peData.readUInt32LE(0x3c)
      expect(peData[peOffset]).toBe(0x50)
      // P
      expect(peData[peOffset + 1]).toBe(0x45)
      // E
      expect(peData[peOffset + 2]).toBe(0x00)
      expect(peData[peOffset + 3]).toBe(0x00)

      // Verify binary is executable
      const execResult = await execCommand(updatedStub, ['--version'])

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('binpress')
    }, 60_000)

    it('should have valid .pressed_data section structure after repack', async () => {
      const initialStub = path.join(testDir, 'structure-stub.exe')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const updatedStub = path.join(testDir, 'structure-updated.exe')
      await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      const peData = await fs.readFile(updatedStub)

      // Parse and validate .pressed_data section structure
      const sections = findPressedDataSections(peData)

      // Should have exactly one .pressed_data section
      expect(sections.length).toBe(1)

      const pressedSection = sections[0]
      expect(pressedSection.sizeOfRawData).toBeGreaterThan(0)

      // Verify marker is at a valid position
      const markerIndex = pressedSection.content.indexOf(
        Buffer.from('__SMOL_PRESSED_DATA_MAGIC_MARKER', 'utf-8'),
      )
      expect(markerIndex).toBeGreaterThanOrEqual(0)
    }, 60_000)

    it('should handle multiple sequential updates', async () => {
      // Create initial stub
      const stub1 = path.join(testDir, 'multi-stub-1.exe')
      await execCommand(BINPRESS, [BINPRESS, '-o', stub1])

      const peData1 = await fs.readFile(stub1)
      const sectionCount1 = countPressedDataSections(peData1)
      expect(sectionCount1).toBe(1)

      // Update 1: Update with binpress
      const stub2 = path.join(testDir, 'multi-stub-2.exe')
      const result2 = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        stub1,
        '-o',
        stub2,
      ])
      expect(result2.code).toBe(0)

      const peData2 = await fs.readFile(stub2)
      const sectionCount2 = countPressedDataSections(peData2)
      // Should not increase
      expect(sectionCount2).toBe(sectionCount1)
      expect(sectionCount2).toBe(1)

      // Update 2: Update again with binpress
      const stub3 = path.join(testDir, 'multi-stub-3.exe')
      const result3 = await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        stub2,
        '-o',
        stub3,
      ])
      expect(result3.code).toBe(0)

      const peData3 = await fs.readFile(stub3)
      const sectionCount3 = countPressedDataSections(peData3)
      // Should still be the same
      expect(sectionCount3).toBe(sectionCount1)
      expect(sectionCount3).toBe(1)

      // Verify final binary is executable
      const execResult = await execCommand(stub3, ['--version'])
      expect(execResult.code).toBe(0)
    }, 90_000)

    it('should preserve marker after repack', async () => {
      const initialStub = path.join(testDir, 'marker-stub.exe')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const initialData = await fs.readFile(initialStub)
      const hasInitialMarker = hasMarkerInPressedDataSection(
        initialData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasInitialMarker).toBe(true)

      // Update stub
      const updatedStub = path.join(testDir, 'marker-updated.exe')
      await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      const updatedData = await fs.readFile(updatedStub)
      const hasUpdatedMarker = hasMarkerInPressedDataSection(
        updatedData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasUpdatedMarker).toBe(true)
    }, 60_000)

    it('should create initial compressed binary', async () => {
      // Test initial compression (not update mode)
      const outputStub = path.join(testDir, 'new-compressed-stub.exe')

      const result = await execCommand(BINPRESS, [BINPRESS, '-o', outputStub])

      // Should succeed
      expect(result.code).toBe(0)

      // Verify output has .pressed_data section with marker
      const outputData = await fs.readFile(outputStub)
      const hasMarker = hasMarkerInPressedDataSection(
        outputData,
        '__SMOL_PRESSED_DATA_MAGIC_MARKER',
      )
      expect(hasMarker).toBe(true)
    }, 60_000)

    it('should maintain correct section count', async () => {
      const initialStub = path.join(testDir, 'section-count-stub.exe')
      await execCommand(BINPRESS, [BINPRESS, '-o', initialStub])

      const initialData = await fs.readFile(initialStub)
      const initialHeader = parsePeHeader(initialData)
      const initialSectionCount = initialHeader.numberOfSections

      const updatedStub = path.join(testDir, 'section-count-updated.exe')
      await execCommand(BINPRESS, [
        BINPRESS,
        '-u',
        initialStub,
        '-o',
        updatedStub,
      ])

      const updatedData = await fs.readFile(updatedStub)
      const updatedHeader = parsePeHeader(updatedData)
      const updatedSectionCount = updatedHeader.numberOfSections

      // Section count should remain the same or decrease
      // (LIEF may optimize/remove unused sections, but should not add new ones)
      expect(updatedSectionCount).toBeLessThanOrEqual(initialSectionCount)
    }, 60_000)
  },
)
