/**
 * @file Tests for cache-key parseCacheKey, isCacheValid, and cache-busting
 *   dependencies.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { nodeVersionRaw } from 'build-infra/lib/constants'

import { describe, expect, it } from 'vitest'

import {
  generateCacheKey,
  isCacheValid,
  parseCacheKey,
} from '../lib/cache-key.mts'

describe('cache-key', () => {
  describe(parseCacheKey, () => {
    it('should parse valid cache key', () => {
      const key = `v${nodeVersionRaw}-darwin-arm64-b71671ba01234567-1,1,1.215`
      const parsed = parseCacheKey(key)

      expect(parsed).toStrictEqual({
        arch: 'arm64',
        contentHash: 'b71671ba01234567',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      })
    })

    it('should return undefined for invalid cache key format', () => {
      expect(parseCacheKey('invalid-key')).toBeUndefined()
      expect(parseCacheKey('v24-darwin-arm64')).toBeUndefined()
      expect(
        parseCacheKey(
          `${nodeVersionRaw}-darwin-arm64-b71671ba01234567-1,1,1.215`,
        ),
      ).toBeUndefined()
    })

    it('should handle different node versions', () => {
      const key1 = 'v20.0.0-darwin-arm64-abc1234567890123-1,1,1.100'
      const key2 = `v${nodeVersionRaw}-darwin-arm64-abc1234567890123-1,1,1.100`

      const parsed1 = parseCacheKey(key1)
      const parsed2 = parseCacheKey(key2)

      expect(parsed1?.nodeVersion).toBe('20.0.0')
      expect(parsed2?.nodeVersion).toBe(nodeVersionRaw)
    })

    it('should handle different platforms and architectures', () => {
      const darwinKey = `v${nodeVersionRaw}-darwin-arm64-abc1234567890123-1,1,1.100`
      const linuxKey = `v${nodeVersionRaw}-linux-x64-abc1234567890123-1,1,1.100`
      const win32Key = `v${nodeVersionRaw}-win32-x64-abc1234567890123-1,1,1.100`

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
      const key = `v${nodeVersionRaw}-darwin-arm64-abc1234567890123-1,1,1.215`
      const parsed = parseCacheKey(key)

      expect(parsed?.packageVersion).toBe('2.1.5')
    })
  })

  describe(isCacheValid, () => {
    it('should validate matching cache keys', () => {
      const options = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      }

      const key = generateCacheKey(options)
      expect(isCacheValid(key, options)).toBeTruthy()
    })

    it('should invalidate cache with different node version', () => {
      const options1 = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      }

      const options2 = {
        arch: 'arm64',
        nodeVersion: '20.0.0',
        packageVersion: '2.1.5',
        platform: 'darwin',
      }

      const key = generateCacheKey(options1)
      expect(isCacheValid(key, options2)).toBeFalsy()
    })

    it('should invalidate cache with different platform', () => {
      const options1 = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      }

      const options2 = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'linux',
      }

      const key = generateCacheKey(options1)
      expect(isCacheValid(key, options2)).toBeFalsy()
    })

    it('should invalidate cache with different package version', () => {
      const options1 = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      }

      const options2 = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '3.0.0',
        platform: 'darwin',
      }

      const key = generateCacheKey(options1)
      expect(isCacheValid(key, options2)).toBeFalsy()
    })

    it('should return false for invalid cache key format', () => {
      const options = {
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      }

      expect(isCacheValid('invalid-key', options)).toBeFalsy()
    })

    it('should invalidate cache when content files change', async () => {
      const tempDir = path.join(os.tmpdir(), `cache-key-content-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const file = path.join(tempDir, 'content.txt')

        await fs.writeFile(file, 'version1')

        const options = {
          arch: 'arm64',
          contentFiles: [file],
          nodeVersion: nodeVersionRaw,
          packageVersion: '2.1.5',
          platform: 'darwin',
        }

        const key = generateCacheKey(options)
        expect(isCacheValid(key, options)).toBeTruthy()

        await fs.writeFile(file, 'version2')

        expect(isCacheValid(key, options)).toBeFalsy()
      } finally {
        await safeDelete(tempDir)
      }
    })
  })

  describe('cache-busting dependencies', () => {
    it('should use correct dependencies for bootstrap package', async () => {
      const tempDir = path.join(
        os.tmpdir(),
        `cache-key-bootstrap-${Date.now()}`,
      )
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const pkgJson = path.join(tempDir, 'package.json')

        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              '@socketsecurity/other': '3.0.0',
            },
          }),
        )

        const key1 = generateCacheKey({
          arch: 'arm64',
          nodeVersion: nodeVersionRaw,
          packageJsonPath: pkgJson,
          packageName: 'bootstrap',
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              '@socketsecurity/other': '4.0.0',
            },
          }),
        )

        const key2 = generateCacheKey({
          arch: 'arm64',
          nodeVersion: nodeVersionRaw,
          packageJsonPath: pkgJson,
          packageName: 'bootstrap',
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        expect(key1).toBe(key2)
      } finally {
        await safeDelete(tempDir)
      }
    })

    it('should use correct dependencies for cli package', async () => {
      const tempDir = path.join(os.tmpdir(), `cache-key-cli-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const pkgJson = path.join(tempDir, 'package.json')

        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              '@socketsecurity/registry': '4.0.0',
              '@socketsecurity/sdk': '3.0.0',
            },
          }),
        )

        const key1 = generateCacheKey({
          arch: 'arm64',
          nodeVersion: nodeVersionRaw,
          packageJsonPath: pkgJson,
          packageName: 'cli',
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        await fs.writeFile(
          pkgJson,
          JSON.stringify({
            dependencies: {
              '@socketsecurity/lib': '1.0.0',
              '@socketsecurity/packageurl-js': '2.0.0',
              '@socketsecurity/sdk': '3.0.1',
              '@socketsecurity/registry': '4.0.0',
            },
          }),
        )

        const key2 = generateCacheKey({
          arch: 'arm64',
          nodeVersion: nodeVersionRaw,
          packageJsonPath: pkgJson,
          packageName: 'cli',
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        expect(key1).not.toBe(key2)
      } finally {
        await safeDelete(tempDir)
      }
    })
  })
})
