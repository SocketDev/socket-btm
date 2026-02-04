/**
 * @fileoverview Cross-tool repacking integration tests
 *
 * Tests cyclic workflows where binpress and binject operations are interleaved:
 * 1. compress → inject (batch) → recompress (verify injection survives)
 * 2. inject (batch) → compress → reinject (batch) (alternating operations)
 * 3. compress → inject (batch) → update compression → extract (verify data integrity)
 *
 * IMPORTANT: Injection is always BATCH (SEA + VFS together).
 * We do not support sequential injection (inject SEA, then inject VFS).
 *
 * This validates that:
 * - binpress update preserves binject batch injections (SEA + VFS)
 * - binject batch reinject works on compressed binaries
 * - Both SEA and VFS data remain intact through multiple alternating operations
 */

import { promises as fs, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..')

// Package binaries
const BUILD_MODE = process.env.BUILD_MODE || 'dev'

function getBinaryPath(packageName, binaryName) {
  const ext = process.platform === 'win32' ? '.exe' : ''
  return path.join(
    PROJECT_ROOT,
    'packages',
    packageName,
    'build',
    BUILD_MODE,
    'out',
    'Final',
    binaryName + ext,
  )
}

const BINPRESS = getBinaryPath('binpress', 'binpress')
const BINJECT = getBinaryPath('binject', 'binject')
const NODE_BINARY = getLatestFinalBinary()

let testDir
let allBinariesExist = false

/**
 * Execute command.
 */
async function execCommand(command, args = [], options = {}) {
  const result = await spawn(command, args, {
    ...options,
    stdio: 'pipe',
  })
  return {
    code: result.code ?? 0,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  }
}

beforeAll(async () => {
  // Check if all required binaries exist
  const binpressExists = existsSync(BINPRESS)
  const binjectExists = existsSync(BINJECT)
  const nodeExists = NODE_BINARY && existsSync(NODE_BINARY)

  allBinariesExist = binpressExists && binjectExists && nodeExists

  if (!allBinariesExist) {
    console.warn('⚠️  Missing required binaries:')
    if (!binpressExists) {
      console.warn(`   - binpress: ${BINPRESS}`)
    }
    if (!binjectExists) {
      console.warn(`   - binject: ${BINJECT}`)
    }
    if (!nodeExists) {
      console.warn(`   - node binary: ${NODE_BINARY}`)
    }
    console.warn('   Run: pnpm build in respective packages')
    return
  }

  testDir = path.join(tmpdir(), `cross-tool-repack-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!allBinariesExist)('Cross-tool repacking', () => {
  describe('compress → inject (batch) → recompress', () => {
    it('should preserve SEA and VFS after binpress update', async () => {
      // Step 1: Compress Node.js binary
      const compressed1 = path.join(testDir, 'batch_repack_1')
      console.log('  Step 1: Initial compression...')

      const compress1 = await execCommand(
        BINPRESS,
        [NODE_BINARY, '--output', compressed1],
        { timeout: 120_000 },
      )
      expect(compress1.code).toBe(0)
      await fs.chmod(compressed1, 0o755)

      // Step 2: Inject SEA and VFS (batch)
      const seaBlob = path.join(testDir, 'repack.blob')
      await fs.writeFile(seaBlob, Buffer.from('SEA_REPACK_TEST_DATA'))

      const vfsArchive = path.join(testDir, 'repack.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('VFS_REPACK_TEST_DATA'))

      const withBatch = path.join(testDir, 'batch_repack_2')
      console.log('  Step 2: Injecting SEA + VFS (batch)...')

      const inject = await execCommand(BINJECT, [
        compressed1,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
        '--output',
        withBatch,
      ])
      expect(inject.code).toBe(0)
      await fs.chmod(withBatch, 0o755)

      // Step 3: Update compression with binpress -u (different payload)
      const compressed2 = path.join(testDir, 'batch_repack_3')
      console.log('  Step 3: Updating compression...')

      // Use BINPRESS binary as new payload (different from original)
      const update = await execCommand(
        BINPRESS,
        [BINPRESS, '-u', withBatch, '--output', compressed2],
        { timeout: 120_000 },
      )
      expect(update.code).toBe(0)
      await fs.chmod(compressed2, 0o755)

      // Step 4: Extract both SEA and VFS to verify they survived update
      const extractedSea = path.join(testDir, 'extracted.blob')
      console.log('  Step 4: Extracting SEA and VFS...')

      const extractSea = await execCommand(BINJECT, [
        '--extract',
        'sea',
        compressed2,
        '--output',
        extractedSea,
      ])

      expect(extractSea.code).toBe(0)
      expect(existsSync(extractedSea)).toBe(true)

      // Verify SEA content is intact
      const seaContent = await fs.readFile(extractedSea, 'utf8')
      expect(seaContent).toBe('SEA_REPACK_TEST_DATA')

      // Extract and verify VFS
      const extractedVfs = path.join(testDir, 'extracted.vfs')
      const extractVfs = await execCommand(BINJECT, [
        '--extract',
        'vfs',
        compressed2,
        '--output',
        extractedVfs,
      ])

      expect(extractVfs.code).toBe(0)
      expect(existsSync(extractedVfs)).toBe(true)

      const vfsContent = await fs.readFile(extractedVfs, 'utf8')
      expect(vfsContent).toBe('VFS_REPACK_TEST_DATA')

      // Step 5: Verify binary is still executable
      console.log('  Step 5: Verifying execution...')
      const exec = await execCommand(compressed2, ['--version'])
      expect(exec.code).toBe(0)
    }, 300_000)
  })

  describe('Multiple sequential updates', () => {
    it('should handle compress → inject (batch) → update → update → reinject (batch) cycle', async () => {
      // Initial compression
      const step1 = path.join(testDir, 'multi_step1')
      await execCommand(BINPRESS, [NODE_BINARY, '--output', step1], {
        timeout: 120_000,
      })
      await fs.chmod(step1, 0o755)

      // Inject SEA + VFS (batch v1)
      const sea1 = path.join(testDir, 'multi_sea1.blob')
      await fs.writeFile(sea1, Buffer.from('SEA_V1'))

      const vfs1 = path.join(testDir, 'multi_vfs1.vfs')
      await fs.writeFile(vfs1, Buffer.from('VFS_V1'))

      const step2 = path.join(testDir, 'multi_step2')
      await execCommand(BINJECT, [
        step1,
        '--sea',
        sea1,
        '--vfs',
        vfs1,
        '--output',
        step2,
      ])
      await fs.chmod(step2, 0o755)

      // Update compression #1
      const step3 = path.join(testDir, 'multi_step3')
      await execCommand(BINPRESS, [BINPRESS, '-u', step2, '--output', step3], {
        timeout: 120_000,
      })
      await fs.chmod(step3, 0o755)

      // Update compression #2
      const step4 = path.join(testDir, 'multi_step4')
      await execCommand(
        BINPRESS,
        [NODE_BINARY, '-u', step3, '--output', step4],
        {
          timeout: 120_000,
        },
      )
      await fs.chmod(step4, 0o755)

      // Reinject different batch (SEA + VFS v2 - should replace)
      const sea2 = path.join(testDir, 'multi_sea2.blob')
      await fs.writeFile(sea2, Buffer.from('SEA_V2'))

      const vfs2 = path.join(testDir, 'multi_vfs2.vfs')
      await fs.writeFile(vfs2, Buffer.from('VFS_V2'))

      const step5 = path.join(testDir, 'multi_step5')
      await execCommand(BINJECT, [
        step4,
        '--sea',
        sea2,
        '--vfs',
        vfs2,
        '--output',
        step5,
      ])

      // Extract and verify final SEA is V2
      const extractedSea = path.join(testDir, 'multi_extracted.blob')
      await execCommand(BINJECT, [
        '--extract',
        'sea',
        step5,
        '--output',
        extractedSea,
      ])

      const seaContent = await fs.readFile(extractedSea, 'utf8')
      expect(seaContent).toBe('SEA_V2')

      // Extract and verify final VFS is V2
      const extractedVfs = path.join(testDir, 'multi_extracted.vfs')
      await execCommand(BINJECT, [
        '--extract',
        'vfs',
        step5,
        '--output',
        extractedVfs,
      ])

      const vfsContent = await fs.readFile(extractedVfs, 'utf8')
      expect(vfsContent).toBe('VFS_V2')

      // Verify binary works
      const exec = await execCommand(step5, ['--version'])
      expect(exec.code).toBe(0)
    }, 420_000)
  })

  describe('Size validation through repacking', () => {
    it('should maintain reasonable binary size through repack cycle', async () => {
      // Initial compression
      const compressed = path.join(testDir, 'size_compressed')
      await execCommand(BINPRESS, [NODE_BINARY, '--output', compressed], {
        timeout: 120_000,
      })
      const compressedSize = (await fs.stat(compressed)).size

      // Inject small batch (SEA + VFS)
      const seaBlob = path.join(testDir, 'size_sea.blob')
      await fs.writeFile(seaBlob, Buffer.alloc(1000, 'A'))

      const vfsArchive = path.join(testDir, 'size_vfs.vfs')
      await fs.writeFile(vfsArchive, Buffer.alloc(1000, 'B'))

      const withBatch = path.join(testDir, 'size_with_batch')
      await execCommand(BINJECT, [
        compressed,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
        '--output',
        withBatch,
      ])
      const withBatchSize = (await fs.stat(withBatch)).size

      // Update compression
      const updated = path.join(testDir, 'size_updated')
      await execCommand(
        BINPRESS,
        [BINPRESS, '-u', withBatch, '--output', updated],
        {
          timeout: 120_000,
        },
      )
      const updatedSize = (await fs.stat(updated)).size

      // Size checks
      expect(withBatchSize).toBeGreaterThan(compressedSize)
      // Batch added ~2KB (1KB SEA + 1KB VFS)
      expect(withBatchSize).toBeLessThan(compressedSize + 10_000)

      // After update, size should not grow unbounded
      // Allow up to 100KB difference (compression ratio variation)
      expect(Math.abs(updatedSize - withBatchSize)).toBeLessThan(100_000)
    }, 300_000)
  })

  describe('Error handling in repacking', () => {
    it('should fail gracefully when updating non-compressed binary with injected data', async () => {
      // Try to inject batch into regular Node binary (not compressed)
      const seaBlob = path.join(testDir, 'error_sea.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const vfsArchive = path.join(testDir, 'error_vfs.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('test'))

      const withBatch = path.join(testDir, 'error_with_batch')
      await execCommand(BINJECT, [
        NODE_BINARY,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
        '--output',
        withBatch,
      ])

      // Try to update it with binpress -u (should fail - not compressed)
      const output = path.join(testDir, 'error_output')
      const result = await execCommand(
        BINPRESS,
        [BINPRESS, '-u', withBatch, '--output', output],
        { timeout: 120_000 },
      )

      // Should fail with error about missing compression marker
      expect(result.code).not.toBe(0)
      expect(result.stderr.toLowerCase()).toMatch(
        /marker|compressed|smol|note/i,
      )
    }, 180_000)
  })

  describe('Functional validation', () => {
    it('should maintain Node.js functionality through full repack cycle', async () => {
      // Compress
      const compressed = path.join(testDir, 'func_compressed')
      await execCommand(BINPRESS, [NODE_BINARY, '--output', compressed], {
        timeout: 120_000,
      })
      await fs.chmod(compressed, 0o755)

      // Test functionality before injection
      const test1 = await execCommand(compressed, [
        '--eval',
        'console.log("test1")',
      ])
      expect(test1.code).toBe(0)
      expect(test1.stdout).toContain('test1')

      // Inject batch (SEA + VFS)
      const seaBlob = path.join(testDir, 'func_sea.blob')
      await fs.writeFile(seaBlob, Buffer.from('data'))

      const vfsArchive = path.join(testDir, 'func_vfs.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('data'))

      const withBatch = path.join(testDir, 'func_with_batch')
      await execCommand(BINJECT, [
        compressed,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
        '--output',
        withBatch,
      ])
      await fs.chmod(withBatch, 0o755)

      // Test functionality after batch injection
      const test2 = await execCommand(withBatch, [
        '--eval',
        'console.log("test2")',
      ])
      expect(test2.code).toBe(0)
      expect(test2.stdout).toContain('test2')

      // Update compression
      const updated = path.join(testDir, 'func_updated')
      await execCommand(
        BINPRESS,
        [BINPRESS, '-u', withBatch, '--output', updated],
        {
          timeout: 120_000,
        },
      )
      await fs.chmod(updated, 0o755)

      // Test functionality after recompression
      const test3 = await execCommand(updated, [
        '--eval',
        'console.log("test3")',
      ])
      expect(test3.code).toBe(0)
      expect(test3.stdout).toContain('test3')

      // Verify all Node.js features still work
      const features = await execCommand(updated, [
        '--eval',
        `
        const fs = require('fs');
        const path = require('path');
        console.log('fs:', typeof fs.readFileSync);
        console.log('path:', typeof path.join);
        console.log('process:', typeof process.version);
      `,
      ])

      expect(features.code).toBe(0)
      expect(features.stdout).toContain('fs: function')
      expect(features.stdout).toContain('path: function')
      expect(features.stdout).toContain('process: string')
    }, 300_000)
  })
})
