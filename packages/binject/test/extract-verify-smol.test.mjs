/**
 * @fileoverview Extract and verify tests for binject with SMOL-compressed binaries
 *
 * Tests binject's ability to extract and verify SMOL segments from binpress-compressed binaries.
 * This validates the integration between binpress (compression) and binject (extraction).
 *
 * Test scenarios:
 * 1. Extract SMOL segment from compressed binary created by binpress
 * 2. Verify SMOL segment integrity with binject verify
 * 3. List embedded resources and confirm SMOL segment appears
 * 4. Extract and decompress full workflow (binpress -> binject extract -> binflate decompress)
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
import { MACHO_SEGMENT_SMOL } from '../../bin-infra/test-helpers/segment-names.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()
const BINPRESS = path.join(
  __dirname,
  '../../binpress/build/dev/out/Final/binpress',
)
const BINFLATE = path.join(
  __dirname,
  '../../binflate/build/dev/out/Final/binflate',
)

let testDir
let binjectExists = false
let binpressExists = false
let binflateExists = false

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
  // Check if tools exist
  binjectExists = existsSync(BINJECT)
  binpressExists = existsSync(BINPRESS)
  binflateExists = existsSync(BINFLATE)

  if (!binjectExists) {
    console.warn(`⚠️  binject not found at ${BINJECT}`)
    console.warn('   Run: pnpm build in packages/binject')
    return
  }

  if (!binpressExists) {
    console.warn(`⚠️  binpress not found at ${BINPRESS}`)
    console.warn('   Run: pnpm build in packages/binpress')
    return
  }

  if (!binflateExists) {
    console.warn(`⚠️  binflate not found at ${BINFLATE}`)
    console.warn('   Run: pnpm build in packages/binflate')
    return
  }

  // Create test directory
  testDir = path.join(os.tmpdir(), `binject-smol-extract-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!binjectExists || !binpressExists || !binflateExists)(
  'SMOL segment extraction and verification',
  () => {
    describe('Extract SMOL segment', () => {
      it('should extract SMOL segment from binpress-compressed binary', async () => {
        // Create test binary (use binflate itself as test subject)
        const originalBinary = BINFLATE
        const compressedStub = path.join(testDir, 'compressed-stub')
        const extractedData = path.join(testDir, 'extracted.data')

        // Step 1: Compress binary with binpress (creates stub with embedded SMOL segment)
        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedStub,
        ])
        expect(compressResult.code).toBe(0)
        expect(existsSync(compressedStub)).toBe(true)

        // Step 2: Use binject to extract SMOL segment
        // Note: binject extracts the compressed data from SMOL segment
        const extractResult = await execCommand(BINJECT, [
          'extract',
          '-e',
          compressedStub,
          '--smol',
          '-o',
          extractedData,
        ])

        // Binject should successfully extract the SMOL data
        expect(extractResult.code).toBe(0)
        expect(existsSync(extractedData)).toBe(true)

        // Extracted data should be non-empty compressed binary data
        const stats = await fs.stat(extractedData)
        expect(stats.size).toBeGreaterThan(0)
      })

      it('should fail gracefully when extracting from non-compressed binary', async () => {
        // Try to extract SMOL from a regular binary (no SMOL segment)
        const regularBinary = BINFLATE
        const outputPath = path.join(testDir, 'invalid-extract.data')

        const result = await execCommand(BINJECT, [
          'extract',
          '-e',
          regularBinary,
          '--smol',
          '-o',
          outputPath,
        ])

        // Should fail with non-zero exit code
        expect(result.code).not.toBe(0)
        expect(result.stderr).toContain(MACHO_SEGMENT_SMOL)
        // Output file should not be created
        expect(existsSync(outputPath)).toBe(false)
      })
    })

    describe('Verify SMOL segment', () => {
      it('should verify SMOL segment exists in compressed binary', async () => {
        // Create compressed binary
        const originalBinary = BINFLATE
        const compressedStub = path.join(testDir, 'verify-stub')

        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedStub,
        ])
        expect(compressResult.code).toBe(0)

        // Verify SMOL segment with binject
        const verifyResult = await execCommand(BINJECT, [
          'verify',
          '-e',
          compressedStub,
          '--smol',
        ])

        // Should succeed with exit code 0
        expect(verifyResult.code).toBe(0)
      })

      it('should fail verification on non-compressed binary', async () => {
        // Try to verify SMOL on regular binary (no SMOL segment)
        const regularBinary = BINFLATE

        const result = await execCommand(BINJECT, [
          'verify',
          '-e',
          regularBinary,
          '--smol',
        ])

        // Should fail with non-zero exit code
        expect(result.code).not.toBe(0)
      })
    })

    describe('List embedded resources', () => {
      it('should list SMOL segment in compressed binary', async () => {
        // Create compressed binary
        const originalBinary = BINFLATE
        const compressedStub = path.join(testDir, 'list-stub')

        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedStub,
        ])
        expect(compressResult.code).toBe(0)

        // List resources with binject
        const listResult = await execCommand(BINJECT, ['list', compressedStub])

        // Should succeed
        expect(listResult.code).toBe(0)

        // Output should contain SMOL segment information
        expect(
          listResult.stdout.includes(MACHO_SEGMENT_SMOL) ||
            listResult.stdout.includes('__SMOL'),
        ).toBe(true)

        // Should show metadata (size, cache key, platform)
        expect(listResult.stdout.length).toBeGreaterThan(0)
      })

      it('should show empty list for non-compressed binary', async () => {
        // List resources on regular binary (no embedded resources)
        const regularBinary = BINFLATE

        const result = await execCommand(BINJECT, ['list', regularBinary])

        // Should succeed but show no SMOL segment
        expect(result.code).toBe(0)
        // Output should not contain SMOL
        const hasSmol =
          result.stdout.includes(MACHO_SEGMENT_SMOL) ||
          result.stdout.includes('__SMOL')
        expect(hasSmol).toBe(false)
      })
    })

    describe('Full workflow: compress -> extract -> decompress', () => {
      it('should extract and decompress to match original binary', async () => {
        // Original binary
        const originalBinary = BINFLATE
        const originalHash = await hashFile(originalBinary)

        // Step 1: Compress with binpress
        const compressedStub = path.join(testDir, 'workflow-stub')
        const compressResult = await execCommand(BINPRESS, [
          originalBinary,
          '-o',
          compressedStub,
        ])
        expect(compressResult.code).toBe(0)

        // Step 2: Extract SMOL data with binject
        const extractedData = path.join(testDir, 'workflow-extracted.data')
        const extractResult = await execCommand(BINJECT, [
          'extract',
          '-e',
          compressedStub,
          '--smol',
          '-o',
          extractedData,
        ])
        expect(extractResult.code).toBe(0)

        // Step 3: Decompress with binflate
        const decompressedBinary = path.join(testDir, 'workflow-decompressed')
        const decompressResult = await execCommand(BINFLATE, [
          extractedData,
          '-o',
          decompressedBinary,
        ])
        expect(decompressResult.code).toBe(0)

        // Step 4: Verify byte-for-byte match with original
        const decompressedHash = await hashFile(decompressedBinary)
        expect(decompressedHash).toBe(originalHash)
      })
    })
  },
)
