/**
 * @fileoverview Tests for SEA path handling (/sea/* path prefix).
 *
 * These tests verify the path parsing and normalization logic for SEA paths.
 * Since the actual SEA module (node:sea) is only available when running as a
 * Single Executable Application, we test the path logic independently.
 */

import { describe, expect, it } from 'vitest'

/**
 * Simulate path normalization (backslash → forward slash)
 */
function normalizePath(filepath: string): string {
  return filepath.replace(/\\/g, '/')
}

/**
 * Simulate getSeaAssetKey logic
 */
function getSeaAssetKey(filepath: string): string | null {
  const SEA_PREFIX = '/sea'
  const normalized = normalizePath(filepath)

  // Remove trailing slashes
  const cleanPath = normalized.replace(/\/+$/, '')

  // Root /sea path
  if (cleanPath === SEA_PREFIX) {
    return ''
  }

  // Extract key: /sea/foo/bar.json → foo/bar.json
  if (!cleanPath.startsWith(`${SEA_PREFIX}/`)) {
    return null
  }

  const key = cleanPath.slice(SEA_PREFIX.length + 1)

  // Security: reject path traversal
  if (key.includes('..')) {
    return null
  }

  // Normalize any ./ in the path
  if (key.startsWith('./')) {
    return key.slice(2)
  }

  return key
}

/**
 * Simulate isSeaPath logic
 */
function isSeaPath(filepath: string | null | undefined): boolean {
  if (!filepath || typeof filepath !== 'string') {
    return false
  }

  const SEA_PREFIX = '/sea'
  const normalized = normalizePath(filepath)

  return (
    normalized === SEA_PREFIX ||
    normalized === `${SEA_PREFIX}/` ||
    normalized.startsWith(`${SEA_PREFIX}/`)
  )
}

