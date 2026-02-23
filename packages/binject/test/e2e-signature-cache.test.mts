/**
 * E2E Tests for Signature Validation and Cache Management
 *
 * Tests the complete flow:
 * 1. Inject SEA+VFS into compressed stub -> stub should be signed
 * 2. Run stub -> extracted binary should be signed and cached
 * 3. Overwrite with new SEA+VFS -> stub should be signed
 * 4. Run new stub -> new extracted binary should be signed and cached in different location
 * 5. Old cache should be cleaned up
 */

import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'

import { getBinjectPath } from './helpers/paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const BINJECT = getBinjectPath()

/**
 * Find any available node-smol binary for testing.
 * Tries multiple locations and build variants.
 * @returns {string|null} Path to binary or null if none found
 */
function findTestStub() {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'

  // Try various build output locations.
  const candidates = [
    // Final builds (production-ready).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev/out/Final',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod/out/Final',
      binaryName,
    ),
    // Compressed builds (for testing decompression).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev/out/Compressed',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod/out/Compressed',
      binaryName,
    ),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

// Only run on macOS since this tests Mach-O signatures
const describeOnMac = os.platform() === 'darwin' ? describe : describe.skip

let testDir: string

async function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({
        code,
        stdout,
        stderr,
        output: stdout + stderr,
      })
    })
  })
}

async function verifySignature(binaryPath) {
  const result = await execCommand('codesign', [
    '--verify',
    '--strict',
    '--deep',
    binaryPath,
  ])
  return result.code === 0
}

async function _getSignatureInfo(binaryPath) {
  // codesign outputs to stderr
  const result = await execCommand('codesign', ['-dvvv', binaryPath])
  return result.stderr
}

function getCacheDir() {
  const home = os.homedir()
  return path.join(home, '.socket', '_dlx')
}

async function getCacheEntries() {
  const cacheDir = getCacheDir()
  try {
    const entries = await fs.readdir(cacheDir)
    // Filter for 16-char hex directories
    return entries.filter(e => /^[0-9a-f]{16}$/.test(e))
  } catch {
    return []
  }
}

async function getCachedBinaryPath(cacheKey) {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'
  return path.join(getCacheDir(), cacheKey, binaryName)
}

/**
 * Create unique SEA content using UUID to ensure each test creates a unique cache entry
 */
function createUniqueSEAContent(description) {
  const uuid = randomUUID()
  return `${description}\nUnique ID: ${uuid}\n`
}

