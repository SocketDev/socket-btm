/**
 * CLI Integration Tests for binject
 * Tests all command-line flags, help output, and user-facing workflows
 */

import { spawn } from 'node:child_process'
import { promises as fs, constants as FS_CONSTANTS } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const BINJECT_NAME = os.platform() === 'win32' ? 'binject.exe' : 'binject'
const BINJECT = path.join(PROJECT_ROOT, 'out', BINJECT_NAME)

let testDir

async function execCommand(command, args = []) {
  return new Promise(resolve => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({
        code,
        stdout,
        stderr,
        output: stdout + stderr,
      })
    })
  })
}

async function createTestBinary(name) {
  const filePath = path.join(testDir, name)
  let header

  // Create platform-specific binary headers
  if (os.platform() === 'darwin') {
    // Mach-O 64-bit x86_64 magic
    header = Buffer.from([0xcf, 0xfa, 0xed, 0xfe])
  } else if (os.platform() === 'linux') {
    // ELF 64-bit magic: 0x7f 'E' 'L' 'F'
    header = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00])
  } else if (os.platform() === 'win32') {
    // PE/COFF magic: 'M' 'Z' (DOS header)
    header = Buffer.from([0x4d, 0x5a])
  } else {
    // Unknown platform, create generic binary
    header = Buffer.from([0x00, 0x00, 0x00, 0x00])
  }

  const padding = Buffer.alloc(4096)
  await fs.writeFile(filePath, Buffer.concat([header, padding]))
  await fs.chmod(filePath, 0o755)
  return filePath
}

async function createTestResource(name) {
  const filePath = path.join(testDir, name)
  await fs.writeFile(filePath, 'Test resource data\n')
  return filePath
}