describe('SEA Path Handling', () => {
  describe('isSeaPath', () => {
    it('should return true for /sea', () => {
      expect(isSeaPath('/sea')).toBe(true)
    })

    it('should return true for /sea/', () => {
      expect(isSeaPath('/sea/')).toBe(true)
    })

    it('should return true for /sea/config.json', () => {
      expect(isSeaPath('/sea/config.json')).toBe(true)
    })

    it('should return true for /sea/nested/path/file.txt', () => {
      expect(isSeaPath('/sea/nested/path/file.txt')).toBe(true)
    })

    it('should return false for /snapshot/file.js', () => {
      expect(isSeaPath('/snapshot/file.js')).toBe(false)
    })

    it('should return false for /seaport/file.js', () => {
      expect(isSeaPath('/seaport/file.js')).toBe(false)
    })

    it('should return false for regular paths', () => {
      expect(isSeaPath('/usr/local/bin')).toBe(false)
      expect(isSeaPath('/home/user/file.txt')).toBe(false)
    })

    it('should handle Windows-style paths', () => {
      expect(isSeaPath('\\sea\\config.json')).toBe(true)
      expect(isSeaPath('\\sea\\')).toBe(true)
    })

    it('should return false for null/undefined', () => {
      expect(isSeaPath(null)).toBe(false)
      expect(isSeaPath(undefined)).toBe(false)
    })

    it('should return false for non-string values', () => {
      // @ts-expect-error Testing runtime behavior
      expect(isSeaPath(123)).toBe(false)
      // @ts-expect-error Testing runtime behavior
      expect(isSeaPath({})).toBe(false)
    })
  })

  describe('getSeaAssetKey', () => {
    it('should return empty string for /sea root', () => {
      expect(getSeaAssetKey('/sea')).toBe('')
      expect(getSeaAssetKey('/sea/')).toBe('')
    })

    it('should extract key from simple path', () => {
      expect(getSeaAssetKey('/sea/config.json')).toBe('config.json')
      expect(getSeaAssetKey('/sea/data.bin')).toBe('data.bin')
    })

    it('should extract key from nested path', () => {
      expect(getSeaAssetKey('/sea/data/file.txt')).toBe('data/file.txt')
      expect(getSeaAssetKey('/sea/a/b/c/d.json')).toBe('a/b/c/d.json')
    })

    it('should handle trailing slashes', () => {
      expect(getSeaAssetKey('/sea/config.json/')).toBe('config.json')
      expect(getSeaAssetKey('/sea/data//')).toBe('data')
    })

    it('should reject path traversal attempts', () => {
      expect(getSeaAssetKey('/sea/../etc/passwd')).toBe(null)
      expect(getSeaAssetKey('/sea/foo/../bar')).toBe(null)
      expect(getSeaAssetKey('/sea/..config')).toBe(null)
    })

    it('should normalize ./ prefix', () => {
      expect(getSeaAssetKey('/sea/./config.json')).toBe('config.json')
    })

    it('should return null for non-SEA paths', () => {
      expect(getSeaAssetKey('/snapshot/file.js')).toBe(null)
      expect(getSeaAssetKey('/usr/local/bin')).toBe(null)
    })

    it('should handle Windows-style paths', () => {
      expect(getSeaAssetKey('\\sea\\config.json')).toBe('config.json')
      expect(getSeaAssetKey('\\sea\\data\\file.txt')).toBe('data/file.txt')
    })
  })

  describe('path normalization', () => {
    it('should convert backslashes to forward slashes', () => {
      expect(normalizePath('\\sea\\config.json')).toBe('/sea/config.json')
      expect(normalizePath('\\sea\\data\\file.txt')).toBe('/sea/data/file.txt')
    })

    it('should not modify forward slashes', () => {
      expect(normalizePath('/sea/config.json')).toBe('/sea/config.json')
    })

    it('should handle mixed slashes', () => {
      expect(normalizePath('/sea\\config/data\\file.txt')).toBe(
        '/sea/config/data/file.txt',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle empty path components', () => {
      // These would be normalized by the real implementation
      expect(getSeaAssetKey('/sea//config.json')).toBe('/config.json')
    })

    it('should handle special characters in filenames', () => {
      expect(getSeaAssetKey('/sea/file with spaces.txt')).toBe(
        'file with spaces.txt',
      )
      expect(getSeaAssetKey('/sea/file-name_v1.0.json')).toBe(
        'file-name_v1.0.json',
      )
      expect(getSeaAssetKey('/sea/émoji🎉.txt')).toBe('émoji🎉.txt')
    })

    it('should handle very long paths', () => {
      const longPath = `/sea/${'a'.repeat(1000)}.txt`
      expect(getSeaAssetKey(longPath)).toBe(`${'a'.repeat(1000)}.txt`)
    })

    it('should handle dots in filenames (not traversal)', () => {
      expect(getSeaAssetKey('/sea/.hidden')).toBe('.hidden')
      expect(getSeaAssetKey('/sea/file.tar.gz')).toBe('file.tar.gz')
      expect(getSeaAssetKey('/sea/..config')).toBe(null) // Contains ..
    })
  })

  describe('security', () => {
    it('should block all path traversal variations', () => {
      // Direct traversal
      expect(getSeaAssetKey('/sea/..')).toBe(null)
      expect(getSeaAssetKey('/sea/../')).toBe(null)
      expect(getSeaAssetKey('/sea/../etc/passwd')).toBe(null)

      // Traversal in middle of path
      expect(getSeaAssetKey('/sea/foo/../bar')).toBe(null)
      expect(getSeaAssetKey('/sea/a/b/../c')).toBe(null)

      // Multiple traversals
      expect(getSeaAssetKey('/sea/../../etc/passwd')).toBe(null)

      // Traversal with Windows separators
      expect(getSeaAssetKey('\\sea\\..\\etc\\passwd')).toBe(null)
    })

    it('should allow files starting with dots (not traversal)', () => {
      expect(getSeaAssetKey('/sea/.gitignore')).toBe('.gitignore')
      expect(getSeaAssetKey('/sea/.env')).toBe('.env')
      expect(getSeaAssetKey('/sea/dir/.hidden')).toBe('dir/.hidden')
    })
  })
})
