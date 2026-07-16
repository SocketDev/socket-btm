import { describe, expect, it } from 'vitest'

/**
 * @file Stub binary structure and execution capability tests.
 *   Split out of stub-signing-extraction.test.mts to keep each file under
 *   the 500-line soft cap.
 *
 *   - Stub binary structure (magic marker, segments, sections)
 *   - Stub binary code signing (macOS only)
 *   - Stub execution capabilities (--version, --eval, process info)
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'

import { SMOL_PRESSED_DATA_MAGIC_MARKER } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  MACHO_SECTION_PRESSED_DATA,
  MACHO_SEGMENT_SMOL,
} from 'bin-infra/test/helpers/segment-names'
import {
  extractCompressedData,
  isCodeSigned,
  parseMachoSegments,
} from './stub-signing-extraction.test.mts'
import { getLatestFinalBinary } from '../paths.mts'

const logger = getDefaultLogger()

const IS_MACOS = os.platform() === 'darwin'
const stubBinaryPath = getLatestFinalBinary()
const skipTests = !stubBinaryPath || !existsSync(stubBinaryPath)

describe.skipIf(skipTests)('stub binary structure and execution', () => {
  describe('stub binary structure', () => {
    it('should have compressed data section with magic marker', async () => {
      const binaryData = await fs.readFile(stubBinaryPath)
      const magicMarker = Buffer.from(SMOL_PRESSED_DATA_MAGIC_MARKER, 'utf8')

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
          'utf8',
        )
        const smolMarkerIndex = binaryData.indexOf(smolMarker)
        expect(smolMarkerIndex).toBeGreaterThan(0)

        // Log segment info for debugging
        logger.log(
          'Mach-O segments:',
          segments.map(s => ({
            name: s.segmentName,
            sections: s.sections.map(sec => sec.sectionName),
          })),
        )
      },
    )
  })

  describe.skipIf(!IS_MACOS)('stub binary code signing (macOS)', () => {
    it('should be code-signed', async () => {
      const sigInfo = await isCodeSigned(stubBinaryPath)

      expect(sigInfo.signed).toBeTruthy()
      if (!sigInfo.valid) {
        logger.warn(
          'Stub signature validation:',
          sigInfo.output || sigInfo.error,
        )
      }
    })

    it('should have valid ad-hoc signature', async () => {
      const result = await spawn('codesign', ['-d', '-v', stubBinaryPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
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

  describe('stub execution capabilities', () => {
    it('should execute --version successfully', async () => {
      // First run may extract
      const result = await spawn(stubBinaryPath, ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 10_000,
      })

      expect(result.code).toBe(0)
      expect(result.stdout).toMatch(/^v2[5-9]\.\d+\.\d+/)
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
      expect(info.version).toMatch(/^v2[5-9]\./)
    })
  })
})
