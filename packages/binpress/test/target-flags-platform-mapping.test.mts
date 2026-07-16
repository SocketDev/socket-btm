import { describe, expect, it } from 'vitest'

/**
 * @file Platform mapping function tests for binpress.
 *   Tests getPlatformArch() and getAssetPlatformArch() directly.
 *   Split from target-flags.test.mts.
 */

import {
  getAssetPlatformArch,
  getPlatformArch,
} from 'build-infra/lib/platform-mappings'

describe('platform mapping functions', () => {
  describe('getPlatformArch() - Internal naming', () => {
    it('should use win32 for Windows platform', () => {
      const result = getPlatformArch('win32', 'x64', undefined)
      expect(result).toBe('win32-x64')
    })

    it('should use darwin for macOS platform', () => {
      const result = getPlatformArch('darwin', 'arm64', undefined)
      expect(result).toBe('darwin-arm64')
    })

    it('should use linux for Linux platform', () => {
      const result = getPlatformArch('linux', 'x64', undefined)
      expect(result).toBe('linux-x64')
    })

    it('should append -musl suffix for Linux musl builds', () => {
      const result = getPlatformArch('linux', 'x64', 'musl')
      expect(result).toBe('linux-x64-musl')
    })

    it('should not append suffix for Linux glibc builds', () => {
      const result = getPlatformArch('linux', 'x64', 'glibc')
      expect(result).toBe('linux-x64')
    })

    it('should handle ia32 architecture', () => {
      const result = getPlatformArch('win32', 'ia32', undefined)
      expect(result).toBe('win32-x86')
    })

    it('should throw error for unsupported platform', () => {
      expect(() => getPlatformArch('win', 'x64', undefined)).toThrow(
        'Unsupported platform',
      )
    })

    it('should throw error for libc on non-Linux platform', () => {
      expect(() => getPlatformArch('win32', 'x64', 'musl')).toThrow(
        'libc parameter is only valid for Linux',
      )
    })
  })

  describe('getAssetPlatformArch() - Asset naming', () => {
    it('should use win32 for Windows assets (pack-app convention)', () => {
      const result = getAssetPlatformArch('win32', 'x64', undefined)
      expect(result).toBe('win32-x64')
    })

    it('should use darwin for macOS assets', () => {
      const result = getAssetPlatformArch('darwin', 'arm64', undefined)
      expect(result).toBe('darwin-arm64')
    })

    it('should use linux for Linux assets', () => {
      const result = getAssetPlatformArch('linux', 'x64', undefined)
      expect(result).toBe('linux-x64')
    })

    it('should append -musl suffix for Linux musl assets', () => {
      const result = getAssetPlatformArch('linux', 'x64', 'musl')
      expect(result).toBe('linux-x64-musl')
    })

    it('should use win32 with arm64', () => {
      const result = getAssetPlatformArch('win32', 'arm64', undefined)
      expect(result).toBe('win32-arm64')
    })

    it('should handle ia32 architecture in assets', () => {
      const result = getAssetPlatformArch('win32', 'ia32', undefined)
      expect(result).toBe('win32-x86')
    })

    it('should throw error for unsupported platform', () => {
      expect(() => getAssetPlatformArch('windows', 'x64', undefined)).toThrow(
        'Unsupported platform/arch',
      )
    })

    it('should throw error for libc on non-Linux platform', () => {
      expect(() => getAssetPlatformArch('win32', 'x64', 'musl')).toThrow(
        'libc parameter is only valid for Linux',
      )
    })
  })

  describe('platform naming consistency', () => {
    it('should use the same name for internal + asset (pack-app convention)', () => {
      const internal = getPlatformArch('win32', 'x64', undefined)
      expect(internal).toBe('win32-x64')

      const asset = getAssetPlatformArch('win32', 'x64', undefined)
      expect(asset).toBe('win32-x64')

      expect(internal).toBe(asset)
    })

    it('should demonstrate consistent naming for non-Windows platforms', () => {
      const linuxInternal = getPlatformArch('linux', 'x64', undefined)
      const linuxAsset = getAssetPlatformArch('linux', 'x64', undefined)
      expect(linuxInternal).toBe(linuxAsset)
      expect(linuxInternal).toBe('linux-x64')

      const darwinInternal = getPlatformArch('darwin', 'arm64', undefined)
      const darwinAsset = getAssetPlatformArch('darwin', 'arm64', undefined)
      expect(darwinInternal).toBe(darwinAsset)
      expect(darwinInternal).toBe('darwin-arm64')
    })

    it('should demonstrate musl suffix applies to both internal and asset', () => {
      const internal = getPlatformArch('linux', 'x64', 'musl')
      const asset = getAssetPlatformArch('linux', 'x64', 'musl')

      expect(internal).toBe('linux-x64-musl')
      expect(asset).toBe('linux-x64-musl')
      expect(internal).toBe(asset)
    })
  })
})
