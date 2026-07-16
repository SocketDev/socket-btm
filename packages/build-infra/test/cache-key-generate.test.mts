/**
 * @file Tests for cache-key generateCacheKey utility.
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { escapeRegExp } from '@socketsecurity/lib-stable/regexps/escape'
import { nodeVersionRaw } from 'build-infra/lib/constants'

import { describe, expect, it } from 'vitest'

import { generateCacheKey } from '../lib/cache-key.mts'

describe('cache-key', () => {
  describe(generateCacheKey, () => {
    it('should generate cache key with basic options', () => {
      const key = generateCacheKey({
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      })

      expect(key).toMatch(
        new RegExp(
          `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{16}-1,1,1\\.215$`,
        ),
      )
    })

    it('should generate different hashes for different content files', async () => {
      const tempDir = path.join(os.tmpdir(), `cache-key-test-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      try {
        const file1 = path.join(tempDir, 'file1.txt')
        const file2 = path.join(tempDir, 'file2.txt')

        await fs.writeFile(file1, 'content1')
        await fs.writeFile(file2, 'content2')

        const key1 = generateCacheKey({
          arch: 'arm64',
          contentFiles: [file1],
          nodeVersion: nodeVersionRaw,
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        const key2 = generateCacheKey({
          arch: 'arm64',
          contentFiles: [file2],
          nodeVersion: nodeVersionRaw,
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        expect(key1).not.toBe(key2)

        expect(key1).toMatch(
          new RegExp(
            `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{16}-1,1,1\\.215$`,
          ),
        )
        expect(key2).toMatch(
          new RegExp(
            `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{16}-1,1,1\\.215$`,
          ),
        )
      } finally {
        await safeDelete(tempDir)
      }
    })

    it('should use default platform and arch if not provided', () => {
      const key = generateCacheKey({
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
      })

      expect(key).toMatch(
        new RegExp(
          `^v${escapeRegExp(nodeVersionRaw)}-\\w+-\\w+-[a-f0-9]{16}-1,1,1\\.215$`,
        ),
      )
    })

    it('should handle different package versions', () => {
      const key1 = generateCacheKey({
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '1.0.0',
        platform: 'darwin',
      })

      const key2 = generateCacheKey({
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.0.0',
        platform: 'darwin',
      })

      expect(key1).not.toBe(key2)
      expect(key1).toContain('-1,1,1.100')
      expect(key2).toContain('-1,1,1.200')
    })

    it('should handle cross-compilation targets', () => {
      const darwinKey = generateCacheKey({
        arch: 'arm64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      })

      const linuxKey = generateCacheKey({
        arch: 'x64',
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'linux',
      })

      expect(darwinKey).toContain('darwin-arm64')
      expect(linuxKey).toContain('linux-x64')
      expect(darwinKey).not.toBe(linuxKey)
    })

    it('should include cache-busting dependencies if provided', async () => {
      const tempDir = path.join(os.tmpdir(), `cache-key-deps-${Date.now()}`)
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
              '@socketsecurity/lib': '1.0.1',
              '@socketsecurity/packageurl-js': '2.0.0',
            },
          }),
        )

        const key1 = generateCacheKey({
          arch: 'arm64',
          nodeVersion: nodeVersionRaw,
          packageJsonPath: pkgJson1,
          packageName: 'bootstrap',
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        const key2 = generateCacheKey({
          arch: 'arm64',
          nodeVersion: nodeVersionRaw,
          packageJsonPath: pkgJson2,
          packageName: 'bootstrap',
          packageVersion: '2.1.5',
          platform: 'darwin',
        })

        expect(key1).not.toBe(key2)
      } finally {
        await safeDelete(tempDir)
      }
    })

    it('should handle missing content files gracefully', () => {
      const key = generateCacheKey({
        arch: 'arm64',
        contentFiles: ['/nonexistent/file.txt'],
        nodeVersion: nodeVersionRaw,
        packageVersion: '2.1.5',
        platform: 'darwin',
      })

      expect(key).toMatch(
        new RegExp(
          `^v${escapeRegExp(nodeVersionRaw)}-darwin-arm64-[a-f0-9]{16}-1,1,1\\.215$`,
        ),
      )
    })
  })
})
