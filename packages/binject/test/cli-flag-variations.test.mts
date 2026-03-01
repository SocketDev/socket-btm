/**
 * @fileoverview CLI flag variation tests for binject
 *
 * Tests all commands (inject, list, extract, verify) with both short and long flag forms.
 * Uses parameterized tests to ensure both `-e`/`--executable` and `-o`/`--output` work correctly.
 *
 * Commands tested:
 * - inject: Test with -e/-o, --executable/--output, and mixed forms
 * - list: Test with executable as positional arg
 * - extract: Test with -e/-o, --executable/--output, and mixed forms
 * - verify: Test with -e/--executable
 * - --help: Test help flag
 * - --version: Test version flag
 */

import { spawn } from 'node:child_process'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import { getBinjectPath } from './helpers/paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()

let testDir: string
const binjectExists = existsSync(BINJECT)

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
  if (!binjectExists) {
    return
  }

  testDir = path.join(os.tmpdir(), `binject-flags-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists)('CLI flag variations', () => {
  describe('inject command', () => {
    // Test matrix: [executableFlag, outputFlag, description]
    const flagCombinations = [
      ['-e', '-o', 'short forms'],
      ['--executable', '--output', 'long forms'],
      ['-e', '--output', 'mixed: short executable, long output'],
      ['--executable', '-o', 'mixed: long executable, short output'],
    ]

    flagCombinations.forEach(([execFlag, outFlag, description]) => {
      it(`should inject SEA blob using ${description}`, async () => {
        const inputBinary = path.join(
          testDir,
          `inject-${execFlag}-${outFlag}-input`,
        )
        await fs.copyFile(BINJECT, inputBinary)

        const seaBlob = path.join(testDir, `inject-${execFlag}-${outFlag}.blob`)
        await fs.writeFile(seaBlob, Buffer.from('test content'))

        const outputBinary = path.join(
          testDir,
          `inject-${execFlag}-${outFlag}-output`,
        )

        const result = await execCommand(BINJECT, [
          'inject',
          execFlag,
          inputBinary,
          outFlag,
          outputBinary,
          '--sea',
          seaBlob,
        ])

        expect(result.code).toBe(0)
        expect(existsSync(outputBinary)).toBe(true)

        // Verify binary is still executable
        const stats = await fs.stat(outputBinary)
        expect(stats.mode & 0o111).not.toBe(0)
      }, 30_000)
    })

    it('should inject VFS with SEA using short forms', async () => {
      const inputBinary = path.join(testDir, 'vfs-short-input')
      await fs.copyFile(BINJECT, inputBinary)

      const seaBlob = path.join(testDir, 'vfs-short.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const vfsArchive = path.join(testDir, 'vfs-short.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('vfs content'))

      const outputBinary = path.join(testDir, 'vfs-short-output')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        inputBinary,
        '-o',
        outputBinary,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
      ])

      expect(result.code).toBe(0)
      expect(existsSync(outputBinary)).toBe(true)
    }, 30_000)

    it('should inject VFS with SEA using long forms', async () => {
      const inputBinary = path.join(testDir, 'vfs-long-input')
      await fs.copyFile(BINJECT, inputBinary)

      const seaBlob = path.join(testDir, 'vfs-long.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const vfsArchive = path.join(testDir, 'vfs-long.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('vfs content'))

      const outputBinary = path.join(testDir, 'vfs-long-output')

      const result = await execCommand(BINJECT, [
        'inject',
        '--executable',
        inputBinary,
        '--output',
        outputBinary,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
      ])

      expect(result.code).toBe(0)
      expect(existsSync(outputBinary)).toBe(true)
    }, 30_000)
  })

  describe('list command', () => {
    it('should list resources (no flags, just positional arg)', async () => {
      const binary = path.join(testDir, 'list-test')
      await fs.copyFile(BINJECT, binary)

      const result = await execCommand(BINJECT, ['list', binary])

      expect(result.code).toBe(0)
      // Output should contain some metadata
      expect(result.stdout.length).toBeGreaterThan(0)
    })

    it('should handle list on non-existent file', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist')

      const result = await execCommand(BINJECT, ['list', nonExistent])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })
  })

  describe('extract command', () => {
    // First inject resources to extract
    let binaryWithSea: string
    let binaryWithVfs: string

    beforeAll(async () => {
      if (!binjectExists) {
        return
      }

      // Create binary with SEA
      const inputSea = path.join(testDir, 'extract-sea-input')
      await fs.copyFile(BINJECT, inputSea)

      const seaBlob = path.join(testDir, 'extract-test.blob')
      await fs.writeFile(seaBlob, Buffer.from('EXTRACT_TEST_CONTENT'))

      binaryWithSea = path.join(testDir, 'binary-with-sea')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        inputSea,
        '-o',
        binaryWithSea,
        '--sea',
        seaBlob,
      ])

      // Create binary with VFS
      const inputVfs = path.join(testDir, 'extract-vfs-input')
      await fs.copyFile(BINJECT, inputVfs)

      const seaBlobVfs = path.join(testDir, 'extract-vfs.blob')
      await fs.writeFile(seaBlobVfs, Buffer.from('test'))

      const vfsArchive = path.join(testDir, 'extract-test.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('EXTRACT_VFS_CONTENT'))

      binaryWithVfs = path.join(testDir, 'binary-with-vfs')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        inputVfs,
        '-o',
        binaryWithVfs,
        '--sea',
        seaBlobVfs,
        '--vfs',
        vfsArchive,
      ])
    })

    const flagCombinations = [
      ['-e', '-o', 'short forms'],
      ['--executable', '--output', 'long forms'],
      ['-e', '--output', 'mixed: short executable, long output'],
      ['--executable', '-o', 'mixed: long executable, short output'],
    ]

    flagCombinations.forEach(([execFlag, outFlag, description]) => {
      it(`should extract SEA blob using ${description}`, async () => {
        const extractedSea = path.join(
          testDir,
          `extracted-sea-${execFlag}-${outFlag}.blob`,
        )

        const result = await execCommand(BINJECT, [
          'extract',
          execFlag,
          binaryWithSea,
          outFlag,
          extractedSea,
          '--sea',
        ])

        expect(result.code).toBe(0)
        expect(existsSync(extractedSea)).toBe(true)

        const content = await fs.readFile(extractedSea, 'utf8')
        expect(content).toBe('EXTRACT_TEST_CONTENT')
      }, 30_000)

      it(`should extract VFS archive using ${description}`, async () => {
        const extractedVfs = path.join(
          testDir,
          `extracted-vfs-${execFlag}-${outFlag}.vfs`,
        )

        const result = await execCommand(BINJECT, [
          'extract',
          execFlag,
          binaryWithVfs,
          outFlag,
          extractedVfs,
          '--vfs',
        ])

        expect(result.code).toBe(0)
        expect(existsSync(extractedVfs)).toBe(true)

        // VFS is stored as compressed tar.gz, so check it's a valid archive
        const content = await fs.readFile(extractedVfs)
        // Gzip magic number: 0x1f 0x8b
        expect(content[0]).toBe(0x1f)
        expect(content[1]).toBe(0x8b)
      }, 30_000)
    })
  })

  describe('verify command', () => {
    let binaryWithSea: string
    let binaryWithVfs: string

    beforeAll(async () => {
      if (!binjectExists) {
        return
      }

      // Create binary with SEA
      const inputSea = path.join(testDir, 'verify-sea-input')
      await fs.copyFile(BINJECT, inputSea)

      const seaBlob = path.join(testDir, 'verify-test.blob')
      await fs.writeFile(seaBlob, Buffer.from('VERIFY_TEST_CONTENT'))

      binaryWithSea = path.join(testDir, 'verify-binary-with-sea')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        inputSea,
        '-o',
        binaryWithSea,
        '--sea',
        seaBlob,
      ])

      // Create binary with VFS
      const inputVfs = path.join(testDir, 'verify-vfs-input')
      await fs.copyFile(BINJECT, inputVfs)

      const seaBlobVfs = path.join(testDir, 'verify-vfs.blob')
      await fs.writeFile(seaBlobVfs, Buffer.from('test'))

      const vfsArchive = path.join(testDir, 'verify-test.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('VERIFY_VFS_CONTENT'))

      binaryWithVfs = path.join(testDir, 'verify-binary-with-vfs')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        inputVfs,
        '-o',
        binaryWithVfs,
        '--sea',
        seaBlobVfs,
        '--vfs',
        vfsArchive,
      ])
    })

    const execFlags = [
      ['-e', 'short form'],
      ['--executable', 'long form'],
    ]

    execFlags.forEach(([execFlag, description]) => {
      it(`should verify SEA blob using ${description}`, async () => {
        const result = await execCommand(BINJECT, [
          'verify',
          execFlag,
          binaryWithSea,
          '--sea',
        ])

        expect(result.code).toBe(0)
      }, 30_000)

      it(`should verify VFS archive using ${description}`, async () => {
        const result = await execCommand(BINJECT, [
          'verify',
          execFlag,
          binaryWithVfs,
          '--vfs',
        ])

        expect(result.code).toBe(0)
      }, 30_000)
    })

    it('should fail verification when resource does not exist (short form)', async () => {
      const binaryWithoutSea = path.join(testDir, 'verify-no-sea')
      await fs.copyFile(BINJECT, binaryWithoutSea)

      const result = await execCommand(BINJECT, [
        'verify',
        '-e',
        binaryWithoutSea,
        '--sea',
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })

    it('should fail verification when resource does not exist (long form)', async () => {
      const binaryWithoutVfs = path.join(testDir, 'verify-no-vfs')
      await fs.copyFile(BINJECT, binaryWithoutVfs)

      const result = await execCommand(BINJECT, [
        'verify',
        '--executable',
        binaryWithoutVfs,
        '--vfs',
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toBeTruthy()
    })
  })

  describe('--help flag', () => {
    it('should show help with --help', async () => {
      const result = await execCommand(BINJECT, ['--help'])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stdout).toContain('Commands:')
      expect(result.stdout).toContain('inject')
      expect(result.stdout).toContain('list')
      expect(result.stdout).toContain('extract')
      expect(result.stdout).toContain('verify')
    })

    it('should show help with -h', async () => {
      const result = await execCommand(BINJECT, ['-h'])

      expect(result.code).toBe(0)
      expect(result.stdout).toContain('Usage:')
      expect(result.stdout).toContain('Commands:')
    })

    it('should document both -e and --executable', async () => {
      const result = await execCommand(BINJECT, ['--help'])

      expect(result.stdout).toContain('-e')
      expect(result.stdout).toContain('--executable')
    })

    it('should document both -o and --output', async () => {
      const result = await execCommand(BINJECT, ['--help'])

      expect(result.stdout).toContain('-o')
      expect(result.stdout).toContain('--output')
    })
  })

  describe('--version flag', () => {
    it('should show version with --version', async () => {
      const result = await execCommand(BINJECT, ['--version'])

      expect(result.code).toBe(0)
      // Version format: binject YYYYMMDD-commithash or binject X.Y.Z
      expect(result.stdout).toMatch(/binject (\d+\.\d+\.\d+|\d{8}-[a-f0-9]+)/)
    })

    it('should show version with -v', async () => {
      const result = await execCommand(BINJECT, ['-v'])

      expect(result.code).toBe(0)
      // Version format: binject YYYYMMDD-commithash or binject X.Y.Z
      expect(result.stdout).toMatch(/binject (\d+\.\d+\.\d+|\d{8}-[a-f0-9]+)/)
    })
  })

  describe('Error handling for flag variations', () => {
    it('should reject inject without -e/--executable', async () => {
      const seaBlob = path.join(testDir, 'error-test.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const output = path.join(testDir, 'error-output')

      const result = await execCommand(BINJECT, [
        'inject',
        '-o',
        output,
        '--sea',
        seaBlob,
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('executable')
    })

    it('should reject inject without -o/--output', async () => {
      const input = path.join(testDir, 'error-input')
      await fs.copyFile(BINJECT, input)

      const seaBlob = path.join(testDir, 'error-test2.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        input,
        '--sea',
        seaBlob,
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('output')
    })

    it('should reject extract without -e/--executable', async () => {
      const output = path.join(testDir, 'extract-error-output')

      const result = await execCommand(BINJECT, [
        'extract',
        '-o',
        output,
        '--sea',
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('executable')
    })

    it('should reject extract without -o/--output', async () => {
      const binary = path.join(testDir, 'extract-error-binary')
      await fs.copyFile(BINJECT, binary)

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '--sea',
      ])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('output')
    })

    it('should reject verify without -e/--executable', async () => {
      const result = await execCommand(BINJECT, ['verify', '--sea'])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toContain('executable')
    })
  })
})
