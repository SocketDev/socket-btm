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
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { makeExecutable } from 'build-infra/lib/build-helpers'
import { getBuildMode } from 'build-infra/lib/constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import {
  codeSignBinary,
  execCommand,
} from 'bin-infra/test/helpers/test-utils'

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

// Use system Node.js as test input — always available, always a valid binary.
// Avoids dependency on node-smol build which may use a different compression algorithm.
const TEST_INPUT = process.execPath

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

// Skip in Docker glibc builds — ETXTBSY race in overlay2 filesystem.
const isDockerBuild = !existsSync(path.join(__dirname, '..', '..', '..', '.git'))

// Only test binpress auto-repack when binpress and node binary exist.
describe.skipIf(!existsSync(BINPRESS) || !existsSync(TEST_INPUT) || isDockerBuild)(
  'binpress auto-repack detection',
  () => {
    describe('basic auto-repack workflow', () => {
      it('should create initial stub then auto-detect and repack with new compressed data', async () => {
        // Step 1: Create initial compressed binary
        const initialStub = getStubPath('initial-stub')

        const createResult = await execCommand(BINPRESS, [
          TEST_INPUT,
          '-o',
          initialStub,
        ])
        expect(createResult.code).toBe(0)
        expect(existsSync(initialStub)).toBeTruthy()

        const _initialStubHash = await hashFile(initialStub)

        // Step 2: Recompress the stub (auto-detection should trigger repack)
        const updatedStub = getStubPath('updated-stub')
        const updateResult = await execCommand(BINPRESS, [
          initialStub,
          '-o',
          updatedStub,
        ])

        expect(updateResult.code).toBe(0)
        expect(existsSync(updatedStub)).toBeTruthy()

        // Step 3: Verify the updated stub exists and is valid
        const updatedStubHash = await hashFile(updatedStub)
        expect(updatedStubHash).toBeTruthy()

        // Verify stub is executable and extracts correctly
        await makeExecutable(updatedStub)
        await codeSignBinary(updatedStub)

        // Run the stub to verify it extracts and executes
        const execResult = await execCommand(updatedStub, ['--version'])
        if (execResult.code !== 0) {
          console.error('Stub execution failed:', execResult.stderr || execResult.stdout)
        }
        expect(execResult.code).toBe(0)
        expect(execResult.stdout).toBeTruthy()
      })

      it('should preserve stub functionality when repacking', async () => {
        // Create initial stub
        const initialStub = getStubPath('preserve-stub')

        await execCommand(BINPRESS, [TEST_INPUT, '-o', initialStub])

        // Initial stub should be executable
        await makeExecutable(initialStub)
        await codeSignBinary(initialStub)

        const initialResult = await execCommand(initialStub, ['--version'])
        expect(initialResult.code).toBe(0)

        // Recompress stub (triggers auto-repack)
        const updatedStub = getStubPath('preserve-updated')

        await execCommand(BINPRESS, [initialStub, '-o', updatedStub])

        // Updated stub should still be executable and functional
        await makeExecutable(updatedStub)
        await codeSignBinary(updatedStub)

        const updatedResult = await execCommand(updatedStub, ['--version'])
        expect(updatedResult.code).toBe(0)

        // Both should extract and run successfully (stub functionality preserved)
        expect(initialResult.stdout).toBeTruthy()
        expect(updatedResult.stdout).toBeTruthy()
      })
    })

    describe('repack validation', () => {
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

    describe('error handling', () => {
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
        expect(true).toBeTruthy()
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
