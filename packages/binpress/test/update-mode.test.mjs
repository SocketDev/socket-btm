/**
 * @fileoverview Tests for binpress --update mode (legacy stub update workflow)
 *
 * Tests binpress's ability to update existing stubs with new compressed data.
 * The -u/--update flag allows updating the SMOL segment in an existing stub
 * without recompiling the stub binary itself.
 *
 * Test scenarios:
 * 1. Create initial stub with -o, then update with -u
 * 2. Verify stub binary remains intact after update
 * 3. Verify SMOL segment is correctly replaced
 * 4. Test updating with different compression ratios
 * 5. Error handling for invalid update scenarios
 */

import { spawn } from 'node:child_process'
import { MACHO_SEGMENT_SMOL } from '../../bin-infra/test-helpers/segment-names.mjs'
import { createHash } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')

const BUILD_MODE = getBuildMode()
const BINPRESS_NAME = process.platform === 'win32' ? 'binpress.exe' : 'binpress'
const BINPRESS = path.join(
  PACKAGE_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  BINPRESS_NAME,
)
const BINFLATE_NAME = process.platform === 'win32' ? 'binflate.exe' : 'binflate'
const BINFLATE = path.join(
  __dirname,
  '../../binflate/build',
  BUILD_MODE,
  'out/Final',
  BINFLATE_NAME,
)

