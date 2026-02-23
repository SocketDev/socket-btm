/**
 * @fileoverview Cross-package integration tests
 *
 * Tests the complete pipeline across multiple packages:
 * 1. binpress: Compress a Node.js binary
 * 2. binject: Inject SEA/VFS resources into compressed binary
 * 3. Execute: Run the final binary and verify it works
 * 4. Cache: Verify decompression and caching behavior
 *
 * This validates the end-to-end workflow:
 * Node binary → binpress (compress) → binject (inject resources) → execute
 *
 * These tests ensure all packages work together correctly and that
 * binaries produced by the full pipeline are functional.
 */

import { promises as fs, existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getBuildMode } from 'build-infra/lib/constants'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getLatestFinalBinary } from '../paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..', '..', '..', '..')

// Package binaries
const BUILD_MODE = getBuildMode()

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

let testDir: string
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

  testDir = path.join(tmpdir(), `cross-package-${Date.now()}`)
  await safeMkdir(testDir)
})

afterAll(async () => {
  if (testDir) {
    await safeDelete(testDir)
  }
})

describe.skipIf(!allBinariesExist)('Cross-package integration', () => {
  describe('Complete pipeline: compress → inject → execute', () => {
    it('should compress node binary, inject SEA, and execute', async () => {
      // Step 1: Compress Node.js binary using binpress
      const compressedNode = path.join(testDir, 'node_compressed')

      console.log('  Step 1: Compressing Node.js binary...')
      const compressResult = await execCommand(
        BINPRESS,
        [NODE_BINARY, '-o', compressedNode],
        { timeout: 120_000 },
      )

      expect(compressResult.code).toBe(0)
      expect(existsSync(compressedNode)).toBe(true)

      await fs.chmod(compressedNode, 0o755)

      // Verify compressed binary works
      const compressedExec = await execCommand(compressedNode, ['--version'])
      expect(compressedExec.code).toBe(0)
      expect(compressedExec.stdout).toMatch(/^v24\.\d+\.\d+/)

      // Step 2: Inject SEA blob using binject
      const seaBlob = path.join(testDir, 'test.blob')
      await fs.writeFile(seaBlob, Buffer.from('CROSS_PACKAGE_TEST_SEA_CONTENT'))

      const finalBinary = path.join(testDir, 'node_final')

      console.log('  Step 2: Injecting SEA blob...')
      const injectResult = await execCommand(BINJECT, [
        'inject',
        '-e',
        compressedNode,
        '-o',
        finalBinary,
        '--sea',
        seaBlob,
      ])

      expect(injectResult.code).toBe(0)
      expect(existsSync(finalBinary)).toBe(true)

      // Step 3: Execute final binary
      console.log('  Step 3: Executing final binary...')
      const finalExec = await execCommand(finalBinary, ['--version'])

      expect(finalExec.code).toBe(0)
      expect(finalExec.stdout).toMatch(/^v24\.\d+\.\d+/)

      // Verify binary is functional
      const evalResult = await execCommand(finalBinary, [
        '--eval',
        'console.log("integration test works")',
      ])

      expect(evalResult.code).toBe(0)
      expect(evalResult.stdout).toContain('integration test works')
      // 4 minute timeout
    }, 240_000)

    it('should compress, inject VFS, and execute', async () => {
      const compressedNode = path.join(testDir, 'node_vfs_compressed')

      // Compress
      await execCommand(BINPRESS, [NODE_BINARY, '-o', compressedNode], {
        timeout: 120_000,
      })
      await fs.chmod(compressedNode, 0o755)

      // Inject SEA and VFS (binject requires --sea with --vfs)
      const seaBlob = path.join(testDir, 'test_vfs.blob')
      await fs.writeFile(seaBlob, Buffer.from('CROSS_PACKAGE_VFS_SEA_CONTENT'))

      const vfsArchive = path.join(testDir, 'test.vfs')
      await fs.writeFile(
        vfsArchive,
        Buffer.from('CROSS_PACKAGE_TEST_VFS_CONTENT'),
      )

      const finalBinary = path.join(testDir, 'node_vfs_final')

      await execCommand(BINJECT, [
        'inject',
        '-e',
        compressedNode,
        '-o',
        finalBinary,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
      ])

      // Execute
      const execResult = await execCommand(finalBinary, ['--version'])

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v24\.\d+\.\d+/)
    }, 240_000)

    it('should compress, inject both SEA and VFS, and execute', async () => {
      const compressedNode = path.join(testDir, 'node_both_compressed')

      // Compress
      await execCommand(BINPRESS, [NODE_BINARY, '-o', compressedNode], {
        timeout: 120_000,
      })
      await fs.chmod(compressedNode, 0o755)

      // Inject both resources
      const seaBlob = path.join(testDir, 'both.blob')
      await fs.writeFile(seaBlob, Buffer.from('SEA_CONTENT'))

      const vfsArchive = path.join(testDir, 'both.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('VFS_CONTENT'))

      const finalBinary = path.join(testDir, 'node_both_final')

      await execCommand(BINJECT, [
        'inject',
        '-e',
        compressedNode,
        '-o',
        finalBinary,
        '--sea',
        seaBlob,
        '--vfs',
        vfsArchive,
      ])

      // Execute
      const execResult = await execCommand(finalBinary, ['--version'])

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v24\.\d+\.\d+/)
    }, 240_000)
  })

  describe('Pipeline validation', () => {
    it('should maintain binary functionality through full pipeline', async () => {
      // Get original behavior
      const originalResult = await execCommand(NODE_BINARY, [
        '--eval',
        'console.log(process.version)',
      ])
      const originalVersion = originalResult.stdout.trim()

      // Through pipeline
      const compressed = path.join(testDir, 'validate_compressed')
      await execCommand(BINPRESS, [NODE_BINARY, '-o', compressed], {
        timeout: 120_000,
      })
      await fs.chmod(compressed, 0o755)

      const seaBlob = path.join(testDir, 'validate.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const final = path.join(testDir, 'validate_final')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        compressed,
        '-o',
        final,
        '--sea',
        seaBlob,
      ])

      // Check final behavior matches original
      const finalResult = await execCommand(final, [
        '--eval',
        'console.log(process.version)',
      ])

      expect(finalResult.stdout.trim()).toBe(originalVersion)
    }, 240_000)

    it('should preserve compression through injection', async () => {
      const compressed = path.join(testDir, 'preserve_compressed')

      // Compress
      await execCommand(BINPRESS, [NODE_BINARY, '-o', compressed], {
        timeout: 120_000,
      })
      await fs.chmod(compressed, 0o755)

      const compressedSize = (await fs.stat(compressed)).size

      // Inject
      const seaBlob = path.join(testDir, 'preserve.blob')
      // 1KB blob
      await fs.writeFile(seaBlob, Buffer.alloc(1000))

      const final = path.join(testDir, 'preserve_final')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        compressed,
        '-o',
        final,
        '--sea',
        seaBlob,
      ])

      const finalSize = (await fs.stat(final)).size

      // Final should be roughly compressed size + blob size (with some overhead)
      const expectedSize = compressedSize + 1000
      expect(finalSize).toBeGreaterThan(compressedSize)
      // Allow 10KB overhead
      expect(finalSize).toBeLessThan(expectedSize + 10_000)
    }, 240_000)
  })

  describe('Cache behavior through pipeline', () => {
    it('should create cache on first execution of final binary', async () => {
      const compressed = path.join(testDir, 'cache_compressed')
      await execCommand(BINPRESS, [NODE_BINARY, '-o', compressed], {
        timeout: 120_000,
      })
      await fs.chmod(compressed, 0o755)

      const seaBlob = path.join(testDir, 'cache.blob')
      await fs.writeFile(seaBlob, Buffer.from('cache test'))

      const final = path.join(testDir, 'cache_final')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        compressed,
        '-o',
        final,
        '--sea',
        seaBlob,
      ])

      // Determine cache directory
      const DLX_DIR = path.join(homedir(), '.socket', '_dlx')

      // First execution (creates cache)
      const exec1 = await execCommand(final, ['--version'])
      expect(exec1.code).toBe(0)

      // Find cache directory
      const cacheDirs = existsSync(DLX_DIR) ? await fs.readdir(DLX_DIR) : []
      expect(cacheDirs.length).toBeGreaterThan(0)
      if (cacheDirs.length === 0) {
        throw new Error('No cache directories found')
      }

      const cacheDir = path.join(DLX_DIR, cacheDirs[cacheDirs.length - 1])
      const metadataPath = path.join(cacheDir, '.dlx-metadata.json')
      expect(existsSync(metadataPath)).toBe(true)

      const metadataBefore = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
      const timestampBefore = metadataBefore.timestamp

      // Second execution (uses cache)
      const exec2 = await execCommand(final, ['--version'])
      expect(exec2.code).toBe(0)

      // Verify cache was reused (timestamp unchanged)
      const metadataAfter = JSON.parse(await fs.readFile(metadataPath, 'utf8'))
      expect(metadataAfter.timestamp).toBe(timestampBefore)
    }, 240_000)
  })

  describe('Error propagation', () => {
    it('should fail if compression fails', async () => {
      const nonExistent = path.join(testDir, 'does_not_exist')
      const output = path.join(testDir, 'error_output')

      const result = await execCommand(BINPRESS, [nonExistent, '-o', output])

      expect(result.code).not.toBe(0)
      expect(result.stderr).toBeTruthy()
      expect(result.stderr.toLowerCase()).toMatch(
        /not found|exist|no such|cannot/,
      )
    }, 30_000)

    it('should fail if injection on non-compressed binary fails gracefully', async () => {
      // Try to inject into a regular file (not a valid binary)
      const textFile = path.join(testDir, 'text.txt')
      await fs.writeFile(textFile, 'not a binary')

      const seaBlob = path.join(testDir, 'error.blob')
      await fs.writeFile(seaBlob, Buffer.from('test'))

      const output = path.join(testDir, 'error_inject_output')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        textFile,
        '-o',
        output,
        '--sea',
        seaBlob,
      ])

      // Should fail (not crash)
      expect(result.code).not.toBe(0)
      expect(result.stderr).toBeTruthy()
      expect(result.stderr.toLowerCase()).toMatch(
        /invalid|binary|format|cannot/,
      )
    }, 30_000)
  })

  describe('Real-world scenarios', () => {
    it('should handle multiple sequential operations', async () => {
      // Scenario: compress → inject SEA → inject VFS → execute
      const compressed = path.join(testDir, 'multi_compressed')
      await execCommand(BINPRESS, [NODE_BINARY, '-o', compressed], {
        timeout: 120_000,
      })
      await fs.chmod(compressed, 0o755)

      // Inject SEA
      const seaBlob = path.join(testDir, 'multi.blob')
      await fs.writeFile(seaBlob, Buffer.from('sea'))

      const withSea = path.join(testDir, 'multi_with_sea')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        compressed,
        '-o',
        withSea,
        '--sea',
        seaBlob,
      ])

      // Inject VFS (requires SEA per main.c:398-407)
      const vfsArchive = path.join(testDir, 'multi.vfs')
      await fs.writeFile(vfsArchive, Buffer.from('vfs'))

      const seaBlob2 = path.join(testDir, 'multi2.blob')
      await fs.writeFile(seaBlob2, Buffer.from('sea2'))

      const final = path.join(testDir, 'multi_final')
      await execCommand(BINJECT, [
        'inject',
        '-e',
        withSea,
        '-o',
        final,
        '--sea',
        seaBlob2,
        '--vfs',
        vfsArchive,
      ])

      // Execute final
      const execResult = await execCommand(final, ['--version'])

      expect(execResult.code).toBe(0)
      expect(execResult.stdout).toMatch(/^v24\.\d+\.\d+/)
      // 5 minute timeout
    }, 300_000)
  })
})
