/**
 * @fileoverview Tests for version-helpers utilities.
 * Validates .gitmodules version and checksum parsing.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  fetchNodeChecksum,
  getNodeVersion,
  getSubmoduleChecksum,
  getSubmoduleVersion,
  verifyNodeChecksum,
} from '../lib/version-helpers.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const monorepoRoot = path.resolve(__dirname, '..', '..', '..')

describe('version-helpers', () => {
  describe(getNodeVersion, () => {
    it('should return a valid semver-like version string', () => {
      const version = getNodeVersion()

      expect(version).toBeDefined()
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should match .node-version file content', () => {
      const version = getNodeVersion()
      const fileContent = readFileSync(
        path.join(monorepoRoot, '.node-version'),
        'utf8',
      ).trim()

      expect(version).toBe(fileContent)
    })
  })

  describe(getSubmoduleVersion, () => {
    it('should parse node version from .gitmodules', () => {
      const version = getSubmoduleVersion(
        'packages/node-smol-builder/upstream/node',
        'node',
      )

      expect(version).toBeDefined()
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should parse lief version from .gitmodules', () => {
      const version = getSubmoduleVersion(
        'packages/lief-builder/upstream/lief',
        'lief',
      )

      expect(version).toBeDefined()
      expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    })

    it('should match .node-version for node submodule', () => {
      const submoduleVersion = getSubmoduleVersion(
        'packages/node-smol-builder/upstream/node',
        'node',
      )
      const nodeVersion = getNodeVersion()

      expect(submoduleVersion).toBe(nodeVersion)
    })

    it('should not include checksum in version string', () => {
      const version = getSubmoduleVersion(
        'packages/node-smol-builder/upstream/node',
        'node',
      )

      expect(version).not.toContain('sha256')
      expect(version).not.toContain(':')
      expect(version).not.toContain(' ')
    })

    it('should throw for non-existent submodule path', () => {
      expect(() =>
        getSubmoduleVersion('packages/nonexistent/upstream/foo', 'foo'),
      ).toThrow('not found in .gitmodules')
    })

    it('should throw for empty package name', () => {
      expect(() =>
        getSubmoduleVersion(
          'packages/node-smol-builder/upstream/node',
          '',
        ),
      ).toThrow('Package name cannot be empty')
    })
  })

  describe(getSubmoduleChecksum, () => {
    it('should parse checksum for node submodule', () => {
      const checksum = getSubmoduleChecksum(
        'packages/node-smol-builder/upstream/node',
        'node',
      )

      expect(checksum).toBeDefined()
      expect(checksum!.algorithm).toBe('sha256')
      expect(checksum!.hash).toMatch(/^[0-9a-f]{64}$/)
    })

    it('should return undefined for submodules without checksum', () => {
      const checksum = getSubmoduleChecksum(
        'packages/lief-builder/upstream/lief',
        'lief',
      )

      expect(checksum).toBeUndefined()
    })

    it('should throw for empty package name', () => {
      expect(() =>
        getSubmoduleChecksum(
          'packages/node-smol-builder/upstream/node',
          '',
        ),
      ).toThrow('Package name cannot be empty')
    })
  })

  describe(fetchNodeChecksum, () => {
    it('should fetch checksum for current Node.js version', async () => {
      const version = getNodeVersion()
      const result = await fetchNodeChecksum(version, { timeout: 15_000 })

      expect('hash' in result).toBe(true)
      if ('hash' in result) {
        expect(result.hash).toMatch(/^[0-9a-f]{64}$/)
        expect(result.version).toBe(version)
      }
    }, 20_000)

    it('should return error for non-existent version', async () => {
      const result = await fetchNodeChecksum('0.0.1', { timeout: 10_000 })

      expect('error' in result).toBe(true)
    }, 15_000)
  })

  describe(verifyNodeChecksum, () => {
    it('should verify checksum against nodejs.org', async () => {
      const result = await verifyNodeChecksum({ timeout: 15_000 })

      // Should succeed (stored checksum matches upstream)
      expect(result.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(result.valid).toBe(true)
      expect(result.expected).toMatch(/^[0-9a-f]{64}$/)
      expect(result.actual).toMatch(/^[0-9a-f]{64}$/)
      expect(result.expected).toBe(result.actual)
    }, 20_000)

    it('should return error for invalid version', async () => {
      const result = await verifyNodeChecksum({
        version: '0.0.1',
        timeout: 10_000,
      })

      expect(result.valid).toBe(false)
      expect(result.error).toBeDefined()
    }, 15_000)
  })
})
