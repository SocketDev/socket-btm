/**
 * @fileoverview SMOL stub injection and repack workflow tests
 *
 * Tests binject's ability to auto-detect SMOL stubs, extract the compressed binary,
 * inject SEA/VFS resources, and repack back into SMOL stub format.
 *
 * Test workflow:
 * 1. Create SMOL compressed stub (binpress)
 * 2. Inject SEA resource into stub (binject auto-detects SMOL, extracts, injects, repacks)
 * 3. Verify output is still a valid SMOL stub
 * 4. Verify SEA resource was injected correctly
 * 5. Extract and verify the injected binary has correct NODE_SEA_FUSE marker
 */

import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import {
  getBinjectPath,
  getBinpressPath,
  getBinflatePath,
} from './helpers/paths.mjs'
import { MACHO_SEGMENT_SMOL } from '../../bin-infra/test/helpers/segment-names.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()
const BINPRESS = getBinpressPath()
const BINFLATE = getBinflatePath()

let testDir: string
const binjectExists = existsSync(BINJECT)
const binpressExists = existsSync(BINPRESS)
const binflateExists = existsSync(BINFLATE)

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
async function _hashFile(filePath) {
  const data = await fs.readFile(filePath)
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Create a minimal SEA blob for testing
 */
async function createTestSEABlob(outputPath) {
  // Create a simple JSON file as SEA blob
  const seaData = JSON.stringify({
    main: 'index.js',
    output: 'sea-prep.blob',
  })
  await fs.writeFile(outputPath, seaData, 'utf8')
  return outputPath
}

/**
 * Check if binary has PRESSED_DATA section (SMOL stub detection)
 */
async function isSMOLStub(binaryPath) {
  const listResult = await execCommand(BINJECT, ['list', binaryPath])
  if (listResult.code !== 0) {
    return false
  }

  return (
    listResult.stdout.includes(MACHO_SEGMENT_SMOL) ||
    listResult.stdout.includes('__SMOL') ||
    listResult.stdout.includes('PRESSED_DATA')
  )
}

// Warn if binaries are missing (tests will be skipped)
if (!binjectExists) {
  console.warn(`⚠️  binject not found at ${BINJECT}`)
  console.warn('   Run: pnpm build in packages/binject')
}
if (!binpressExists) {
  console.warn(`⚠️  binpress not found at ${BINPRESS}`)
  console.warn('   Run: pnpm build in packages/binpress')
}
if (!binflateExists) {
  console.warn(`⚠️  binflate not found at ${BINFLATE}`)
  console.warn('   Run: pnpm build in packages/binflate')
}

beforeAll(async () => {
  // Create test directory
  testDir = path.join(os.tmpdir(), `binject-smol-inject-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists || !binpressExists || !binflateExists)(
  'SMOL stub injection and repack workflow',
  () => {
    describe('Auto-detect and inject into SMOL stub', () => {
      it('should auto-detect SMOL stub and inject SEA resource', async () => {
        // Step 1: Create SMOL compressed stub (use binflate as test binary)
        const originalBinary = BINFLATE
        const compressedStub = path.join(testDir, 'inject-stub')

        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedStub,
        ])
        expect(compressResult.code).toBe(0)
        expect(await isSMOLStub(compressedStub)).toBe(true)

        // Step 2: Create test SEA blob
        const seaBlob = path.join(testDir, 'test-sea.blob')
        await createTestSEABlob(seaBlob)

        // Step 3: Inject SEA into SMOL stub
        // binject should auto-detect SMOL, extract, inject, repack
        const outputStub = path.join(testDir, 'inject-output')
        const injectResult = await execCommand(BINJECT, [
          'inject',
          '-e',
          compressedStub,
          '-o',
          outputStub,
          '--sea',
          seaBlob,
        ])

        // Should succeed
        expect(injectResult.code).toBe(0)
        expect(existsSync(outputStub)).toBe(true)

        // Step 4: Verify output is still a SMOL stub
        expect(await isSMOLStub(outputStub)).toBe(true)

        // Step 5: Verify SEA resource was injected (can list it)
        const listResult = await execCommand(BINJECT, ['list', outputStub])
        expect(listResult.code).toBe(0)
        // Should contain both SMOL segment and NODE_SEA_BLOB
        expect(
          listResult.stdout.includes('NODE_SEA_BLOB') ||
            listResult.stdout.includes('SEA'),
        ).toBe(true)
        // 60s timeout for compression/decompression
      }, 60_000)

      it('should preserve SMOL stub size characteristics', async () => {
        // Step 1: Create SMOL compressed stub
        const originalBinary = BINFLATE
        const compressedStub = path.join(testDir, 'size-stub')

        await execCommand(BINPRESS, [originalBinary, '-o', compressedStub])
        const originalStubSize = (await fs.stat(compressedStub)).size

        // Step 2: Inject SEA into SMOL stub
        const seaBlob = path.join(testDir, 'size-test-sea.blob')
        await createTestSEABlob(seaBlob)
        const seaBlobSize = (await fs.stat(seaBlob)).size

        const outputStub = path.join(testDir, 'size-output')
        await execCommand(BINJECT, [
          'inject',
          '-e',
          compressedStub,
          '-o',
          outputStub,
          '--sea',
          seaBlob,
        ])

        const outputStubSize = (await fs.stat(outputStub)).size

        // Output stub should be:
        // - Larger than input (added SEA data)
        // - Still compressed (much smaller than full binary)
        expect(outputStubSize).toBeGreaterThan(originalStubSize)
        // Allow for compression overhead + LIEF segment alignment (can be significant)
        expect(outputStubSize).toBeLessThan(
          originalStubSize + seaBlobSize + 50_000,
        )

        // Verify both are SMOL stubs
        expect(await isSMOLStub(compressedStub)).toBe(true)
        expect(await isSMOLStub(outputStub)).toBe(true)
      }, 60_000)
    })

    describe('Skip repack with --skip-repack flag', () => {
      it('should inject directly without SMOL extraction when --skip-repack is used', async () => {
        // Step 1: Create SMOL compressed stub
        const originalBinary = BINFLATE
        const compressedStub = path.join(testDir, 'skip-stub')

        await execCommand(BINPRESS, [originalBinary, '-o', compressedStub])

        // Step 2: Inject with --skip-repack flag
        const seaBlob = path.join(testDir, 'skip-sea.blob')
        await createTestSEABlob(seaBlob)

        const outputStub = path.join(testDir, 'skip-output')
        const injectResult = await execCommand(BINJECT, [
          'inject',
          '-e',
          compressedStub,
          '-o',
          outputStub,
          '--sea',
          seaBlob,
          '--skip-repack',
        ])

        // Should succeed
        expect(injectResult.code).toBe(0)
        expect(existsSync(outputStub)).toBe(true)

        // With --skip-repack, binject skips SMOL detection/extraction
        // It injects directly into the SMOL stub, so output is STILL a SMOL stub
        const isSmol = await isSMOLStub(outputStub)
        expect(isSmol).toBe(true)

        // Output should be slightly larger (added SEA resource)
        const outputSize = (await fs.stat(outputStub)).size
        const stubSize = (await fs.stat(compressedStub)).size
        expect(outputSize).toBeGreaterThan(stubSize)

        // Verify SEA resource was injected
        const listResult = await execCommand(BINJECT, ['list', outputStub])
        expect(listResult.code).toBe(0)
        expect(
          listResult.stdout.includes('NODE_SEA_BLOB') ||
            listResult.stdout.includes('SEA'),
        ).toBe(true)
      }, 60_000)
    })

    // NOTE: Extracting PRESSED_DATA is not supported via CLI
    // The extract command only supports --vfs and --sea flags
    // SMOL stub internals (PRESSED_DATA) cannot be extracted with binject

    describe('Error handling', () => {
      it('should handle non-SMOL binary without --skip-repack', async () => {
        // Use regular binary (not compressed)
        const regularBinary = BINFLATE
        const seaBlob = path.join(testDir, 'error-sea.blob')
        await createTestSEABlob(seaBlob)

        const outputPath = path.join(testDir, 'error-output')
        const result = await execCommand(BINJECT, [
          'inject',
          '-e',
          regularBinary,
          '-o',
          outputPath,
          '--sea',
          seaBlob,
        ])

        // Should succeed (regular injection, no SMOL auto-detection)
        expect(result.code).toBe(0)

        // Output should not be a SMOL stub
        expect(await isSMOLStub(outputPath)).toBe(false)
      }, 30_000)
    })
  },
)
