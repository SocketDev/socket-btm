/**
 * @fileoverview Target flag tests for binpress
 *
 * Tests target flag parsing and platform normalization:
 * 1. Combined --target flag (e.g., linux-x64-musl)
 * 2. Individual --target-platform, --target-arch, --target-libc flags
 * 3. Platform normalization: win → win32 (input to internal)
 * 4. Asset naming: win32 → win (internal to GitHub releases)
 *
 * These tests ensure:
 * - Target flags correctly override auto-detection
 * - Combined and individual flag formats work equivalently
 * - Platform naming consistency (win32 internal, win for assets)
 * - Cross-compilation scenarios work correctly
 */

import { spawn } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import {
  getPlatformArch,
  getAssetPlatformArch,
} from 'build-infra/lib/platform-mappings'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')

// Determine build mode
const BUILD_MODE = getBuildMode()

// Get binpress binary path
const BINPRESS_NAME = process.platform === 'win32' ? 'binpress.exe' : 'binpress'
const BINPRESS = path.join(
  PACKAGE_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  BINPRESS_NAME,
)

let testDir: string

/**
 * Execute command and return result
 */
async function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stdout, stderr })
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

beforeAll(async () => {
  testDir = path.join(os.tmpdir(), `binpress-target-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!existsSync(BINPRESS))('Binpress target flags', () => {
  describe('Combined --target flag', () => {
    it('should accept --target with platform-arch format', async () => {
      const inputBinary = path.join(testDir, 'target_combined_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'target_combined_output')

      // Test combined target format
      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target',
        'linux-x64',
      ])

      // All binpress builds should have linux stubs for cross-compilation
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target: linux-x64')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept --target with platform-arch-libc format', async () => {
      const inputBinary = path.join(testDir, 'target_libc_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'target_libc_output')

      // Test combined target with libc
      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target',
        'linux-x64-musl',
      ])

      // All binpress builds should have linux-musl stubs for cross-compilation
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target: linux-x64-musl')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept --target with darwin platform', async () => {
      const inputBinary = path.join(testDir, 'target_darwin_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'target_darwin_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target',
        'darwin-arm64',
      ])

      // All binpress builds should have darwin stubs for cross-compilation
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target: darwin-arm64')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept --target with win32 platform', async () => {
      const inputBinary = path.join(testDir, 'target_win32_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'target_win32_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target',
        'win32-x64',
      ])

      // All binpress builds should have win32 stubs for cross-compilation
      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target: win32-x64')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)
  })

  describe('Individual target flags', () => {
    it('should accept --target-platform and --target-arch', async () => {
      const inputBinary = path.join(testDir, 'individual_basic_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'individual_basic_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target-platform',
        'linux',
        '--target-arch',
        'x64',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target platform: linux')
      expect(result.stdout).toContain('Target arch: x64')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept --target-libc with Linux platform', async () => {
      const inputBinary = path.join(testDir, 'individual_libc_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'individual_libc_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target-platform',
        'linux',
        '--target-arch',
        'x64',
        '--target-libc',
        'musl',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target platform: linux')
      expect(result.stdout).toContain('Target arch: x64')
      expect(result.stdout).toContain('Target libc: musl')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept all three individual flags together', async () => {
      const inputBinary = path.join(testDir, 'individual_all_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'individual_all_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target-platform',
        'linux',
        '--target-arch',
        'arm64',
        '--target-libc',
        'glibc',
      ])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Target platform: linux')
      expect(result.stdout).toContain('Target arch: arm64')
      expect(result.stdout).toContain('Target libc: glibc')
      expect(result.stderr).not.toContain('Failed to parse')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)
  })

  describe('Platform normalization: win → win32', () => {
    it('should accept "win" as platform and normalize to win32 internally', async () => {
      const inputBinary = path.join(testDir, 'win_normalize_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'win_normalize_output')

      // Test with "win" as input (should normalize to "win32")
      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target',
        'win-x64',
      ])

      // binpress should accept "win" as input
      expect(result.stdout).toContain('Target: win-x64')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept "win32" as platform directly', async () => {
      const inputBinary = path.join(testDir, 'win32_direct_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'win32_direct_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target',
        'win32-x64',
      ])

      expect(result.stdout).toContain('Target: win32-x64')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)

    it('should accept "win" via --target-platform flag', async () => {
      const inputBinary = path.join(testDir, 'win_flag_input')
      await fs.copyFile(BINPRESS, inputBinary)

      const output = path.join(testDir, 'win_flag_output')

      const result = await execCommand(BINPRESS, [
        inputBinary,
        '--output',
        output,
        '--target-platform',
        'win',
        '--target-arch',
        'x64',
      ])

      // Should accept "win" as platform
      expect(result.stdout).toContain('Target platform: win')
      expect(result.stderr).not.toContain('Unexpected argument')
    }, 30_000)
  })

  describe('Help and version', () => {
    it('should show target flags in --help output', async () => {
      const result = await execCommand(BINPRESS, ['--help'])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('--target')
      expect(result.stdout).toContain('--target-platform')
      expect(result.stdout).toContain('--target-arch')
      expect(result.stdout).toContain('--target-libc')
      // Should show example with target flags
      expect(result.stdout).toContain('linux-x64-musl')
    }, 10_000)
  })
})

describe('Platform mapping functions', () => {
  describe('getPlatformArch() - Internal naming', () => {
    it('should use win32 for Windows platform', () => {
      const result = getPlatformArch('win32', 'x64')
      expect(result).toBe('win32-x64')
    })

    it('should use darwin for macOS platform', () => {
      const result = getPlatformArch('darwin', 'arm64')
      expect(result).toBe('darwin-arm64')
    })

    it('should use linux for Linux platform', () => {
      const result = getPlatformArch('linux', 'x64')
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
      const result = getPlatformArch('win32', 'ia32')
      expect(result).toBe('win32-x86')
    })

    it('should throw error for unsupported platform', () => {
      expect(() => getPlatformArch('win', 'x64')).toThrow(
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
    it('should normalize win32 → win for Windows assets', () => {
      const result = getAssetPlatformArch('win32', 'x64')
      expect(result).toBe('win-x64')
    })

    it('should use darwin for macOS assets', () => {
      const result = getAssetPlatformArch('darwin', 'arm64')
      expect(result).toBe('darwin-arm64')
    })

    it('should use linux for Linux assets', () => {
      const result = getAssetPlatformArch('linux', 'x64')
      expect(result).toBe('linux-x64')
    })

    it('should append -musl suffix for Linux musl assets', () => {
      const result = getAssetPlatformArch('linux', 'x64', 'musl')
      expect(result).toBe('linux-x64-musl')
    })

    it('should normalize win32 → win with arm64', () => {
      const result = getAssetPlatformArch('win32', 'arm64')
      expect(result).toBe('win-arm64')
    })

    it('should handle ia32 architecture in assets', () => {
      const result = getAssetPlatformArch('win32', 'ia32')
      expect(result).toBe('win-x86')
    })

    it('should throw error for unsupported platform', () => {
      expect(() => getAssetPlatformArch('windows', 'x64')).toThrow(
        'Unsupported platform/arch',
      )
    })

    it('should throw error for libc on non-Linux platform', () => {
      expect(() => getAssetPlatformArch('win32', 'x64', 'musl')).toThrow(
        'libc parameter is only valid for Linux',
      )
    })
  })

  describe('Platform naming consistency', () => {
    it('should demonstrate win32 internal vs win asset naming', () => {
      // Internal naming uses win32
      const internal = getPlatformArch('win32', 'x64')
      expect(internal).toBe('win32-x64')

      // Asset naming uses win
      const asset = getAssetPlatformArch('win32', 'x64')
      expect(asset).toBe('win-x64')

      // Both work with same input platform
      expect(internal).not.toBe(asset)
      expect(internal).toContain('win32')
      expect(asset).toContain('win')
    })

    it('should demonstrate consistent naming for non-Windows platforms', () => {
      // Linux and darwin use same names for both internal and asset
      const linuxInternal = getPlatformArch('linux', 'x64')
      const linuxAsset = getAssetPlatformArch('linux', 'x64')
      expect(linuxInternal).toBe(linuxAsset)
      expect(linuxInternal).toBe('linux-x64')

      const darwinInternal = getPlatformArch('darwin', 'arm64')
      const darwinAsset = getAssetPlatformArch('darwin', 'arm64')
      expect(darwinInternal).toBe(darwinAsset)
      expect(darwinInternal).toBe('darwin-arm64')
    })

    it('should demonstrate musl suffix applies to both internal and asset', () => {
      const internal = getPlatformArch('linux', 'x64', 'musl')
      const asset = getAssetPlatformArch('linux', 'x64', 'musl')

      expect(internal).toBe('linux-x64-musl')
      expect(asset).toBe('linux-x64-musl')
      // Both should have musl suffix
      expect(internal).toBe(asset)
    })
  })
})