describe('binject CLI', () => {
  beforeAll(async () => {
    // Verify binject binary exists (should be built by CI setup script)
    try {
      await fs.access(BINJECT, FS_CONSTANTS.X_OK)
    } catch {
      throw new Error(
        `binject not found at ${BINJECT}. Run 'pnpm --filter binject build' first`,
      )
    }

    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-test-'))
  })

  afterAll(async () => {
    // Cleanup
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  describe('Help and Version', () => {
    it('--help should show Usage section', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('Usage:')
    })

    it('--help should show Commands section', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('Commands:')
    })

    it('--help should show Options section', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('Options:')
    })

    it('--help should document inject command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('inject')
    })

    it('--help should document list command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('list')
    })

    it('--help should document extract command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('extract')
    })

    it('--help should document verify command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('verify')
    })

    it('--help should document -e flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('-e')
    })

    it('--help should document --executable flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--executable')
    })

    it('--help should document -o flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('-o')
    })

    it('--help should document --output flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--output')
    })

    it('--help should document --sea flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--sea')
    })

    it('--help should document --vfs flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--vfs')
    })

    it('--help should document --vfs-in-memory flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--vfs-in-memory')
    })

    it('--help should document --vfs-on-disk flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--vfs-on-disk')
    })

    it('should accept both --vfs-on-disk and --vfs-in-memory flags together', async () => {
      const binary = await createTestBinary('test-both-flags.bin')
      const seaResource = await createTestResource('test-both.blob')
      const vfsResource = await createTestResource('test-both.tar')
      const output = path.join(testDir, 'output-both-flags.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs-on-disk',
        vfsResource,
        '--vfs-in-memory',
      ])

      // Should not error - both flags are valid together
      // On macOS (Mach-O), expect success; on other platforms, accept the unsupported message
      if (os.platform() === 'darwin') {
        expect(result.output).toMatch(/(Success|both)/i)
        await expect(
          fs.access(output, FS_CONSTANTS.F_OK),
        ).resolves.toBeUndefined()
      } else {
        expect(result.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })

    it('--version should show program name', async () => {
      const { output } = await execCommand(BINJECT, ['--version'])
      expect(output).toContain('binject')
    })

    it('--version should show version number', async () => {
      const { output } = await execCommand(BINJECT, ['--version'])
      // Accept both semver (1.2.3) and git-style (20251212-abc123) versions
      expect(output).toMatch(/([0-9]+\.[0-9]+\.[0-9]+|[0-9]+-[a-f0-9]+)/)
    })
  })

  describe('Argument Validation', () => {
    it('inject without args should show error', async () => {
      const result = await execCommand(BINJECT, ['inject'])
      expect(result.output).toContain('requires')
    })

    it('inject without --executable should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '--sea',
        'test.blob',
      ])
      expect(result.output).toContain('executable')
    })

    it('inject without --output should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        'test.bin',
        '--sea',
        'test.blob',
      ])
      expect(result.output).toContain('output')
    })

    it('inject without --sea or --vfs should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        'test.bin',
        '-o',
        'out.bin',
      ])
      expect(result.output).toMatch(/sea|vfs/)
    })

    it('inject with nonexistent executable should show error', async () => {
      const resource = await createTestResource('test.blob')
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        '/nonexistent/binary',
        '-o',
        'out.bin',
        '--sea',
        resource,
      ])
      expect(result.output).toMatch(/(not found|cannot open|error|unknown)/i)
    })

    it('inject with nonexistent resource should show error', async () => {
      const binary = await createTestBinary('test.bin')
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        'out.bin',
        '--sea',
        '/nonexistent/resource',
      ])
      expect(result.output).toMatch(/(not found|cannot open|error)/i)
    })
  })

  describe('Single Resource Injection', () => {
    it('--sea injection should create output file', async () => {
      const binary = await createTestBinary('test-sea.bin')
      const resource = await createTestResource('test.blob')
      const output = path.join(testDir, 'output-sea.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      // On macOS (Mach-O), expect success; on other platforms, accept the unsupported message
      if (os.platform() === 'darwin') {
        expect(result.output).toMatch(/(Success|injected)/i)
        await expect(
          fs.access(output, FS_CONSTANTS.F_OK),
        ).resolves.toBeUndefined()
      } else {
        expect(result.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })

    it('--vfs without --sea should show error', async () => {
      const binary = await createTestBinary('test-vfs-only.bin')
      const resource = await createTestResource('test.tar')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        path.join(testDir, 'out.bin'),
        '--vfs',
        resource,
      ])

      // Should error with helpful message about requiring --sea
      expect(result.code).not.toBe(0)
      expect(result.output).toMatch(/--vfs requires --sea/i)
      expect(result.output).toMatch(/Virtual File System.*alongside.*SEA/i)
    })
  })

  describe('Batch Injection', () => {
    it('batch injection (--sea + --vfs) should create output file', async () => {
      const binary = await createTestBinary('test-batch.bin')
      const seaResource = await createTestResource('test.blob')
      const vfsResource = await createTestResource('test.tar')
      const output = path.join(testDir, 'output-batch.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs',
        vfsResource,
      ])

      // On macOS (Mach-O), expect success; on other platforms, accept the unsupported message
      if (os.platform() === 'darwin') {
        expect(result.output).toMatch(/(Success|both)/i)
        await expect(
          fs.access(output, FS_CONSTANTS.F_OK),
        ).resolves.toBeUndefined()
      } else {
        expect(result.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })

    it('batch injection should modify binary', async () => {
      const binary = await createTestBinary('test-batch2.bin')
      const seaResource = await createTestResource('test2.blob')
      const vfsResource = await createTestResource('test2.tar')
      const output = path.join(testDir, 'output-batch2.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs',
        vfsResource,
      ])

      // On macOS (Mach-O), check that output is different from input
      if (os.platform() === 'darwin') {
        const inputData = await fs.readFile(binary)
        const outputData = await fs.readFile(output)
        expect(Buffer.compare(inputData, outputData)).not.toBe(0)
      } else {
        // On other platforms, verify the unsupported message is shown
        expect(result.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })
  })

  describe('Output Parameter', () => {
    it('inject without -o should show error about missing output', async () => {
      const binary = await createTestBinary('test-no-output.bin')
      const resource = await createTestResource('test.blob')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '--sea',
        resource,
      ])
      expect(result.output).toContain('output')
    })

    it('inject should create output in different directory', async () => {
      const binary = await createTestBinary('test-dir.bin')
      const resource = await createTestResource('test.blob')
      const subdir = path.join(testDir, 'subdir')
      await fs.mkdir(subdir, { recursive: true })
      const output = path.join(subdir, 'output.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      // On macOS (Mach-O), expect success; on other platforms, accept the unsupported message
      if (os.platform() === 'darwin') {
        expect(result.code).toBe(0)
        await expect(
          fs.access(output, FS_CONSTANTS.F_OK),
        ).resolves.toBeUndefined()
      } else {
        expect(result.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })
  })

  describe('Auto-Overwrite Behavior', () => {
    it('repeated injection should auto-overwrite', async () => {
      const binary = await createTestBinary('test-auto-overwrite.bin')
      const resource1 = await createTestResource('test1.blob')
      const resource2 = await createTestResource('test2.blob')

      // First injection
      const result1 = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource1,
      ])

      // On macOS (Mach-O), expect success
      if (os.platform() === 'darwin') {
        expect(result1.code).toBe(0)
        expect(result1.output).toMatch(/(Success|injected)/i)
      }

      // Second injection (should auto-overwrite)
      const result2 = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource2,
      ])

      // On macOS (Mach-O), expect auto-overwrite to succeed
      if (os.platform() === 'darwin') {
        expect(result2.code).toBe(0)
        expect(result2.output).toMatch(/(Success|injected)/i)
      } else {
        expect(result2.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })

    it('third injection should also auto-overwrite', async () => {
      const binary = await createTestBinary('test-auto-overwrite3.bin')
      const resource1 = await createTestResource('test-third-1.blob')
      const resource2 = await createTestResource('test-third-2.blob')
      const resource3 = await createTestResource('test-third-3.blob')

      if (os.platform() !== 'darwin') {
        // Skip on non-macOS
        return
      }

      // First injection
      await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource1,
      ])

      // Second injection
      await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource2,
      ])

      // Third injection - should still auto-overwrite
      const result3 = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource3,
      ])

      expect(result3.code).toBe(0)
      expect(result3.output).toMatch(/(Success|injected)/i)
    })
  })

  describe('List Command', () => {
    it('list command should run on binary', async () => {
      const binary = await createTestBinary('test-list.bin')

      const result = await execCommand(BINJECT, ['list', binary])
      expect(result.output).toMatch(/(Listing|resources|sections)/i)
    })
  })

  describe('Extract Command', () => {
    it('extract without section flag should show error', async () => {
      const binary = await createTestBinary('test-extract.bin')

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '-o',
        'output.blob',
      ])
      expect(result.output).toMatch(/(sea|vfs|either)/i)
    })

    it('extract without --output should show error', async () => {
      const binary = await createTestBinary('test-extract2.bin')

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '--sea',
      ])
      expect(result.output).toMatch(/output/i)
    })
  })

  describe('Verify Command', () => {
    it('verify without section flag should show error', async () => {
      const binary = await createTestBinary('test-verify.bin')

      const result = await execCommand(BINJECT, ['verify', '-e', binary])
      expect(result.output).toMatch(/(sea|vfs|either)/i)
    })
  })

  describe('Invalid Flag Combinations', () => {
    it('--sea and --vfs together should enable batch injection', async () => {
      const binary = await createTestBinary('test-flags.bin')
      const resource = await createTestResource('test.blob')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        path.join(testDir, 'out.bin'),
        '--sea',
        resource,
        '--vfs',
        resource,
      ])

      // On macOS (Mach-O), expect success; on other platforms, accept the unsupported message
      if (os.platform() === 'darwin') {
        expect(result.output).toMatch(/(Success|both|batch)/i)
      } else {
        expect(result.output).toMatch(
          /(Batch injection currently only supported for Mach-O|currently only supported)/i,
        )
      }
    })
  })
})
