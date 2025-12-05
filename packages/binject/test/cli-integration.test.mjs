/**
 * CLI Integration Tests for binject
 * Tests all command-line flags, help output, and user-facing workflows
 */

import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
  chmod,
  access,
  constants,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const PROJECT_ROOT = join(__dirname, '..')
const BINJECT = join(PROJECT_ROOT, 'out', 'binject')

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
  const path = join(testDir, name)
  // Create a minimal Mach-O binary (64-bit arm64 magic)
  const header = Buffer.from([0xcf, 0xfa, 0xed, 0xfe])
  const padding = Buffer.alloc(4096)
  await writeFile(path, Buffer.concat([header, padding]))
  await chmod(path, 0o755)
  return path
}

async function createTestResource(name) {
  const path = join(testDir, name)
  await writeFile(path, 'Test resource data\n')
  return path
}

describe('binject CLI', () => {
  beforeAll(async () => {
    // Verify binject binary exists (should be built by CI setup script)
    try {
      await access(BINJECT, constants.X_OK)
    } catch {
      throw new Error(
        `binject not found at ${BINJECT}. Run 'pnpm --filter binject build' first`,
      )
    }

    // Create temporary test directory
    testDir = await mkdtemp(join(tmpdir(), 'binject-test-'))
  })

  afterAll(async () => {
    // Cleanup
    if (testDir) {
      await rm(testDir, { recursive: true, force: true })
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

    it('--help should document --overwrite flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--overwrite')
    })

    it('--help should document --no-compress flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--no-compress')
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
      const output = join(testDir, 'output-sea.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      expect(result.output).toMatch(/(Success|injected)/i)
      await expect(access(output, constants.F_OK)).resolves.toBeUndefined()
    })

    it('--vfs without --sea should work or show helpful message', async () => {
      const binary = await createTestBinary('test-vfs-only.bin')
      const resource = await createTestResource('test.tar')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        join(testDir, 'out.bin'),
        '--vfs',
        resource,
      ])

      // Accept either: works, or shows helpful message about needing SEA
      const hasHelpfulMessage = /(requires|needs|with).*sea/i.test(
        result.output,
      )
      const succeeded = /(Success|injected)/i.test(result.output)
      expect(hasHelpfulMessage || succeeded).toBe(true)
    })
  })

  describe('Batch Injection', () => {
    it('batch injection (--sea + --vfs) should create output file', async () => {
      const binary = await createTestBinary('test-batch.bin')
      const seaResource = await createTestResource('test.blob')
      const vfsResource = await createTestResource('test.tar')
      const output = join(testDir, 'output-batch.bin')

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

      expect(result.output).toMatch(/(Success|both)/i)
      await expect(access(output, constants.F_OK)).resolves.toBeUndefined()
    })

    it('batch injection should modify binary', async () => {
      const binary = await createTestBinary('test-batch2.bin')
      const seaResource = await createTestResource('test2.blob')
      const vfsResource = await createTestResource('test2.tar')
      const output = join(testDir, 'output-batch2.bin')

      await execCommand(BINJECT, [
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

      // Check that output is different from input
      const inputData = await readFile(binary)
      const outputData = await readFile(output)
      expect(Buffer.compare(inputData, outputData)).not.toBe(0)
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
      const subdir = join(testDir, 'subdir')
      await mkdir(subdir, { recursive: true })
      const output = join(subdir, 'output.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      expect(result.code).toBe(0)
      await expect(access(output, constants.F_OK)).resolves.toBeUndefined()
    })
  })

  describe('Overwrite Flag', () => {
    it('inject without --overwrite should warn about existing resources', async () => {
      const binary = await createTestBinary('test-overwrite.bin')
      const resource = await createTestResource('test.blob')

      // First injection
      await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource,
      ])

      // Second injection without --overwrite
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource,
      ])

      const hasWarning = /(already exists|overwrite)/i.test(result.output)
      const succeeded = /(Success)/i.test(result.output)
      expect(hasWarning || succeeded).toBe(true)
    })

    it('inject with --overwrite should allow re-injection', async () => {
      const binary = await createTestBinary('test-overwrite2.bin')
      const resource = await createTestResource('test.blob')

      // First injection
      await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource,
        '--overwrite',
      ])

      // Second injection with --overwrite
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        binary,
        '--sea',
        resource,
        '--overwrite',
      ])

      expect(result.output).toMatch(/(Success|injected)/i)
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
        join(testDir, 'out.bin'),
        '--sea',
        resource,
        '--vfs',
        resource,
      ])

      expect(result.output).toMatch(/(Success|both|batch)/i)
    })
  })
})
