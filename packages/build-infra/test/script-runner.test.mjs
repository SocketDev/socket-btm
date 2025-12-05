/**
 * @fileoverview Tests for script-runner utilities.
 * Validates pnpm script execution, command sequencing, and parallel execution.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  pnpm,
  runParallel,
  runPnpmScript,
  runPnpmScriptAll,
  runQuiet,
  runSequence,
} from '../lib/script-runner.mjs'

// Mock dependencies
vi.mock('@socketsecurity/lib/bin', () => ({
  which: vi.fn(),
}))

vi.mock('@socketsecurity/lib/spawn', () => ({
  default: {
    spawn: vi.fn(),
  },
}))

vi.mock('@socketsecurity/lib/logger', () => ({
  getDefaultLogger: () => ({
    error: vi.fn(),
    log: vi.fn(),
    step: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
  }),
}))

describe('script-runner', () => {
  let mockWhich
  let mockSpawn

  beforeEach(async () => {
    vi.clearAllMocks()

    const binModule = await import('@socketsecurity/lib/bin')
    const spawnModule = await import('@socketsecurity/lib/spawn')

    mockWhich = binModule.which
    mockSpawn = spawnModule.default.spawn

    // Default mock: pnpm is available
    mockWhich.mockResolvedValue('/usr/local/bin/pnpm')
  })

  describe('runPnpmScript', () => {
    it('should run pnpm script with package filter', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runPnpmScript('my-package', 'build')

      expect(mockWhich).toHaveBeenCalledWith('pnpm', { nothrow: true })
      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'build'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should pass additional arguments to script', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runPnpmScript('my-package', 'test', ['--coverage', '--watch'])

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'test', '--coverage', '--watch'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(null)

      await expect(runPnpmScript('my-package', 'build')).rejects.toThrow(
        'pnpm not found in PATH',
      )
    })

    it('should merge custom options', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runPnpmScript('my-package', 'build', [], {
        cwd: '/custom/path',
        env: { NODE_ENV: 'test' },
      })

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'build'],
        expect.objectContaining({
          cwd: '/custom/path',
          env: { NODE_ENV: 'test' },
          stdio: 'inherit',
        }),
      )
    })

    it('should return spawn result', async () => {
      const mockResult = { code: 0, stdout: 'Build completed' }
      mockSpawn.mockResolvedValue(mockResult)

      const result = await runPnpmScript('my-package', 'build')

      expect(result).toBe(mockResult)
    })
  })

  describe('runPnpmScriptAll', () => {
    it('should run script across all packages', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runPnpmScriptAll('test')

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['run', '-r', 'test'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should pass arguments to all packages', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runPnpmScriptAll('build', ['--prod'])

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['run', '-r', 'build', '--prod'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(null)

      await expect(runPnpmScriptAll('test')).rejects.toThrow(
        'pnpm not found in PATH',
      )
    })
  })

  describe('runSequence', () => {
    it('should run commands in sequence', async () => {
      mockSpawn
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 0 })

      const commands = [
        { command: 'echo', args: ['step1'] },
        { command: 'echo', args: ['step2'] },
        { command: 'echo', args: ['step3'] },
      ]

      const result = await runSequence(commands)

      expect(result).toBe(0)
      expect(mockSpawn).toHaveBeenCalledTimes(3)
    })

    it('should stop on first failure', async () => {
      mockSpawn
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 1 })
        .mockResolvedValueOnce({ code: 0 })

      const commands = [
        { command: 'echo', args: ['step1'] },
        { command: 'false' },
        { command: 'echo', args: ['step3'] },
      ]

      const result = await runSequence(commands)

      expect(result).toBe(1)
      // Third command not executed
      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })

    it('should use command descriptions if provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      const commands = [
        { command: 'echo', args: ['hello'], description: 'Say hello' },
      ]

      await runSequence(commands)

      expect(mockSpawn).toHaveBeenCalled()
    })

    it('should merge global options with command options', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      const commands = [
        {
          command: 'echo',
          args: ['test'],
          options: { env: { TEST: '1' } },
        },
      ]

      await runSequence(commands, { cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/tmp',
          env: { TEST: '1' },
        }),
      )
    })

    it('should handle commands without args', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      const commands = [{ command: 'pwd' }]

      await runSequence(commands)

      expect(mockSpawn).toHaveBeenCalledWith(
        'pwd',
        [],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })
  })

  describe('runParallel', () => {
    it('should run multiple commands in parallel', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      const commands = [
        { command: 'echo', args: ['task1'] },
        { command: 'echo', args: ['task2'] },
        { command: 'echo', args: ['task3'] },
      ]

      const results = await runParallel(commands)

      expect(results).toHaveLength(3)
      expect(mockSpawn).toHaveBeenCalledTimes(3)
      results.forEach(result => {
        expect(result.code).toBe(0)
      })
    })

    it('should wait for all commands to complete', async () => {
      mockSpawn
        .mockResolvedValueOnce({ code: 0 })
        .mockResolvedValueOnce({ code: 1 })
        .mockResolvedValueOnce({ code: 0 })

      const commands = [
        { command: 'echo', args: ['task1'] },
        { command: 'false' },
        { command: 'echo', args: ['task3'] },
      ]

      const results = await runParallel(commands)

      expect(results).toHaveLength(3)
      expect(results[0].code).toBe(0)
      expect(results[1].code).toBe(1)
      expect(results[2].code).toBe(0)
    })

    it('should merge global options', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      const commands = [{ command: 'echo', args: ['test'] }]

      await runParallel(commands, { cwd: '/tmp' })

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          cwd: '/tmp',
        }),
      )
    })
  })

  describe('runQuiet', () => {
    it('should run command with captured output', async () => {
      mockSpawn.mockResolvedValue({
        code: 0,
        stderr: '',
        stdout: 'output',
      })

      const result = await runQuiet('echo', ['test'])

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          shell: expect.anything(),
        }),
      )
      expect(result.stdout).toBe('output')
    })

    it('should not use inherit stdio', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runQuiet('echo', ['test'])

      const callArgs = mockSpawn.mock.calls[0][2]
      expect(callArgs.stdio).not.toBe('inherit')
    })

    it('should merge custom options', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await runQuiet('echo', ['test'], { env: { TEST: '1' } })

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo',
        ['test'],
        expect.objectContaining({
          env: { TEST: '1' },
        }),
      )
    })
  })

  describe('pnpm.install', () => {
    it('should run pnpm install with frozen lockfile', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.install()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['install', '--frozen-lockfile'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(null)

      await expect(pnpm.install()).rejects.toThrow('pnpm not found in PATH')
    })
  })

  describe('pnpm.build', () => {
    it('should build all packages when no package name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.build()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['run', '-r', 'build'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should build specific package when name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.build('my-package')

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'build'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(null)

      await expect(pnpm.build()).rejects.toThrow('pnpm not found in PATH')
    })
  })

  describe('pnpm.test', () => {
    it('should run tests in all packages when no package name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.test()

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['run', '-r', 'test'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should run tests in specific package when name provided', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.test('my-package')

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/pnpm',
        ['--filter', 'my-package', 'run', 'test'],
        expect.objectContaining({
          stdio: 'inherit',
        }),
      )
    })

    it('should throw error if pnpm not found', async () => {
      mockWhich.mockResolvedValue(null)

      await expect(pnpm.test()).rejects.toThrow('pnpm not found in PATH')
    })
  })

  describe('integration scenarios', () => {
    it('should handle typical monorepo workflow', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      // Install dependencies
      await pnpm.install()

      // Build all packages
      await pnpm.build()

      // Run tests
      await pnpm.test()

      expect(mockSpawn).toHaveBeenCalledTimes(3)
    })

    it('should handle package-specific build and test', async () => {
      mockSpawn.mockResolvedValue({ code: 0 })

      await pnpm.build('onnxruntime-builder')
      await pnpm.test('onnxruntime-builder')

      expect(mockSpawn).toHaveBeenCalledTimes(2)
      expect(mockSpawn).toHaveBeenNthCalledWith(
        1,
        '/usr/local/bin/pnpm',
        ['--filter', 'onnxruntime-builder', 'run', 'build'],
        expect.anything(),
      )
      expect(mockSpawn).toHaveBeenNthCalledWith(
        2,
        '/usr/local/bin/pnpm',
        ['--filter', 'onnxruntime-builder', 'run', 'test'],
        expect.anything(),
      )
    })
  })
})