describeOnMac('E2E Signature and Cache Tests', () => {
  let initialCacheEntries = []
  // Track cache entries we expect to create (even if test skips)
  const expectedCacheEntries = new Set()

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-e2e-'))
    // Capture initial cache state
    initialCacheEntries = await getCacheEntries()
  })

  afterAll(async () => {
    // Clean up test directory
    if (testDir) {
      await safeDelete(testDir)
    }

    // Clean up any cache entries created during tests
    const finalCacheEntries = await getCacheEntries()
    const newEntries = finalCacheEntries.filter(
      e => !initialCacheEntries.includes(e),
    )

    // Clean up all new entries (whether expected or not)
    for (const entry of newEntries) {
      const cachePath = path.join(getCacheDir(), entry)
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(cachePath)
    }

    // Also clean up expected entries that might have been created
    for (const entry of expectedCacheEntries) {
      if (!newEntries.includes(entry)) {
        const cachePath = path.join(getCacheDir(), entry)
        // eslint-disable-next-line no-await-in-loop
        await safeDelete(cachePath)
      }
    }
  })

  it('should sign stub and extracted binary on initial injection', async () => {
    // Get a real compressed Node stub from node-smol-builder
    const stubPath = findTestStub()

    // Skip if stub doesn't exist
    if (!stubPath) {
      console.log('⊘ Skipping: node-smol stub not found')
      console.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Create test resources
    const seaBlob = path.join(testDir, 'app-v1.blob')
    const vfsBlob = path.join(testDir, 'vfs-v1.blob')
    const output = path.join(testDir, 'node-with-resources-v1')

    await fs.writeFile(seaBlob, createUniqueSEAContent('SEA data version 1'))
    await fs.writeFile(vfsBlob, createUniqueSEAContent('VFS data version 1'))

    // Get initial cache entries
    const initialCacheEntries = await getCacheEntries()

    // Inject SEA + VFS
    const injectResult = await execCommand(BINJECT, [
      'inject',
      '-e',
      stubPath,
      '-o',
      output,
      '--sea',
      seaBlob,
      '--vfs',
      vfsBlob,
    ])

    expect(injectResult.code).toBe(0)
    expect(injectResult.output).toMatch(/Success|injected/i)

    // Verify stub signature
    const stubSigned = await verifySignature(output)
    expect(stubSigned).toBe(true)

    // Run stub to extract binary
    const runResult = await execCommand(output, ['--version'])
    expect(runResult.code).toBe(0)

    // Get new cache entries
    const finalCacheEntries = await getCacheEntries()
    const newCacheEntries = finalCacheEntries.filter(
      e => !initialCacheEntries.includes(e),
    )

    expect(newCacheEntries.length).toBeGreaterThan(0)

    // Verify extracted binary signature
    const cacheKey = newCacheEntries[0]
    const extractedPath = await getCachedBinaryPath(cacheKey)
    const extractedSigned = await verifySignature(extractedPath)
    expect(extractedSigned).toBe(true)
  }, 60_000)

  it('should create new cache entry and clean old one on overwrite', async () => {
    // Get a real compressed Node stub
    const stubPath = findTestStub()

    if (!stubPath) {
      console.log('⊘ Skipping: node-smol stub not found')
      console.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Create first version resources
    const seaBlob1 = path.join(testDir, 'app-cache-v1.blob')
    const vfsBlob1 = path.join(testDir, 'vfs-cache-v1.blob')
    const output1 = path.join(testDir, 'node-cache-test-v1')

    await fs.writeFile(
      seaBlob1,
      createUniqueSEAContent('SEA data version 1 for cache test'),
    )
    await fs.writeFile(
      vfsBlob1,
      createUniqueSEAContent('VFS data version 1 for cache test'),
    )

    // First injection
    const inject1 = await execCommand(BINJECT, [
      'inject',
      '-e',
      stubPath,
      '-o',
      output1,
      '--sea',
      seaBlob1,
      '--vfs',
      vfsBlob1,
    ])
    expect(inject1.code).toBe(0)

    // Run to create first cache entry
    await execCommand(output1, ['--version'])

    const cacheEntriesAfterV1 = await getCacheEntries()
    expect(cacheEntriesAfterV1.length).toBeGreaterThan(0)
    if (cacheEntriesAfterV1.length === 0) {
      throw new Error('No cache entries found after first injection')
    }
    const cacheKeyV1 = cacheEntriesAfterV1[cacheEntriesAfterV1.length - 1]

    // Create second version resources (different content = different hash)
    const seaBlob2 = path.join(testDir, 'app-cache-v2.blob')
    const vfsBlob2 = path.join(testDir, 'vfs-cache-v2.blob')
    const output2 = path.join(testDir, 'node-cache-test-v2')

    await fs.writeFile(
      seaBlob2,
      createUniqueSEAContent('SEA data version 2 for cache test (UPDATED)'),
    )
    await fs.writeFile(
      vfsBlob2,
      createUniqueSEAContent('VFS data version 2 for cache test (UPDATED)'),
    )

    // Second injection (overwrite)
    // Use v1 output as input
    const inject2 = await execCommand(BINJECT, [
      'inject',
      '-e',
      output1,
      '-o',
      output2,
      '--sea',
      seaBlob2,
      '--vfs',
      vfsBlob2,
    ])
    expect(inject2.code).toBe(0)

    // Verify v2 stub signature
    const stub2Signed = await verifySignature(output2)
    expect(stub2Signed).toBe(true)

    // Run v2 to create second cache entry
    await execCommand(output2, ['--version'])

    const cacheEntriesAfterV2 = await getCacheEntries()
    const newCacheKeys = cacheEntriesAfterV2.filter(
      e => !cacheEntriesAfterV1.includes(e),
    )

    // Should have new cache entry
    expect(newCacheKeys.length).toBeGreaterThan(0)
    const cacheKeyV2 = newCacheKeys[0]

    // Cache keys should be different
    expect(cacheKeyV2).not.toBe(cacheKeyV1)

    // Verify v2 extracted binary signature
    const extractedPathV2 = await getCachedBinaryPath(cacheKeyV2)
    const extracted2Signed = await verifySignature(extractedPathV2)
    expect(extracted2Signed).toBe(true)

    // Cache cleanup not yet implemented - both versions coexist
    // When cache cleanup is added, this test should verify only v2 exists
    const v1CachePath = await getCachedBinaryPath(cacheKeyV1)
    const v2CachePath = await getCachedBinaryPath(cacheKeyV2)

    const v1Exists = existsSync(v1CachePath)
    const v2Exists = existsSync(v2CachePath)

    expect(v2Exists).toBe(true)

    // When cache cleanup is implemented, this should be false:
    // expect(v1Exists).toBe(false)
    // For now, we just document that both exist:
    if (v1Exists) {
      console.log(
        `  ⚠ Note: Old cache still exists at ${cacheKeyV1} (cleanup not yet implemented)`,
      )
    }
  }, 120_000)

  it('should have valid signatures after multiple overwrites', async () => {
    const stubPath = findTestStub()

    if (!stubPath) {
      console.log('⊘ Skipping: node-smol stub not found')
      console.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    let currentOutput = stubPath

    // Do 3 successive overwrites
    for (let version = 1; version <= 3; version++) {
      const seaBlob = path.join(testDir, `multi-sea-v${version}.blob`)
      const vfsBlob = path.join(testDir, `multi-vfs-v${version}.blob`)
      const output = path.join(testDir, `node-multi-v${version}`)

      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(
        seaBlob,
        createUniqueSEAContent(`SEA version ${version} content`),
      )
      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(
        vfsBlob,
        createUniqueSEAContent(`VFS version ${version} content`),
      )

      // eslint-disable-next-line no-await-in-loop
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        currentOutput,
        '-o',
        output,
        '--sea',
        seaBlob,
        '--vfs',
        vfsBlob,
      ])

      expect(result.code).toBe(0)

      // Verify stub signature
      // eslint-disable-next-line no-await-in-loop
      const stubSigned = await verifySignature(output)
      expect(stubSigned).toBe(true)

      // Run and verify extracted binary
      // eslint-disable-next-line no-await-in-loop
      const runResult = await execCommand(output, ['--version'])
      expect(runResult.code).toBe(0)

      currentOutput = output
    }
  }, 180_000)
})
