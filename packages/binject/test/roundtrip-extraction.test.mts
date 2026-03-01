/**
 * @fileoverview Round-trip injection and extraction tests for binject
 *
 * Tests the complete workflow:
 * 1. Inject resources (SEA blob, VFS archive) into binary
 * 2. Extract resources using binject extract command
 * 3. Verify extracted data matches original input
 * 4. Validate binary integrity after injection
 *
 * This ensures that:
 * - Resources are correctly embedded in binary
 * - Extraction logic correctly reads embedded resources
 * - No data corruption occurs during inject/extract cycle
 * - Binary format remains valid after modifications
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
let binjectExists = false

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

/**
 * Calculate SHA-256 hash of file
 */
async function hashFile(filePath) {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

beforeAll(async () => {
  // Check if binject exists
  binjectExists = existsSync(BINJECT)
  if (!binjectExists) {
    console.warn(`⚠️  binject not found at ${BINJECT}`)
    console.warn('   Run: pnpm build in packages/binject')
    return
  }

  // Create test directory
  testDir = path.join(os.tmpdir(), `binject-roundtrip-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists)('Round-trip injection and extraction', () => {
  describe('SEA blob round-trip', () => {
    it('should inject and extract SEA blob with identical content', async () => {
      // Create test SEA blob
      const seaBlob = path.join(testDir, 'test.blob')
      const seaContent = Buffer.from(`TEST_SEA_BLOB_CONTENT_${Date.now()}`)
      await fs.writeFile(seaBlob, seaContent)

      // Create dummy binary (use binject itself as test binary)
      const inputBinary = path.join(testDir, 'input_binary')
      await fs.copyFile(BINJECT, inputBinary)

      const outputBinary = path.join(testDir, 'output_with_sea')

      // Inject SEA blob
      const injectResult = await execCommand(BINJECT, [
        'inject',
        '-e',
        inputBinary,
        '-o',
        outputBinary,
        '--sea',
        seaBlob,
      ])

      expect(injectResult.code).toBe(0)
      expect(existsSync(outputBinary)).toBe(true)

      // Extract SEA blob
      const extractedSea = path.join(testDir, 'extracted.blob')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        outputBinary,
        '-o',
        extractedSea,
        '--sea',
      ])

      expect(extractResult.code).toBe(0)
      expect(existsSync(extractedSea)).toBe(true)

      // Compare original and extracted
      const originalHash = await hashFile(seaBlob)
      const extractedHash = await hashFile(extractedSea)

      expect(extractedHash).toBe(originalHash)

      // Verify byte-for-byte equality
      const originalContent = await fs.readFile(seaBlob)
      const extractedContent = await fs.readFile(extractedSea)
      expect(Buffer.compare(originalContent, extractedContent)).toBe(0)
    }, 30_000)

    it('should preserve binary functionality after SEA injection', async () => {
      const inputBinary = path.join(testDir, 'func_test_input')
      await fs.copyFile(BINJECT, inputBinary)

      const seaBlob = path.join(testDir, 'func_test.blob')
      await fs.writeFile(seaBlob, Buffer.from('test content'))

      const outputBinary = path.join(testDir, 'func_test_output')

      // Inject
      const injectResult = await execCommand(BINJECT, [
        'inject',
        '-e',
        inputBinary,
        '-o',
        outputBinary,
        '--sea',
        seaBlob,
      ])

      expect(injectResult.code).toBe(0)

      // Verify output binary is still executable (test with --help)
      const execResult = await execCommand(outputBinary, ['--help'])
      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toContain('binject')
    }, 30_000)

    it('should handle large SEA blobs (>1MB)', async () => {
      // Create 2MB SEA blob
      const seaBlob = path.join(testDir, 'large.blob')
      const largeContent = Buffer.alloc(2 * 1024 * 1024)
      // Fill with pattern for compression resistance
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256
      }
      await fs.writeFile(seaBlob, largeContent)

      const inputBinary = path.join(testDir, 'large_input')
      await fs.copyFile(BINJECT, inputBinary)

      const outputBinary = path.join(testDir, 'large_output')

      // Inject
      const injectResult = await execCommand(BINJECT, [
        'inject',
        '-e',
        inputBinary,
        '-o',
        outputBinary,
        '--sea',
        seaBlob,
      ])

      expect(injectResult.code).toBe(0)

      // Extract
      const extractedSea = path.join(testDir, 'large_extracted.blob')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        outputBinary,
        '-o',
        extractedSea,
        '--sea',
      ])

      expect(extractResult.code).toBe(0)

      // Verify size and hash
      const extractedStats = await fs.stat(extractedSea)
      expect(extractedStats.size).toBe(largeContent.length)

      const originalHash = await hashFile(seaBlob)
      const extractedHash = await hashFile(extractedSea)
      expect(extractedHash).toBe(originalHash)
    }, 60_000)
  })

  describe('VFS archive round-trip', () => {
    it('should inject and extract VFS archive with identical content', async () => {
      // Create test VFS archive
      const vfsArchive = path.join(testDir, 'test.vfs')
      const vfsContent = Buffer.from(`TEST_VFS_ARCHIVE_CONTENT_${Date.now()}`)
      await fs.writeFile(vfsArchive, vfsContent)

      // Create test SEA blob (required for VFS injection)
      const seaBlob = path.join(testDir, 'vfs_test.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const inputBinary = path.join(testDir, 'vfs_input')
      await fs.copyFile(BINJECT, inputBinary)

      const outputBinary = path.join(testDir, 'vfs_output')

      // Inject VFS (with required SEA blob)
      const injectResult = await execCommand(BINJECT, [
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

      expect(injectResult.code).toBe(0)

      // Extract VFS
      const extractedVfs = path.join(testDir, 'extracted.vfs')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        outputBinary,
        '-o',
        extractedVfs,
        '--vfs',
      ])

      expect(extractResult.code).toBe(0)

      // Compare
      const originalHash = await hashFile(vfsArchive)
      const extractedHash = await hashFile(extractedVfs)
      expect(extractedHash).toBe(originalHash)
    }, 30_000)

    it('should handle VFS with special characters in filename', async () => {
      const vfsArchive = path.join(testDir, 'test-vfs_v1.2.3.vfs')
      const vfsContent = Buffer.from('VFS_CONTENT_WITH_SPECIAL_NAME')
      await fs.writeFile(vfsArchive, vfsContent)

      // Create test SEA blob (required for VFS injection)
      const seaBlob = path.join(testDir, 'special_test.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const inputBinary = path.join(testDir, 'special_input')
      await fs.copyFile(BINJECT, inputBinary)

      const outputBinary = path.join(testDir, 'special_output')

      // Inject (with required SEA blob)
      const injectResult = await execCommand(BINJECT, [
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

      expect(injectResult.code).toBe(0)

      // Extract
      const extractedVfs = path.join(testDir, 'special_extracted.vfs')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        outputBinary,
        '-o',
        extractedVfs,
        '--vfs',
      ])

      expect(extractResult.code).toBe(0)

      // Verify
      const originalContent = await fs.readFile(vfsArchive)
      const extractedContent = await fs.readFile(extractedVfs)
      expect(Buffer.compare(originalContent, extractedContent)).toBe(0)
    }, 30_000)
  })

  describe('Batch injection round-trip', () => {
    it('should inject and extract both SEA and VFS with identical content', async () => {
      // Create resources
      const seaBlob = path.join(testDir, 'batch.blob')
      const seaContent = Buffer.from('BATCH_SEA_CONTENT')
      await fs.writeFile(seaBlob, seaContent)

      const vfsArchive = path.join(testDir, 'batch.vfs')
      const vfsContent = Buffer.from('BATCH_VFS_CONTENT')
      await fs.writeFile(vfsArchive, vfsContent)

      const inputBinary = path.join(testDir, 'batch_input')
      await fs.copyFile(BINJECT, inputBinary)

      const outputBinary = path.join(testDir, 'batch_output')

      // Inject both
      const injectResult = await execCommand(BINJECT, [
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

      expect(injectResult.code).toBe(0)

      // Extract SEA
      const extractedSea = path.join(testDir, 'batch_extracted.blob')
      const seaExtractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        outputBinary,
        '-o',
        extractedSea,
        '--sea',
      ])

      expect(seaExtractResult.code).toBe(0)

      // Extract VFS
      const extractedVfs = path.join(testDir, 'batch_extracted.vfs')
      const vfsExtractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        outputBinary,
        '-o',
        extractedVfs,
        '--vfs',
      ])

      expect(vfsExtractResult.code).toBe(0)

      // Verify both
      const seaOriginalHash = await hashFile(seaBlob)
      const seaExtractedHash = await hashFile(extractedSea)
      expect(seaExtractedHash).toBe(seaOriginalHash)

      const vfsOriginalHash = await hashFile(vfsArchive)
      const vfsExtractedHash = await hashFile(extractedVfs)
      expect(vfsExtractedHash).toBe(vfsOriginalHash)
    }, 30_000)
  })

  describe('Multiple injection/extraction cycles', () => {
    it('should maintain integrity after 3 inject/extract cycles', async () => {
      let currentBinary = path.join(testDir, 'cycle_input')
      await fs.copyFile(BINJECT, currentBinary)

      const originalSeaBlob = path.join(testDir, 'original.blob')
      const originalContent = Buffer.from('CYCLE_TEST_CONTENT')
      await fs.writeFile(originalSeaBlob, originalContent)

      // 3 cycles of inject + extract
      for (let i = 0; i < 3; i++) {
        const seaBlob = path.join(testDir, `cycle_${i}.blob`)
        // eslint-disable-next-line no-await-in-loop
        await fs.copyFile(originalSeaBlob, seaBlob)

        const outputBinary = path.join(testDir, `cycle_output_${i}`)

        // Inject
        // eslint-disable-next-line no-await-in-loop
        const injectResult = await execCommand(BINJECT, [
          'inject',
          '-e',
          currentBinary,
          '-o',
          outputBinary,
          '--sea',
          seaBlob,
        ])

        expect(injectResult.code).toBe(0)

        // Extract
        const extractedBlob = path.join(testDir, `cycle_extracted_${i}.blob`)
        // eslint-disable-next-line no-await-in-loop
        const extractResult = await execCommand(BINJECT, [
          'extract',
          '-e',
          outputBinary,
          '-o',
          extractedBlob,
          '--sea',
        ])

        expect(extractResult.code).toBe(0)

        // Verify hash matches original
        // eslint-disable-next-line no-await-in-loop
        const extractedHash = await hashFile(extractedBlob)
        // eslint-disable-next-line no-await-in-loop
        const originalHash = await hashFile(originalSeaBlob)
        expect(extractedHash).toBe(originalHash)

        // Update current binary for next cycle
        currentBinary = outputBinary
      }
    }, 90_000)

    it('should handle re-injection with extraction validation', async () => {
      const inputBinary = path.join(testDir, 'reinject_input')
      await fs.copyFile(BINJECT, inputBinary)

      const blob1 = path.join(testDir, 'blob1.blob')
      await fs.writeFile(blob1, Buffer.from('FIRST_INJECTION'))

      const blob2 = path.join(testDir, 'blob2.blob')
      await fs.writeFile(blob2, Buffer.from('SECOND_INJECTION'))

      const output1 = path.join(testDir, 'reinject_output1')
      const output2 = path.join(testDir, 'reinject_output2')

      // First injection
      await execCommand(BINJECT, [
        'inject',
        '-e',
        inputBinary,
        '-o',
        output1,
        '--sea',
        blob1,
      ])

      // Second injection (re-inject)
      await execCommand(BINJECT, [
        'inject',
        '-e',
        output1,
        '-o',
        output2,
        '--sea',
        blob2,
      ])

      // Extract from second output
      const extracted = path.join(testDir, 'reinject_extracted.blob')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        output2,
        '-o',
        extracted,
        '--sea',
      ])

      expect(extractResult.code).toBe(0)

      // Should match blob2, not blob1
      const extractedContent = await fs.readFile(extracted, 'utf8')
      expect(extractedContent).toBe('SECOND_INJECTION')
      expect(extractedContent).not.toBe('FIRST_INJECTION')
    }, 60_000)
  })

  describe('Error handling in extraction', () => {
    it('should fail gracefully when extracting non-existent SEA blob', async () => {
      // Binary without SEA blob
      const binaryWithoutSea = path.join(testDir, 'no_sea_binary')
      await fs.copyFile(BINJECT, binaryWithoutSea)

      const extractedSea = path.join(testDir, 'should_not_exist.blob')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        binaryWithoutSea,
        '-o',
        extractedSea,
        '--sea',
      ])

      // Should fail with non-zero exit code
      expect(extractResult.code).not.toBe(0)
      expect(extractResult.stderr).toBeTruthy()
      expect(extractResult.stderr.toLowerCase()).toMatch(
        /not found|missing|no sea|cannot/,
      )

      // Output file should not be created
      expect(existsSync(extractedSea)).toBe(false)
    }, 30_000)

    it('should fail gracefully when extracting non-existent VFS', async () => {
      const binaryWithoutVfs = path.join(testDir, 'no_vfs_binary')
      await fs.copyFile(BINJECT, binaryWithoutVfs)

      const extractedVfs = path.join(testDir, 'should_not_exist.vfs')
      const extractResult = await execCommand(BINJECT, [
        'extract',
        '-e',
        binaryWithoutVfs,
        '-o',
        extractedVfs,
        '--vfs',
      ])

      expect(extractResult.code).not.toBe(0)
      expect(extractResult.stderr).toBeTruthy()
      expect(extractResult.stderr.toLowerCase()).toMatch(
        /not found|missing|no vfs|cannot/,
      )
      expect(existsSync(extractedVfs)).toBe(false)
    }, 30_000)
  })
})
