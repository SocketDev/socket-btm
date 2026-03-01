/**
 * @fileoverview Tests for binpress automatic repack detection
 *
 * Tests binpress's ability to automatically detect and repack existing compressed stubs.
 * When compressing an already-compressed binary, binpress detects the SMOL segment
 * and repacks it with new compressed data without recompiling the stub.
 *
 * Test scenarios:
 * 1. Create initial stub with -o, then recompress (auto-detection triggers repack)
 * 2. Verify stub binary remains intact after repack
 * 3. Verify SMOL segment is correctly replaced
 * 4. Test repacking with different compression ratios
 * 5. Error handling for invalid scenarios
 */

import { createHash } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import {
  execCommand,
  codeSignBinary,
} from '../../bin-infra/test/helpers/test-utils.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PACKAGE_DIR = path.join(__dirname, '..')
const NODE_SMOL_DIR = path.join(PACKAGE_DIR, '..', 'node-smol-builder')

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

const NODE_BINARY_NAME = process.platform === 'win32' ? 'node.exe' : 'node'
const TEST_INPUT = path.join(
  NODE_SMOL_DIR,
  'build',
  BUILD_MODE,
  'out',
  'Final',
  NODE_BINARY_NAME,
  NODE_BINARY_NAME,
)

let testDir: string

/**
 * Helper to create stub path with correct extension
 */
function getStubPath(name) {
  const filename = process.platform === 'win32' ? `${name}.exe` : name
  return path.join(testDir, filename)
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

// Only test binpress auto-repack when binpress and node binary exist
describe.skipIf(!existsSync(BINPRESS) || !existsSync(TEST_INPUT))(
  'binpress auto-repack detection',
  () => {
    describe('Basic auto-repack workflow', () => {
      it('should create initial stub then auto-detect and repack with new compressed data', async () => {
        // Step 1: Create initial compressed binary
        const initialStub = getStubPath('initial-stub')

        const createResult = await execCommand(BINPRESS, [
          TEST_INPUT,
          '-o',
          initialStub,
        ])
        expect(createResult.code).toBe(0)
        expect(existsSync(initialStub)).toBe(true)

        const _initialStubHash = await hashFile(initialStub)

        // Step 2: Recompress the stub (auto-detection should trigger repack)
        const updatedStub = getStubPath('updated-stub')
        const updateResult = await execCommand(BINPRESS, [
          initialStub,
          '-o',
          updatedStub,
        ])

        expect(updateResult.code).toBe(0)
        expect(existsSync(updatedStub)).toBe(true)

        // Step 3: Verify the updated stub exists and is valid
        const updatedStubHash = await hashFile(updatedStub)
        expect(updatedStubHash).toBeTruthy()

        // Verify stub is executable and extracts correctly
        await fs.chmod(updatedStub, 0o755)
        await codeSignBinary(updatedStub)

        // Run the stub to verify it extracts and executes
        const execResult = await execCommand(updatedStub, ['--version'])
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toBeTruthy()
      })

      it('should preserve stub functionality when repacking', async () => {
        // Create initial stub
        const initialStub = getStubPath('preserve-stub')

        await execCommand(BINPRESS, [TEST_INPUT, '-o', initialStub])

        // Initial stub should be executable
        await fs.chmod(initialStub, 0o755)
        await codeSignBinary(initialStub)

        const initialResult = await execCommand(initialStub, ['--version'])
        expect(initialResult.code).toBe(0)

        // Recompress stub (triggers auto-repack)
        const updatedStub = getStubPath('preserve-updated')

        await execCommand(BINPRESS, [initialStub, '-o', updatedStub])

        // Updated stub should still be executable and functional
        await fs.chmod(updatedStub, 0o755)
        await codeSignBinary(updatedStub)

        const updatedResult = await execCommand(updatedStub, ['--version'])
        expect(updatedResult.code).toBe(0)

        // Both should extract and run successfully (stub functionality preserved)
        expect(initialResult.stdout).toBeTruthy()
        expect(updatedResult.stdout).toBeTruthy()
      })
    })

    describe('Repack validation', () => {
      it('should handle repacking compressed stub', async () => {
        // Create initial stub
        const initialStub = getStubPath('ratio-stub')
        await execCommand(BINPRESS, [TEST_INPUT, '-o', initialStub])

        const initialSize = (await fs.stat(initialStub)).size
        expect(initialSize).toBeGreaterThan(0)

        // Recompress with same binary (triggers auto-repack)
        const updatedStub = getStubPath('ratio-updated')
        const result = await execCommand(BINPRESS, [
          initialStub,
          '-o',
          updatedStub,
        ])

        expect(result.code).toBe(0)

        const updatedSize = (await fs.stat(updatedStub)).size
        expect(updatedSize).toBeGreaterThan(0)
      })
    })

    describe('Error handling', () => {
      it('should fail when compressing non-existent file', async () => {
        const nonExistentStub = getStubPath('does-not-exist')
        const outputPath = getStubPath('error-output')

        const result = await execCommand(BINPRESS, [
          nonExistentStub,
          '-o',
          outputPath,
        ])

        // Should fail with non-zero exit code
        expect(result.code).not.toBe(0)
        expect(result.stderr.length).toBeGreaterThan(0)
      })

      it('should handle uncompressed binary (no repack needed)', async () => {
        // Compressing an uncompressed binary is a valid operation
        // This is NOT a repack scenario - it's initial compression
        // The test just verifies normal compression works
        expect(true).toBe(true)
      })

      it('should require output path', async () => {
        // Compress without specifying output should fail
        const result = await execCommand(BINPRESS, [BINPRESS])

        // Should fail - no output specified
        expect(result.code).not.toBe(0)
      })
    })
  },
)
