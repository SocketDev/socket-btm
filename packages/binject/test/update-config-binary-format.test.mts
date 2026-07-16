import { describe, expect, it } from 'vitest'

/**
 * @file Binary format tests for update-config serialization.
 *   Tests binary structure: magic number, version, string offsets, nodeVersion.
 *   Split from update-config-validation.test.mts.
 */

import { serializeUpdateConfig } from '../scripts/update-config-binary.mts'

describe('update config binary format', () => {
  describe('binary Format', () => {
    it('should have correct magic number', () => {
      const config = { url: 'https://example.com' }
      const buffer = serializeUpdateConfig(config)

      const magic = buffer.readUInt32LE(0)
      expect(magic).toBe(0x53_4d_46_47)
    })

    it('should have correct version', () => {
      const config = { url: 'https://example.com' }
      const buffer = serializeUpdateConfig(config)

      const version = buffer.readUInt16LE(4)
      expect(version).toBe(2)
    })

    it('should store strings with length prefixes', () => {
      const config = {
        binname: 'myapp',
        url: 'https://example.com',
      }

      const buffer = serializeUpdateConfig(config)

      const binnameLen = buffer.readUInt8(24)
      expect(binnameLen).toBe(5)

      const binname = buffer.toString('utf8', 25, 25 + binnameLen)
      expect(binname).toBe('myapp')
    })

    it('should zero-pad unused string space', () => {
      const config = {
        binname: 'app',
        url: 'https://example.com',
      }

      const buffer = serializeUpdateConfig(config)

      for (let i = 28; i < 152; i++) {
        expect(buffer.readUInt8(i)).toBe(0)
      }
    })

    it('should store nodeVersion at offset 1176', () => {
      const config = {
        nodeVersion: '25.5.0',
        url: 'https://example.com',
      }

      const buffer = serializeUpdateConfig(config)

      const nodeVersionLen = buffer.readUInt8(1176)
      expect(nodeVersionLen).toBe(6)

      const nodeVersion = buffer.toString('utf8', 1177, 1177 + nodeVersionLen)
      expect(nodeVersion).toBe('25.5.0')
    })

    it('should default nodeVersion to empty string', () => {
      const config = {
        url: 'https://example.com',
      }

      const buffer = serializeUpdateConfig(config)

      const nodeVersionLen = buffer.readUInt8(1176)
      expect(nodeVersionLen).toBe(0)
    })
  })

  describe('nodeVersion Validation', () => {
    it('should accept nodeVersion up to 15 chars', () => {
      const config = {
        url: 'https://example.com',
        nodeVersion: '25.5.0-nightly1',
      }

      expect(() => serializeUpdateConfig(config)).not.toThrow()

      const buffer = serializeUpdateConfig(config)
      const len = buffer.readUInt8(1176)
      expect(len).toBe(15)
    })

    it('should reject nodeVersion longer than 15 chars', () => {
      const config = {
        url: 'https://example.com',
        nodeVersion: '25.5.0-nightly12',
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /nodeVersion.*exceeds maximum length of 15/,
      )
    })

    it('should reject non-string nodeVersion', () => {
      const config = {
        nodeVersion: 25,
        url: 'https://example.com',
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /nodeVersion.*must be a string/,
      )
    })
  })
})
