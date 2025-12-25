/**
 * @fileoverview Tests for preflight-checks utilities.
 * Validates build environment validation and requirement checks.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  runPreflightChecks,
  runPreflightChecksOrExit,
} from '../lib/preflight-checks.mjs'

// Mock dependencies
vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    error: vi.fn(),
    log: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  }),
}))

vi.mock('../lib/build-helpers.mjs', () => ({
  checkCompiler: vi.fn(),
  checkDiskSpace: vi.fn(),
  checkPythonVersion: vi.fn(),
}))

vi.mock('../lib/build-output.mjs', () => ({
  printError: vi.fn(),
}))

vi.mock('../lib/version-helpers.mjs', () => ({
  getMinPythonVersion: vi.fn().mockReturnValue('3.6'),
}))

describe('preflight-checks', () => {
  let mockCheckDiskSpace
  let mockCheckCompiler
  let mockCheckPythonVersion

  beforeEach(async () => {
    vi.clearAllMocks()

    const buildHelpers = await import('../lib/build-helpers.mjs')
    mockCheckDiskSpace = buildHelpers.checkDiskSpace
    mockCheckCompiler = buildHelpers.checkCompiler
    mockCheckPythonVersion = buildHelpers.checkPythonVersion

    // Default: all checks pass
    mockCheckDiskSpace.mockResolvedValue({
      availableGB: 10,
      sufficient: true,
    })
    mockCheckCompiler.mockResolvedValue({ available: true })
    mockCheckPythonVersion.mockResolvedValue({ available: true })
  })

  describe('runPreflightChecks', () => {
    it('should pass when all checks succeed', async () => {
      const result = await runPreflightChecks({ quiet: true })

      expect(result.passed).toBe(true)
      expect(result.failures).toHaveLength(0)
    })

    it('should check disk space by default', async () => {
      await runPreflightChecks({ quiet: true })

      expect(mockCheckDiskSpace).toHaveBeenCalledWith('.', 5)
    })

    it('should use custom disk space requirement', async () => {
      await runPreflightChecks({ diskGB: 20, quiet: true })

      expect(mockCheckDiskSpace).toHaveBeenCalledWith('.', 20)
    })

    it('should skip disk check when disabled', async () => {
      await runPreflightChecks({ disk: false, quiet: true })

      expect(mockCheckDiskSpace).not.toHaveBeenCalled()
    })

    it('should fail when disk space insufficient', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 2,
        sufficient: false,
      })

      const result = await runPreflightChecks({ quiet: true })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]).toContain('Insufficient disk space')
      expect(result.failures[0]).toContain('2GB available')
      expect(result.failures[0]).toContain('5GB required')
    })

    it('should check compiler when enabled', async () => {
      await runPreflightChecks({ compiler: true, quiet: true })

      expect(mockCheckCompiler).toHaveBeenCalled()
    })

    it('should not check compiler by default', async () => {
      await runPreflightChecks({ quiet: true })

      expect(mockCheckCompiler).not.toHaveBeenCalled()
    })

    it('should fail when compiler not available', async () => {
      mockCheckCompiler.mockResolvedValue({ available: false })

      const result = await runPreflightChecks({ compiler: true, quiet: true })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]).toContain('No C++ compiler found')
    })

    it('should check specific compilers', async () => {
      await runPreflightChecks({
        compiler: true,
        compilers: ['gcc', 'clang'],
        quiet: true,
      })

      expect(mockCheckCompiler).toHaveBeenCalledWith(['gcc', 'clang'])
    })

    it('should check Python when enabled', async () => {
      await runPreflightChecks({ python: true, quiet: true })

      expect(mockCheckPythonVersion).toHaveBeenCalledWith('3.6')
    })

    it('should not check Python by default', async () => {
      await runPreflightChecks({ quiet: true })

      expect(mockCheckPythonVersion).not.toHaveBeenCalled()
    })

    it('should use custom Python version requirement', async () => {
      await runPreflightChecks({
        python: true,
        pythonVersion: '3.9',
        quiet: true,
      })

      expect(mockCheckPythonVersion).toHaveBeenCalledWith('3.9')
    })

    it('should fail when Python not available', async () => {
      mockCheckPythonVersion.mockResolvedValue({ available: false })

      const result = await runPreflightChecks({
        python: true,
        pythonVersion: '3.9',
        quiet: true,
      })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      expect(result.failures[0]).toContain('Python 3.9+ not found')
    })

    it('should collect multiple failures when failFast is false', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 2,
        sufficient: false,
      })
      mockCheckCompiler.mockResolvedValue({ available: false })
      mockCheckPythonVersion.mockResolvedValue({ available: false })

      const result = await runPreflightChecks({
        compiler: true,
        failFast: false,
        python: true,
        quiet: true,
      })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(3)
    })

    it('should stop on first failure when failFast is true', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 2,
        sufficient: false,
      })

      const result = await runPreflightChecks({
        compiler: true,
        failFast: true,
        python: true,
        quiet: true,
      })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      // Subsequent checks should not run
      expect(mockCheckCompiler).not.toHaveBeenCalled()
      expect(mockCheckPythonVersion).not.toHaveBeenCalled()
    })
  })

  describe('runPreflightChecksOrExit', () => {
    it('should not throw when checks pass', async () => {
      await expect(
        runPreflightChecksOrExit({ quiet: true }),
      ).resolves.not.toThrow()
    })

    it('should throw when checks fail', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 2,
        sufficient: false,
      })

      await expect(runPreflightChecksOrExit({ quiet: true })).rejects.toThrow(
        'Preflight checks failed',
      )
    })

    it('should throw with multiple failures', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 2,
        sufficient: false,
      })
      mockCheckCompiler.mockResolvedValue({ available: false })

      await expect(
        runPreflightChecksOrExit({
          compiler: true,
          failFast: false,
          quiet: true,
        }),
      ).rejects.toThrow('Preflight checks failed')
    })
  })

  describe('integration scenarios', () => {
    it('should validate typical ONNX Runtime build requirements', async () => {
      const result = await runPreflightChecks({
        compiler: true,
        diskGB: 10,
        python: true,
        pythonVersion: '3.8',
        quiet: true,
      })

      expect(mockCheckDiskSpace).toHaveBeenCalledWith('.', 10)
      expect(mockCheckCompiler).toHaveBeenCalled()
      expect(mockCheckPythonVersion).toHaveBeenCalledWith('3.8')
      expect(result.passed).toBe(true)
    })

    it('should validate typical Yoga Layout build requirements', async () => {
      const result = await runPreflightChecks({
        compiler: true,
        diskGB: 5,
        quiet: true,
      })

      expect(mockCheckDiskSpace).toHaveBeenCalledWith('.', 5)
      expect(mockCheckCompiler).toHaveBeenCalled()
      expect(result.passed).toBe(true)
    })

    it('should handle minimal disk space scenario', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 5.1,
        sufficient: true,
      })

      const result = await runPreflightChecks({ diskGB: 5, quiet: true })

      expect(result.passed).toBe(true)
    })

    it('should detect insufficient resources early', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 1,
        sufficient: false,
      })

      const result = await runPreflightChecks({
        compiler: true,
        failFast: true,
        python: true,
        quiet: true,
      })

      expect(result.passed).toBe(false)
      expect(result.failures).toHaveLength(1)
      // Should not check other resources due to failFast
      expect(mockCheckCompiler).not.toHaveBeenCalled()
    })
  })

  describe('edge cases', () => {
    it('should handle zero disk requirement', async () => {
      await runPreflightChecks({ diskGB: 0, quiet: true })

      expect(mockCheckDiskSpace).toHaveBeenCalledWith('.', 0)
    })

    it('should handle very large disk requirement', async () => {
      mockCheckDiskSpace.mockResolvedValue({
        availableGB: 50,
        sufficient: false,
      })

      const result = await runPreflightChecks({ diskGB: 100, quiet: true })

      expect(result.passed).toBe(false)
      expect(result.failures[0]).toContain('100GB required')
    })

    it('should handle single compiler string', async () => {
      await runPreflightChecks({
        compiler: true,
        compilers: 'gcc',
        quiet: true,
      })

      expect(mockCheckCompiler).toHaveBeenCalledWith('gcc')
    })

    it('should handle empty options', async () => {
      const result = await runPreflightChecks()

      expect(result.passed).toBe(true)
    })
  })
})
