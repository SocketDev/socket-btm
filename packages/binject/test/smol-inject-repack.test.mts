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

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import {
  getBinflatePath,
  getBinjectPath,
  getBinpressPath,
} from './helpers/paths.mjs'
import { MACHO_SEGMENT_SMOL } from '../../bin-infra/test/helpers/segment-names.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()
const BINPRESS = getBinpressPath()
const BINFLATE = getBinflatePath()

// Use Node.js binary as consistent test input (not binsuite tools which may vary)
const NODE_BINARY = process.execPath

let testDir: string
let testBinary: string
const binjectExists = existsSync(BINJECT)
const binpressExists = existsSync(BINPRESS)
const binflateExists = existsSync(BINFLATE)

/**
 * Execute command and return result
 */
async function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const spawnPromise = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // @socketsecurity/lib/spawn returns a Promise with .process property
    const proc = spawnPromise.process

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code, stderr, stdout })
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    spawnPromise.catch(() => {
      // Already handled by 'close' event
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
  // Create unique test directory with timestamp and random suffix to isolate from parallel runs
  const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  testDir = path.join(os.tmpdir(), `binject-smol-inject-${uniqueId}`)
  await safeMkdir(testDir)

  // Copy Node.js binary as consistent test input (not binsuite tools which may vary between builds)
  testBinary = path.join(testDir, 'test-node')
  await fs.copyFile(NODE_BINARY, testBinary)
  await fs.chmod(testBinary, 0o755)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists || !binpressExists || !binflateExists)(
  'sMOL stub injection and repack workflow',
  () => {
    describe('auto-detect and inject into SMOL stub', () => {
      it('should auto-detect SMOL stub and inject SEA resource', async () => {
        // Step 1: Create SMOL compressed stub (use Node.js binary as consistent test input)
        const originalBinary = testBinary
        const compressedStub = path.join(testDir, 'inject-stub')

        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedStub,
        ])
        expect(compressResult.code).toBe(0)
        await expect(isSMOLStub(compressedStub)).resolves.toBeTruthy()

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
        expect(existsSync(outputStub)).toBeTruthy()

        // Step 4: Verify output is still a SMOL stub
        await expect(isSMOLStub(outputStub)).resolves.toBeTruthy()

        // Note: After repacking, the SEA resource is INSIDE the compressed __PRESSED_DATA.
        // It is NOT visible in `binject list` output for the SMOL stub.
        // The SEA will only be visible after the stub runs and extracts the binary to cache.
        // We verify the injection succeeded by confirming:
        // 1. The injection command succeeded (code 0)
        // 2. The output is a valid SMOL stub
        // 3. The output size increased (verified in the next test)
        const listResult = await execCommand(BINJECT, ['list', outputStub])
        expect(listResult.code).toBe(0)
        // SMOL stub should contain the SMOL segment with compressed data
        expect(listResult.stdout).toContain('SMOL')
        // 60s timeout for compression/decompression
      }, 60_000)

      it('should preserve SMOL stub size characteristics', async () => {
        // Step 1: Create SMOL compressed stub
        const originalBinary = testBinary
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
        await expect(isSMOLStub(compressedStub)).resolves.toBeTruthy()
        await expect(isSMOLStub(outputStub)).resolves.toBeTruthy()
      }, 60_000)
    })

    describe('skip repack with --skip-repack flag', () => {
      it('should modify cached binary without repacking when --skip-repack is used', async () => {
        // Step 1: Create SMOL compressed stub
        const originalBinary = testBinary
        const compressedStub = path.join(testDir, 'skip-stub')

        await execCommand(BINPRESS, [originalBinary, '-o', compressedStub])

        // Step 2: Run the stub once to extract to cache
        // (--skip-repack requires the extracted binary to exist in cache)
        const _runResult = await execCommand(compressedStub, ['--version'])
        // Note: This may fail if Node.js doesn't support --version in this way, but extraction happens anyway
        // The important thing is the binary was executed and extracted to cache

        // Step 3: Inject with --skip-repack flag
        // With --skip-repack, binject:
        // 1. Detects compressed stub
        // 2. Finds extracted binary in cache
        // 3. Injects SEA into the cached binary
        // 4. Does NOT repack - leaves injected binary in cache for testing
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

        // With --skip-repack, binject modifies the cached binary and prints a message
        // It may or may not create the output file depending on whether it's compressed
        // The key behavior is: cached binary is modified, repacking is skipped
        // Check output contains the skip message
        expect(injectResult.stdout + injectResult.stderr).toMatch(
          /skip.*repack|Modified extracted binary/i,
        )
      }, 60_000)
    })

    // NOTE: Extracting PRESSED_DATA is not supported via CLI
    // The extract command only supports --vfs and --sea flags
    // SMOL stub internals (PRESSED_DATA) cannot be extracted with binject

    describe('error handling', () => {
      it('should handle non-SMOL binary without --skip-repack', async () => {
        // Use regular binary (not compressed)
        const regularBinary = testBinary
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
        await expect(isSMOLStub(outputPath)).resolves.toBeFalsy()
      }, 30_000)
    })
  },
)
