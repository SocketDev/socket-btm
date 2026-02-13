/**
 * Update Config Validation Tests
 *
 * Tests update-config.json validation and binary serialization.
 * Verifies:
 * 1. Valid configs serialize correctly
 * 2. Invalid configs throw appropriate errors
 * 3. String length limits are enforced
 * 4. Type checking works correctly
 * 5. URL validation works
 * 6. Binary format is correct (magic, version, sizes)
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'

import {
  serializeUpdateConfig,
  parseConfigFile,
  parseAndSerialize,
  UpdateConfigValidationError,
} from '../scripts/update-config-binary.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let testDir: string

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'update-config-test-'))
})

afterEach(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe('Update Config Validation', () => {
  describe('Valid Configurations', () => {
    it('should serialize minimal valid config', () => {
      const config = {
        url: 'https://api.github.com/repos/test/repo/releases',
      }

      const buffer = serializeUpdateConfig(config)
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBe(1176)

      // Verify magic number ("SMFG")
      expect(buffer.readUInt32LE(0)).toBe(0x53_4d_46_47)
      // Verify version
      expect(buffer.readUInt16LE(4)).toBe(1)
    })

    it('should serialize full config with all fields', () => {
      const config = {
        url: 'https://api.github.com/repos/test/repo/releases',
        tag: 'v*',
        binname: 'myapp',
        command: 'myapp update',
        skip_env: 'SKIP_UPDATES',
        interval: 3_600_000,
        notify_interval: 7_200_000,
        prompt: true,
        prompt_default: 'y',
      }

      const buffer = serializeUpdateConfig(config)
      expect(buffer.length).toBe(1176)

      // Verify header
      expect(buffer.readUInt32LE(0)).toBe(0x53_4d_46_47)
      expect(buffer.readUInt16LE(4)).toBe(1)

      // Verify prompt fields
      // prompt = true
      expect(buffer.readUInt8(6)).toBe(1)
      // 'y'
      expect(buffer.readUInt8(7)).toBe(121)

      // Verify intervals
      expect(Number(buffer.readBigInt64LE(8))).toBe(3_600_000)
      expect(Number(buffer.readBigInt64LE(16))).toBe(7_200_000)
    })

    it('should use defaults for missing optional fields', () => {
      const config = {
        url: 'https://example.com/releases',
      }

      const buffer = serializeUpdateConfig(config)

      // Verify default values
      // prompt = false
      expect(buffer.readUInt8(6)).toBe(0)
      // 'n'
      expect(buffer.readUInt8(7)).toBe(110)
      // 24h
      expect(Number(buffer.readBigInt64LE(8))).toBe(86_400_000)
      // 24h
      expect(Number(buffer.readBigInt64LE(16))).toBe(86_400_000)

      // Verify command default at offset 24+128=152
      const commandLen = buffer.readUInt16LE(152)
      // "self-update"
      expect(commandLen).toBe(11)
      const command = buffer.toString('utf8', 154, 154 + commandLen)
      expect(command).toBe('self-update')
    })

    it('should accept http:// URLs', () => {
      const config = {
        url: 'http://localhost:3000/releases',
      }

      expect(() => serializeUpdateConfig(config)).not.toThrow()
    })

    it('should accept https:// URLs', () => {
      const config = {
        url: 'https://api.github.com/repos/test/repo/releases',
      }

      expect(() => serializeUpdateConfig(config)).not.toThrow()
    })

    it('should normalize prompt_default values', () => {
      const testCases = [
        { input: 'y', expected: 121 },
        { input: 'Y', expected: 121 },
        { input: 'yes', expected: 121 },
        { input: 'Yes', expected: 121 },
        { input: 'YES', expected: 121 },
        { input: 'n', expected: 110 },
        { input: 'N', expected: 110 },
        { input: 'no', expected: 110 },
        { input: 'No', expected: 110 },
        { input: 'NO', expected: 110 },
      ]

      for (const { expected, input } of testCases) {
        const config = {
          url: 'https://example.com',
          prompt_default: input,
        }
        const buffer = serializeUpdateConfig(config)
        expect(buffer.readUInt8(7)).toBe(expected)
      }
    })
  })

  describe('String Length Validation', () => {
    it('should reject binname longer than 127 chars', () => {
      const config = {
        url: 'https://example.com',
        binname: 'a'.repeat(128),
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        UpdateConfigValidationError,
      )
      expect(() => serializeUpdateConfig(config)).toThrow(
        /binname.*exceeds maximum length of 127/,
      )
    })

    it('should accept binname exactly 127 chars', () => {
      const config = {
        url: 'https://example.com',
        binname: 'a'.repeat(127),
      }

      expect(() => serializeUpdateConfig(config)).not.toThrow()
    })

    it('should reject command longer than 254 chars', () => {
      const config = {
        url: 'https://example.com',
        command: 'a'.repeat(255),
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /command.*exceeds maximum length of 254/,
      )
    })

    it('should reject url longer than 510 chars', () => {
      // 511 total
      const config = {
        url: `https://${'a'.repeat(504)}`,
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /url.*exceeds maximum length of 510/,
      )
    })

    it('should reject tag longer than 127 chars', () => {
      const config = {
        url: 'https://example.com',
        tag: 'a'.repeat(128),
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /tag.*exceeds maximum length of 127/,
      )
    })

    it('should reject skip_env longer than 63 chars', () => {
      const config = {
        url: 'https://example.com',
        skip_env: 'a'.repeat(64),
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /skipEnv.*exceeds maximum length of 63/,
      )
    })
  })

  describe('Type Validation', () => {
    it('should reject non-object config', () => {
      expect(() => serializeUpdateConfig(null)).toThrow(
        /config.*must be an object/,
      )

      expect(() => serializeUpdateConfig('string')).toThrow(
        /config.*must be an object/,
      )

      expect(() => serializeUpdateConfig(123)).toThrow(
        /config.*must be an object/,
      )
    })

    it('should reject non-string url', () => {
      expect(() => serializeUpdateConfig({ url: 123 })).toThrow(
        /url.*must be a string/,
      )

      expect(() => serializeUpdateConfig({ url: true })).toThrow(
        /url.*must be a string/,
      )

      expect(() => serializeUpdateConfig({ url: {} })).toThrow(
        /url.*must be a string/,
      )
    })

    it('should reject non-boolean prompt', () => {
      const config = {
        url: 'https://example.com',
        prompt: 'true',
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /prompt.*must be a boolean/,
      )
    })

    it('should reject non-number interval', () => {
      const config = {
        url: 'https://example.com',
        interval: '3600000',
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /interval.*must be a finite number/,
      )
    })

    it('should reject infinite numbers', () => {
      const config = {
        url: 'https://example.com',
        interval: Number.POSITIVE_INFINITY,
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /interval.*must be a finite number/,
      )
    })

    it('should reject NaN', () => {
      const config = {
        url: 'https://example.com',
        interval: Number.NaN,
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /interval.*must be a finite number/,
      )
    })

    it('should reject negative intervals', () => {
      const config = {
        url: 'https://example.com',
        interval: -1,
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /interval.*must be between 0 and/,
      )
    })
  })

  describe('URL Validation', () => {
    it('should reject URLs without http:// or https://', () => {
      const invalidUrls = [
        'ftp://example.com',
        'example.com',
        'www.example.com',
        '//example.com',
        'file:///path/to/file',
      ]

      for (const url of invalidUrls) {
        expect(() => serializeUpdateConfig({ url })).toThrow(
          /url.*must start with http:\/\/ or https:\/\//,
        )
      }
    })

    it('should accept valid http and https URLs', () => {
      const validUrls = [
        'http://example.com',
        'https://example.com',
        'http://localhost:3000',
        'https://api.github.com/repos/test/repo/releases',
      ]

      for (const url of validUrls) {
        expect(() => serializeUpdateConfig({ url })).not.toThrow()
      }
    })

    it('should allow empty url (defaults to empty string)', () => {
      const config = {
        url: '',
      }

      expect(() => serializeUpdateConfig(config)).not.toThrow()
    })
  })

  describe('prompt_default Validation', () => {
    it('should reject invalid prompt_default values', () => {
      const invalidValues = ['maybe', 'true', 'false', '1', '0', 'yep', 'nope']

      for (const value of invalidValues) {
        const config = {
          url: 'https://example.com',
          prompt_default: value,
        }
        expect(() => serializeUpdateConfig(config)).toThrow(
          /promptDefault.*must be 'y', 'yes', 'n', or 'no'/,
        )
      }
    })

    it('should reject non-string prompt_default', () => {
      const config = {
        url: 'https://example.com',
        prompt_default: true,
      }

      expect(() => serializeUpdateConfig(config)).toThrow(
        /promptDefault.*must be a string/,
      )
    })
  })

  describe('File Parsing', () => {
    it('should parse valid JSON file', async () => {
      const configPath = path.join(testDir, 'update-config.json')
      const config = {
        url: 'https://api.github.com/repos/test/repo/releases',
        tag: 'v*',
        binname: 'test-app',
      }

      await fs.writeFile(configPath, JSON.stringify(config))

      const buffer = parseConfigFile(configPath)
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBe(1176)
    })

    it('should throw error for non-existent file', () => {
      const configPath = path.join(testDir, 'nonexistent.json')

      expect(() => parseConfigFile(configPath)).toThrow(
        /Failed to read smol config file/,
      )
    })

    it('should throw error for invalid JSON', async () => {
      const configPath = path.join(testDir, 'invalid.json')
      await fs.writeFile(configPath, '{invalid json}')

      expect(() => parseConfigFile(configPath)).toThrow(
        /Failed to parse smol config JSON/,
      )
    })

    it('should throw validation error for invalid config in file', async () => {
      const configPath = path.join(testDir, 'invalid-config.json')
      const config = {
        url: 'not-a-url',
      }
      await fs.writeFile(configPath, JSON.stringify(config))

      expect(() => parseConfigFile(configPath)).toThrow(
        /url.*must start with http/,
      )
    })
  })

  describe('JSON String Parsing', () => {
    it('should parse valid JSON string', () => {
      const jsonString = JSON.stringify({
        url: 'https://example.com',
      })

      const buffer = parseAndSerialize(jsonString)
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBe(1176)
    })

    it('should throw error for invalid JSON string', () => {
      expect(() => parseAndSerialize('{invalid}')).toThrow(
        /Failed to parse smol config JSON/,
      )
    })

    it('should throw validation error for invalid config', () => {
      const jsonString = JSON.stringify({
        url: 123,
      })

      expect(() => parseAndSerialize(jsonString)).toThrow(
        /url.*must be a string/,
      )
    })
  })

  describe('Binary Format', () => {
    it('should have correct magic number', () => {
      const config = { url: 'https://example.com' }
      const buffer = serializeUpdateConfig(config)

      const magic = buffer.readUInt32LE(0)
      // "SMFG"
      expect(magic).toBe(0x53_4d_46_47)
    })

    it('should have correct version', () => {
      const config = { url: 'https://example.com' }
      const buffer = serializeUpdateConfig(config)

      const version = buffer.readUInt16LE(4)
      expect(version).toBe(1)
    })

    it('should store strings with length prefixes', () => {
      const config = {
        url: 'https://example.com',
        binname: 'myapp',
      }

      const buffer = serializeUpdateConfig(config)

      // binname is at offset 24
      const binnameLen = buffer.readUInt8(24)
      // "myapp".length
      expect(binnameLen).toBe(5)

      const binname = buffer.toString('utf8', 25, 25 + binnameLen)
      expect(binname).toBe('myapp')
    })

    it('should zero-pad unused string space', () => {
      const config = {
        url: 'https://example.com',
        binname: 'app',
      }

      const buffer = serializeUpdateConfig(config)

      // Check that bytes after the string are zero
      // binname is at offset 24, length is 3, so bytes 28-151 should be 0
      for (let i = 28; i < 152; i++) {
        expect(buffer.readUInt8(i)).toBe(0)
      }
    })
  })
})
