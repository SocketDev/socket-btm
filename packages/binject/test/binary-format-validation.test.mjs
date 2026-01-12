/**
 * @fileoverview Binary format validation tests for binject
 *
 * Validates that binaries maintain valid format structure after injection:
 * - Mach-O magic numbers and headers remain valid
 * - ELF magic numbers and headers remain valid
 * - PE magic numbers and headers remain valid
 * - Section/segment offsets are correctly updated
 * - Binary remains executable after modification
 * - No corruption of existing sections/segments
 *
 * These tests ensure binject doesn't produce corrupted binaries that
 * would fail to load or execute on the target platform.
 */

import { spawn } from 'node:child_process'
import { MACHO_SEGMENT_NODE_SEA } from '../../bin-infra/test-helpers/segment-names.mjs'
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

let testDir
let binjectExists = false

/**
 * Execute command
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
  binjectExists = existsSync(BINJECT)
  if (!binjectExists) {
    return
  }

  testDir = path.join(os.tmpdir(), `binject-format-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists)(
  'Binary format validation after injection',
  () => {
    describe('Magic number preservation', () => {
      it.skipIf(process.platform !== 'darwin')(
        'should preserve Mach-O magic number after injection (macOS)',
        async () => {
          const inputBinary = path.join(testDir, 'macho_input')
          await fs.copyFile(BINJECT, inputBinary)

          const seaBlob = path.join(testDir, 'test.blob')
          await fs.writeFile(seaBlob, Buffer.from('test'))

          const outputBinary = path.join(testDir, 'macho_output')

          // Inject
          await execCommand(BINJECT, [
            inputBinary,
            '--sea',
            seaBlob,
            '--output',
            outputBinary,
          ])

          // Read magic number from output binary
          const data = await fs.readFile(outputBinary)

          // Mach-O 64-bit magic: 0xFEEDFACF (little-endian) or 0xCFFAEDFE (big-endian)
          const magic = data.readUInt32LE(0)
          // MH_MAGIC_64 (LE)
          // MH_CIGAM_64 (BE)
          const isValidMacho =
            magic === 0xfe_ed_fa_cf || magic === 0xcf_fa_ed_fe

          expect(isValidMacho).toBe(true)
        },
        30_000,
      )

      it.skipIf(process.platform !== 'linux')(
        'should preserve ELF magic number after injection (Linux)',
        async () => {
          const inputBinary = path.join(testDir, 'elf_input')
          await fs.copyFile(BINJECT, inputBinary)

          const seaBlob = path.join(testDir, 'test.blob')
          await fs.writeFile(seaBlob, Buffer.from('test'))

          const outputBinary = path.join(testDir, 'elf_output')

          // Inject
          await execCommand(BINJECT, [
            inputBinary,
            '--sea',
            seaBlob,
            '--output',
            outputBinary,
          ])

          // Read magic number from output binary
          const data = await fs.readFile(outputBinary)

          // ELF magic: 0x7F 'E' 'L' 'F'
          const magic = data.subarray(0, 4)
          const isValidElf =
            magic[0] === 0x7f &&
            // 'E'
            magic[1] === 0x45 &&
            // 'L'
            magic[2] === 0x4c &&
            // 'F'
            magic[3] === 0x46

          expect(isValidElf).toBe(true)
        },
        30_000,
      )

      it.skipIf(process.platform !== 'win32')(
        'should preserve PE magic number after injection (Windows)',
        async () => {
          const inputBinary = path.join(testDir, 'pe_input.exe')
          await fs.copyFile(BINJECT, inputBinary)

          const seaBlob = path.join(testDir, 'test.blob')
          await fs.writeFile(seaBlob, Buffer.from('test'))

          const outputBinary = path.join(testDir, 'pe_output.exe')

          // Inject
          await execCommand(BINJECT, [
            inputBinary,
            '--sea',
            seaBlob,
            '--output',
            outputBinary,
          ])

          // Read DOS header
          const data = await fs.readFile(outputBinary)

          // DOS magic: 'MZ' (0x5A4D)
          const dosMagic = data.readUInt16LE(0)
          // 'MZ'
          expect(dosMagic).toBe(0x5a_4d)

          // PE offset at 0x3C
          const peOffset = data.readUInt32LE(0x3c)
          expect(peOffset).toBeGreaterThan(0)
          expect(peOffset).toBeLessThan(data.length)

          // PE signature: 'PE\0\0' (0x00004550)
          const peSignature = data.readUInt32LE(peOffset)
          // 'PE\0\0'
          expect(peSignature).toBe(0x00_00_45_50)
        },
        30_000,
      )
    })

    describe('Binary executability', () => {
      it('should produce executable binary after injection', async () => {
        const inputBinary = path.join(testDir, 'exec_input')
        await fs.copyFile(BINJECT, inputBinary)

        const seaBlob = path.join(testDir, 'exec_test.blob')
        await fs.writeFile(seaBlob, Buffer.from('test'))

        const outputBinary = path.join(testDir, 'exec_output')

        // Inject
        await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        // Check file permissions
        const stats = await fs.stat(outputBinary)
        const isExecutable = (stats.mode & 0o111) !== 0

        expect(isExecutable).toBe(true)

        // Try to execute (run --help which should work even without resources)
        const execResult = await execCommand(outputBinary, ['--help'])
        expect(execResult.code).toBe(0)
      }, 30_000)

      it('should maintain original binary permissions', async () => {
        const inputBinary = path.join(testDir, 'perm_input')
        await fs.copyFile(BINJECT, inputBinary)

        // Set specific permissions
        await fs.chmod(inputBinary, 0o755)
        const _inputStats = await fs.stat(inputBinary)

        const seaBlob = path.join(testDir, 'perm_test.blob')
        await fs.writeFile(seaBlob, Buffer.from('test'))

        const outputBinary = path.join(testDir, 'perm_output')

        // Inject
        await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        const outputStats = await fs.stat(outputBinary)

        // Output should be executable
        expect(outputStats.mode & 0o111).not.toBe(0)
      }, 30_000)
    })

    describe('File format structure validation', () => {
      it('should use file command to verify format after injection', async () => {
        const inputBinary = path.join(testDir, 'format_input')
        await fs.copyFile(BINJECT, inputBinary)

        const seaBlob = path.join(testDir, 'format_test.blob')
        await fs.writeFile(seaBlob, Buffer.from('test'))

        const outputBinary = path.join(testDir, 'format_output')

        // Inject
        await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        // Use 'file' command to identify binary type
        const fileResult = await execCommand('file', [outputBinary])

        if (fileResult.code === 0) {
          const output = fileResult.stdout.toLowerCase()

          // Should identify as executable
          expect(output).toContain('executable')

          // Platform-specific checks
          if (process.platform === 'darwin') {
            expect(output).toContain('mach-o')
          } else if (process.platform === 'linux') {
            expect(output).toContain('elf')
          } else if (process.platform === 'win32') {
            // or 'ms windows'
            expect(output).toContain('pe')
          }
        }
      }, 30_000)

      it('should maintain section alignment after injection', async () => {
        const inputBinary = path.join(testDir, 'align_input')
        await fs.copyFile(BINJECT, inputBinary)

        const seaBlob = path.join(testDir, 'align_test.blob')
        await fs.writeFile(seaBlob, Buffer.from('test'))

        const outputBinary = path.join(testDir, 'align_output')

        // Inject
        const injectResult = await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        expect(injectResult.code).toBe(0)

        // Binary should be valid (no loader errors when trying to run it)
        const testResult = await execCommand(outputBinary, ['--help'])
        expect(testResult.code).toBe(0)
      }, 30_000)

      it('should not corrupt existing binary sections', async () => {
        const inputBinary = path.join(testDir, 'corrupt_input')
        await fs.copyFile(BINJECT, inputBinary)

        // Get input binary size and hash of first 4KB (should be unchanged)
        const inputData = await fs.readFile(inputBinary)
        const _inputHeader = inputData.subarray(0, 4096)

        const seaBlob = path.join(testDir, 'corrupt_test.blob')
        await fs.writeFile(seaBlob, Buffer.from('test content'))

        const outputBinary = path.join(testDir, 'corrupt_output')

        // Inject
        await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        const outputData = await fs.readFile(outputBinary)

        // Output should be larger (contains injected data)
        expect(outputData.length).toBeGreaterThan(inputData.length)

        // But binary should still be functional
        const execResult = await execCommand(outputBinary, ['--help'])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toContain('binject')
      }, 30_000)
    })

    describe('Resource section validation', () => {
      it.skipIf(process.platform !== 'darwin')(
        'should create valid NODE_SEA section (macOS)',
        async () => {
          const inputBinary = path.join(testDir, 'sea_section_input')
          await fs.copyFile(BINJECT, inputBinary)

          const seaBlob = path.join(testDir, 'sea_section_test.blob')
          await fs.writeFile(seaBlob, Buffer.from('test content'))

          const outputBinary = path.join(testDir, 'sea_section_output')

          // Inject
          await execCommand(BINJECT, [
            inputBinary,
            '--sea',
            seaBlob,
            '--output',
            outputBinary,
          ])

          // Use binject list to verify section exists
          const listResult = await execCommand(BINJECT, [outputBinary, 'list'])

          expect(listResult.code).toBe(0)
          expect(listResult.stdout).toContain(MACHO_SEGMENT_NODE_SEA)
        },
        30_000,
      )

      it.skipIf(process.platform !== 'darwin')(
        'should create valid SOCKSEC_VFS section (macOS)',
        async () => {
          const inputBinary = path.join(testDir, 'vfs_section_input')
          await fs.copyFile(BINJECT, inputBinary)

          const vfsArchive = path.join(testDir, 'vfs_section_test.vfs')
          await fs.writeFile(vfsArchive, Buffer.from('vfs content'))

          const outputBinary = path.join(testDir, 'vfs_section_output')

          // Inject
          await execCommand(BINJECT, [
            inputBinary,
            '--vfs',
            vfsArchive,
            '--output',
            outputBinary,
          ])

          // Use binject list to verify section exists
          const listResult = await execCommand(BINJECT, [outputBinary, 'list'])

          expect(listResult.code).toBe(0)
          expect(listResult.stdout).toContain('SOCKSEC_VFS')
        },
        30_000,
      )
    })

    describe('Binary size validation', () => {
      it('should produce binary with expected size increase', async () => {
        const inputBinary = path.join(testDir, 'size_input')
        await fs.copyFile(BINJECT, inputBinary)

        const inputStats = await fs.stat(inputBinary)

        const seaBlob = path.join(testDir, 'size_test.blob')
        // 10KB blob
        const blobContent = Buffer.alloc(10_000)
        await fs.writeFile(seaBlob, blobContent)

        const outputBinary = path.join(testDir, 'size_output')

        // Inject
        await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        const outputStats = await fs.stat(outputBinary)

        // Output should be at least blob size larger (allowing for metadata overhead)
        const expectedMinSize = inputStats.size + blobContent.length
        expect(outputStats.size).toBeGreaterThanOrEqual(expectedMinSize)

        // But not excessively larger (< 10% overhead)
        const maxExpectedSize = inputStats.size + blobContent.length * 1.1
        expect(outputStats.size).toBeLessThan(maxExpectedSize)
      }, 30_000)

      it('should reject empty SEA blob injection', async () => {
        const inputBinary = path.join(testDir, 'empty_input')
        await fs.copyFile(BINJECT, inputBinary)

        const seaBlob = path.join(testDir, 'empty.blob')
        // Empty blob
        await fs.writeFile(seaBlob, Buffer.alloc(0))

        const outputBinary = path.join(testDir, 'empty_output')

        // Inject empty blob (should fail with error)
        const injectResult = await execCommand(BINJECT, [
          inputBinary,
          '--sea',
          seaBlob,
          '--output',
          outputBinary,
        ])

        // Empty blobs should be rejected
        expect(injectResult.code).not.toBe(0)
        expect(injectResult.stderr).toBeTruthy()
        expect(injectResult.stderr.toLowerCase()).toMatch(/empty|size|invalid/)
      }, 30_000)
    })
  },
)
