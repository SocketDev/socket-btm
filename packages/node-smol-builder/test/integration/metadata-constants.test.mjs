/**
 * @fileoverview Tests for platform/arch/libc byte mappings
 *
 * Validates that the byte value mappings for platform, architecture, and libc
 * are correctly used when reading binaries and writing metadata.
 *
 * Tests verify:
 * - Platform byte encoding matches constants
 * - Architecture byte encoding matches constants
 * - Libc byte encoding matches constants
 * - Round-trip encoding/decoding consistency
 */

import { existsSync, promises as fs } from 'node:fs'
import { platform, arch } from 'node:os'

import { describe, it, expect, beforeAll } from 'vitest'

import {
  MAGIC_MARKER,
  HEADER_SIZES,
  PLATFORM_VALUES,
  ARCH_VALUES,
  LIBC_VALUES,
} from '../../scripts/binary-compressed/shared/constants.mjs'
import { getLatestFinalBinary } from '../paths.mjs'

const skipTests = !getLatestFinalBinary() || !existsSync(getLatestFinalBinary())

describe.skipIf(skipTests)('Platform/Arch/Libc Byte Mappings', () => {
  let binaryPath
  let binaryData
  let platformByte
  let archByte
  let libcByte

  beforeAll(async () => {
    binaryPath = getLatestFinalBinary()
    if (!existsSync(binaryPath)) {
      throw new Error(`Binary not found: ${binaryPath}`)
    }

    // Read binary and extract metadata bytes
    binaryData = await fs.readFile(binaryPath)
    const markerIndex = binaryData.indexOf(Buffer.from(MAGIC_MARKER, 'utf-8'))

    if (markerIndex === -1) {
      throw new Error('Magic marker not found in binary')
    }

    const metadataOffset =
      markerIndex +
      HEADER_SIZES.MAGIC_MARKER +
      HEADER_SIZES.COMPRESSED_SIZE +
      HEADER_SIZES.UNCOMPRESSED_SIZE +
      HEADER_SIZES.CACHE_KEY

    platformByte = binaryData[metadataOffset]
    archByte = binaryData[metadataOffset + 1]
    libcByte = binaryData[metadataOffset + 2]
  })

  describe('Platform byte encoding', () => {
    it('should encode linux as 0', () => {
      expect(PLATFORM_VALUES.linux).toBe(0)
    })

    it('should encode darwin as 1', () => {
      expect(PLATFORM_VALUES.darwin).toBe(1)
    })

    it('should encode win32 as 2', () => {
      expect(PLATFORM_VALUES.win32).toBe(2)
    })

    it('should have platform byte matching current platform', () => {
      const expectedValue = PLATFORM_VALUES[platform()]
      expect(platformByte).toBe(expectedValue)
    })

    it('should decode platform byte to string correctly', () => {
      const platformMapping = {
        [PLATFORM_VALUES.linux]: 'linux',
        [PLATFORM_VALUES.darwin]: 'darwin',
        [PLATFORM_VALUES.win32]: 'win32',
      }

      const decodedPlatform = platformMapping[platformByte]
      expect(decodedPlatform).toBe(platform())
    })
  })

  describe('Architecture byte encoding', () => {
    it('should encode x64 as 0', () => {
      expect(ARCH_VALUES.x64).toBe(0)
    })

    it('should encode arm64 as 1', () => {
      expect(ARCH_VALUES.arm64).toBe(1)
    })

    it('should encode ia32 as 2', () => {
      expect(ARCH_VALUES.ia32).toBe(2)
    })

    it('should encode arm as 3', () => {
      expect(ARCH_VALUES.arm).toBe(3)
    })

    it('should have arch byte matching current architecture', () => {
      const expectedValue = ARCH_VALUES[arch()]
      expect(archByte).toBe(expectedValue)
    })

    it('should decode arch byte to string correctly', () => {
      const archMapping = {
        [ARCH_VALUES.x64]: 'x64',
        [ARCH_VALUES.arm64]: 'arm64',
        [ARCH_VALUES.ia32]: 'ia32',
        [ARCH_VALUES.arm]: 'arm',
      }

      const decodedArch = archMapping[archByte]
      expect(decodedArch).toBe(arch())
    })
  })

  describe('Libc byte encoding', () => {
    it('should encode glibc as 0', () => {
      expect(LIBC_VALUES.glibc).toBe(0)
    })

    it('should encode musl as 1', () => {
      expect(LIBC_VALUES.musl).toBe(1)
    })

    it('should encode n/a as 255', () => {
      expect(LIBC_VALUES.na).toBe(255)
    })

    it('should have n/a (255) libc byte on non-Linux platforms', () => {
      if (platform() !== 'linux') {
        expect(libcByte).toBe(LIBC_VALUES.na)
      }
    })

    it('should have valid glibc/musl byte on Linux platforms', () => {
      if (platform() === 'linux') {
        expect([LIBC_VALUES.glibc, LIBC_VALUES.musl]).toContain(libcByte)
      }
    })

    it('should decode libc byte correctly on Linux', () => {
      if (platform() !== 'linux') {
        // Skip on non-Linux
        return
      }

      const libcMapping = {
        [LIBC_VALUES.glibc]: 'glibc',
        [LIBC_VALUES.musl]: 'musl',
      }

      const decodedLibc = libcMapping[libcByte]
      expect(['glibc', 'musl']).toContain(decodedLibc)
    })

    it('should decode n/a libc byte on non-Linux platforms', () => {
      if (platform() === 'linux') {
        // Skip on Linux
        return
      }

      expect(libcByte).toBe(255)
      // n/a decodes to undefined in metadata.extra.libc
    })
  })

  describe('Round-trip encoding/decoding', () => {
    it('should round-trip platform byte encoding', () => {
      // Encode: string -> byte
      const encoded = PLATFORM_VALUES[platform()]

      // Decode: byte -> string
      const reverseMapping = Object.fromEntries(
        Object.entries(PLATFORM_VALUES).map(([k, v]) => [v, k]),
      )
      const decoded = reverseMapping[encoded]

      expect(decoded).toBe(platform())
    })

    it('should round-trip arch byte encoding', () => {
      // Encode: string -> byte
      const encoded = ARCH_VALUES[arch()]

      // Decode: byte -> string
      const reverseMapping = Object.fromEntries(
        Object.entries(ARCH_VALUES).map(([k, v]) => [v, k]),
      )
      const decoded = reverseMapping[encoded]

      expect(decoded).toBe(arch())
    })

    it('should have bijective platform mapping', () => {
      // Every platform string maps to unique byte
      const values = Object.values(PLATFORM_VALUES)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)

      // Every byte maps back to unique platform string
      const keys = Object.keys(PLATFORM_VALUES)
      expect(keys.length).toBe(values.length)
    })

    it('should have bijective arch mapping', () => {
      // Every arch string maps to unique byte
      const values = Object.values(ARCH_VALUES)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)

      // Every byte maps back to unique arch string
      const keys = Object.keys(ARCH_VALUES)
      expect(keys.length).toBe(values.length)
    })

    it('should have bijective libc mapping', () => {
      // Every libc string maps to unique byte
      const values = Object.values(LIBC_VALUES)
      const uniqueValues = new Set(values)
      expect(uniqueValues.size).toBe(values.length)

      // Every byte maps back to unique libc string
      const keys = Object.keys(LIBC_VALUES)
      expect(keys.length).toBe(values.length)
    })
  })
})