let testDir

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
  // Create test directory
  testDir = path.join(os.tmpdir(), `binpress-update-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!existsSync(BINPRESS) || !existsSync(BINFLATE))(
  'binpress --update mode',
  () => {
    describe('Basic update workflow', () => {
      it('should create initial stub then update with new compressed data', async () => {
        // Step 1: Create initial compressed binary
        const originalBinary = BINFLATE
        const initialStub = path.join(testDir, 'initial-stub')

        const createResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          initialStub,
        ])
        expect(createResult.code).toBe(0)
        expect(existsSync(initialStub)).toBe(true)

        const initialStubHash = await hashFile(initialStub)

        // Step 2: Create a "modified" binary (use binpress itself as different content)
        const modifiedBinary = BINPRESS

        // Step 3: Update stub with -u flag
        const updatedStub = path.join(testDir, 'updated-stub')
        const updateResult = await execCommand(BINPRESS, [
          modifiedBinary,
          '-u',
          initialStub,
          '-o',
          updatedStub,
        ])

        expect(updateResult.code).toBe(0)
        expect(existsSync(updatedStub)).toBe(true)

        // Step 4: Verify the updated stub is different from initial
        const updatedStubHash = await hashFile(updatedStub)
        expect(updatedStubHash).not.toBe(initialStubHash)

        // Step 5: Verify the updated stub can decompress the new binary using binflate
        const decompressedPath = path.join(testDir, 'decompressed-updated')
        const decompressResult = await execCommand(BINFLATE, [
          updatedStub,
          '--output',
          decompressedPath,
        ])

        expect(decompressResult.code).toBe(0)
        expect(existsSync(decompressedPath)).toBe(true)

        // The decompressed binary should match the modified binary
        const modifiedHash = await hashFile(modifiedBinary)
        const decompressedHash = await hashFile(decompressedPath)
        expect(decompressedHash).toBe(modifiedHash)
      })

      it('should preserve stub functionality when updating', async () => {
        // Create initial stub
        const originalBinary = BINFLATE
        const initialStub = path.join(testDir, 'preserve-stub')

        await execCommand(BINPRESS, [originalBinary, '-o', initialStub])

        // Initial stub should be executable
        const initialResult = await execCommand(initialStub, ['--version'])
        expect(initialResult.code).toBe(0)

        // Update stub with different binary
        const modifiedBinary = BINPRESS
        const updatedStub = path.join(testDir, 'preserve-updated')

        await execCommand(BINPRESS, [
          modifiedBinary,
          '-u',
          initialStub,
          '-o',
          updatedStub,
        ])

        // Updated stub should still be executable and functional
        const updatedResult = await execCommand(updatedStub, ['--version'])
        expect(updatedResult.code).toBe(0)

        // Both should extract and run successfully (stub functionality preserved)
        expect(initialResult.stdout).toBeTruthy()
        expect(updatedResult.stdout).toBeTruthy()
      })
    })

    describe('Update with different compression ratios', () => {
      it('should handle updating with larger compressed data', async () => {
        // Use BINFLATE as small binary (smaller than BINPRESS)
        const smallBinary = BINFLATE

        // Create initial stub from small binary
        const initialStub = path.join(testDir, 'ratio-small-stub')
        await execCommand(BINPRESS, [smallBinary, '-o', initialStub])

        const initialSize = (await fs.stat(initialStub)).size

        // Use BINPRESS as larger binary (larger than BINFLATE)
        const largeBinary = BINPRESS

        // Update with larger binary
        const updatedStub = path.join(testDir, 'ratio-large-stub')
        const result = await execCommand(BINPRESS, [
          largeBinary,
          '-u',
          initialStub,
          '-o',
          updatedStub,
        ])

        expect(result.code).toBe(0)

        const updatedSize = (await fs.stat(updatedStub)).size
        // Updated stub should be larger
        expect(updatedSize).toBeGreaterThan(initialSize)
      })
    })

    describe('Error handling', () => {
      it('should fail when updating non-existent stub', async () => {
        const nonExistentStub = path.join(testDir, 'does-not-exist')
        const binaryToUpdate = BINFLATE
        const outputPath = path.join(testDir, 'error-output')

        const result = await execCommand(BINPRESS, [
          binaryToUpdate,
          '-u',
          nonExistentStub,
          '-o',
          outputPath,
        ])

        // Should fail with non-zero exit code
        expect(result.code).not.toBe(0)
        expect(result.stderr.length).toBeGreaterThan(0)
      })

      it('should fail when updating non-compressed binary', async () => {
        // Try to update a regular binary (not a compressed stub)
        const regularBinary = BINFLATE
        const binaryToUpdate = BINPRESS
        const outputPath = path.join(testDir, 'error-output2')

        const result = await execCommand(BINPRESS, [
          binaryToUpdate,
          '-u',
          regularBinary,
          '-o',
          outputPath,
        ])

        // Should fail with non-zero exit code
        expect(result.code).not.toBe(0)
        // Should have helpful error message
        expect(
          result.stderr.includes(MACHO_SEGMENT_SMOL) ||
            result.stderr.includes('stub'),
        ).toBe(true)
      })

      it('should allow in-place update when -u is used without -o', async () => {
        // Create valid stub first
        const initialStub = path.join(testDir, 'error-no-output-stub')
        await execCommand(BINPRESS, [BINFLATE, '-o', initialStub])

        const initialSize = (await fs.stat(initialStub)).size

        // Update without specifying output (in-place update)
        const result = await execCommand(BINPRESS, [
          BINPRESS,
          '-u',
          initialStub,
        ])

        // Should succeed - in-place update is allowed
        expect(result.code).toBe(0)

        // File should still exist and have different size
        const updatedSize = (await fs.stat(initialStub)).size
        expect(updatedSize).not.toBe(initialSize)
      })
    })

    describe('Update preserves functionality', () => {
      it('should allow multiple sequential updates', async () => {
        // Create initial stub
        const binary1 = BINFLATE
        let currentStub = path.join(testDir, 'multi-stub-0')
        await execCommand(BINPRESS, [binary1, '-o', currentStub])

        // Perform 3 updates (sequential updates required, each depends on previous)
        const binaries = [BINPRESS, BINFLATE, BINPRESS]
        for (let i = 0; i < binaries.length; i++) {
          const nextStub = path.join(testDir, `multi-stub-${i + 1}`)
          // eslint-disable-next-line no-await-in-loop
          const result = await execCommand(BINPRESS, [
            binaries[i],
            '-u',
            currentStub,
            '-o',
            nextStub,
          ])

          expect(result.code).toBe(0)
          expect(existsSync(nextStub)).toBe(true)

          // Verify it decompresses correctly using binflate
          const decompressed = path.join(testDir, `multi-decomp-${i + 1}`)
          // eslint-disable-next-line no-await-in-loop
          const decompResult = await execCommand(BINFLATE, [
            nextStub,
            '--output',
            decompressed,
          ])
          expect(decompResult.code).toBe(0)

          // eslint-disable-next-line no-await-in-loop
          const expectedHash = await hashFile(binaries[i])
          // eslint-disable-next-line no-await-in-loop
          const actualHash = await hashFile(decompressed)
          expect(actualHash).toBe(expectedHash)

          currentStub = nextStub
        }
      })
    })
  },
)
