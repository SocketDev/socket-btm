/**
 * @fileoverview Tests for cache-key utility.
 * Validates cache key generation, parsing, and validation logic.
 */

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { escapeRegExp } from '@socketsecurity/lib/regexps'
import { nodeVersionRaw } from 'build-infra/lib/node-version'

import {
  generateCacheKey,
  parseCacheKey,
  isCacheValid,
} from '../lib/cache-key.mjs'

describe('cache-key', () => {
  describe('generateCacheKey', () => {
    it('should generate cache key with basic options', () => {
      const key = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      })

      expect(key).toMatch(
        new RegExp(
          `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{8}-215$`,
        ),
      )
    })

    it('should generate different hashes for different content files', async () => {
      const tempDir = path.join(tmpdir(), `cache-key-test-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const file1 = path.join(tempDir, 'file1.txt')
        const file2 = path.join(tempDir, 'file2.txt')

        await fs.writeFile(file1, 'content1')
        await fs.writeFile(file2, 'content2')

        const key1 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          contentFiles: [file1],
        })

        const key2 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          contentFiles: [file2],
        })

        expect(key1).not.toBe(key2)

        expect(key1).toMatch(
          new RegExp(
            `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{8}-215$`,
          ),
        )
        // Both should still have valid format
        expect(key2).toMatch(
          new RegExp(
            `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{8}-215$`,
          ),
        )
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it('should use default platform and arch if not provided', () => {
      const key = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
      })

      expect(key).toMatch(
        new RegExp(
          `^v${escapeRegExp(nodeVersionRaw)}-\\w+-\\w+-[a-f0-9]{8}-215$`,
        ),
      )
      // Should have valid format with some platform/arch
    })

    it('should handle different package versions', () => {
      const key1 = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '1.0.0',
      })

      const key2 = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.0.0',
      })

      expect(key1).not.toBe(key2)
      expect(key1).toContain('-100')
      expect(key2).toContain('-200')
    })

    it('should handle cross-compilation targets', () => {
      const darwinKey = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      })

      const linuxKey = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        platform: 'linux',
        arch: 'x64',
        packageVersion: '2.1.5',
      })

      expect(darwinKey).toContain('darwin-arm64')
      expect(linuxKey).toContain('linux-x64')
      expect(darwinKey).not.toBe(linuxKey)
    })

    it('should include cache-busting dependencies if provided', async () => {
      const tempDir = path.join(tmpdir(), `cache-key-deps-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const pkgJson1 = path.join(tempDir, 'package1.json')
        const pkgJson2 = path.join(tempDir, 'package2.json')

        await fs.writeFile(
          pkgJson1,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
            },
          }),
        )

        await fs.writeFile(
          pkgJson2,
          JSON.stringify({
            dependencies: {
              // Different version
              '@socketsecurity/lib': '1.0.1',
              '@socketsecurity/packageurl-js': '2.0.0',
            },
          }),
        )

        const key1 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          packageName: 'bootstrap',
          packageJsonPath: pkgJson1,
        })

        const key2 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          packageName: 'bootstrap',
          packageJsonPath: pkgJson2,
        })

        expect(key1).not.toBe(key2)
        // Different dependency versions should result in different cache keys
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it('should handle missing content files gracefully', () => {
      const key = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
        contentFiles: ['/nonexistent/file.txt'],
      })

      expect(key).toMatch(
        new RegExp(
          `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{8}-215$`,
        ),
      )
      // Should still generate a valid key
    })
  })

  describe('parseCacheKey', () => {
    it('should parse valid cache key', () => {
      const key = `v${nodeVersionRaw}-darwin-arm64-b71671ba-215`
      const parsed = parseCacheKey(key)

      expect(parsed).toEqual({
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        contentHash: 'b71671ba',
        packageVersion: '2.1.5',
      })
    })

    it('should return null for invalid cache key format', () => {
      expect(parseCacheKey('invalid-key')).toBeNull()
      expect(parseCacheKey('v24-darwin-arm64')).toBeNull()
      // Missing 'v'
      expect(
        parseCacheKey(`${nodeVersionRaw}-darwin-arm64-b71671ba-215`),
      ).toBeNull()
    })

    it('should handle different node versions', () => {
      const key1 = 'v20.0.0-darwin-arm64-abc12345-100'
      const key2 = `v${nodeVersionRaw}-darwin-arm64-abc12345-100`

      const parsed1 = parseCacheKey(key1)
      const parsed2 = parseCacheKey(key2)

      expect(parsed1?.nodeVersion).toBe('20.0.0')
      expect(parsed2?.nodeVersion).toBe(nodeVersionRaw)
    })

    it('should handle different platforms and architectures', () => {
      const darwinKey = `v${nodeVersionRaw}-darwin-arm64-abc12345-100`
      const linuxKey = `v${nodeVersionRaw}-linux-x64-abc12345-100`
      const win32Key = `v${nodeVersionRaw}-win32-x64-abc12345-100`

      const darwinParsed = parseCacheKey(darwinKey)
      const linuxParsed = parseCacheKey(linuxKey)
      const win32Parsed = parseCacheKey(win32Key)

      expect(darwinParsed?.platform).toBe('darwin')
      expect(darwinParsed?.arch).toBe('arm64')

      expect(linuxParsed?.platform).toBe('linux')
      expect(linuxParsed?.arch).toBe('x64')

      expect(win32Parsed?.platform).toBe('win32')
      expect(win32Parsed?.arch).toBe('x64')
    })

    it('should restore package version with dots', () => {
      const key = `v${nodeVersionRaw}-darwin-arm64-abc12345-215`
      const parsed = parseCacheKey(key)

      // Version restoration pattern only works for 3-digit versions
      expect(parsed?.packageVersion).toBe('2.1.5')
    })
  })

  describe('isCacheValid', () => {
    it('should validate matching cache keys', () => {
      const options = {
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      const key = generateCacheKey(options)
      expect(isCacheValid(key, options)).toBe(true)
    })

    it('should invalidate cache with different node version', () => {
      const options1 = {
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      const options2 = {
        nodeVersion: '20.0.0',
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      const key = generateCacheKey(options1)
      expect(isCacheValid(key, options2)).toBe(false)
    })

    it('should invalidate cache with different platform', () => {
      const options1 = {
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      const options2 = {
        nodeVersion: nodeVersionRaw,
        platform: 'linux',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      const key = generateCacheKey(options1)
      expect(isCacheValid(key, options2)).toBe(false)
    })

    it('should invalidate cache with different package version', () => {
      const options1 = {
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      const options2 = {
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '3.0.0',
      }

      const key = generateCacheKey(options1)
      expect(isCacheValid(key, options2)).toBe(false)
    })

    it('should return false for invalid cache key format', () => {
      const options = {
        nodeVersion: nodeVersionRaw,
        platform: 'darwin',
        arch: 'arm64',
        packageVersion: '2.1.5',
      }

      expect(isCacheValid('invalid-key', options)).toBe(false)
    })

    it('should invalidate cache when content files change', async () => {
      const tempDir = path.join(tmpdir(), `cache-key-content-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const file = path.join(tempDir, 'content.txt')

        await fs.writeFile(file, 'version1')

        const options = {
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          contentFiles: [file],
        }

        const key = generateCacheKey(options)
        expect(isCacheValid(key, options)).toBe(true)

        // Change file content
        await fs.writeFile(file, 'version2')

        // Cache should now be invalid
        expect(isCacheValid(key, options)).toBe(false)
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('cache-busting dependencies', () => {
    it('should use correct dependencies for bootstrap package', async () => {
      const tempDir = path.join(tmpdir(), `cache-key-bootstrap-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const pkgJson = path.join(tempDir, 'package.json')

        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              // Should be ignored
              '@socketsecurity/other': '3.0.0',
            },
          }),
        )

        const key1 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          packageName: 'bootstrap',
          packageJsonPath: pkgJson,
        })

        // Update ignored dependency
        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              // Changed but should be ignored
              '@socketsecurity/other': '4.0.0',
            },
          }),
        )

        const key2 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          packageName: 'bootstrap',
          packageJsonPath: pkgJson,
        })

        // Keys should be the same since only non-cache-busting dep changed
        expect(key1).toBe(key2)
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })

    it('should use correct dependencies for cli package', async () => {
      const tempDir = path.join(tmpdir(), `cache-key-cli-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const pkgJson = path.join(tempDir, 'package.json')

        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              '@socketsecurity/sdk': '3.0.0',
              '@socketsecurity/registry': '4.0.0',
            },
          }),
        )

        const key1 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          packageName: 'cli',
          packageJsonPath: pkgJson,
        })

        // Update one of the cli-specific dependencies
        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              // Changed
              '@socketsecurity/sdk': '3.0.1',
              '@socketsecurity/registry': '4.0.0',
            },
          }),
        )

        const key2 = generateCacheKey({
          nodeVersion: nodeVersionRaw,
          platform: 'darwin',
          arch: 'arm64',
          packageVersion: '2.1.5',
          packageName: 'cli',
          packageJsonPath: pkgJson,
        })

        // Keys should be different
        expect(key1).not.toBe(key2)
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true })
      }
    })
  })
})
