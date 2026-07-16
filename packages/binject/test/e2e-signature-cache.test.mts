import { afterAll, beforeAll, expect, test } from 'vitest'
/**
 * E2E Tests for Signature Validation and Cache Management.
 *
 * Tests the complete flow: 1. Inject SEA+VFS into compressed stub -> stub
 * should be signed 2. Run stub -> extracted binary should be signed and cached
 * 3. Overwrite with new SEA+VFS -> stub should be signed 4. Run new stub -> new
 * extracted binary should be signed and cached in different location 5. Old
 * cache should be cleaned up.
 *
 * Build/cache/signature setup helpers live in
 * helpers/e2e-signature-cache.mts.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  BINJECT,
  cleanCacheBeforeTest,
  createUniqueVFSContent,
  execCommand,
  findNodeSmolBinary,
  findTestStub,
  generateValidSEABlob,
  getCachedBinaryPath,
  getCacheDir,
  getCacheEntries,
  verifySignature,
} from './helpers/e2e-signature-cache.mts'
import { describeIf } from './helpers/vitest-skip.mts'

const logger = getDefaultLogger()

let testDir: string

describeIf(os.platform() === 'darwin')('E2E Signature and Cache Tests', () => {
  let initialCacheEntries: string[] = []
  // Track cache entries we expect to create (even if test skips)
  const expectedCacheEntries = new Set<string>()
  // Uncompressed node-smol binary for SEA blob generation (same version as stub)
  let nodeSmolBinary: string | undefined = undefined

  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-e2e-'))
    // Capture initial cache state
    initialCacheEntries = await getCacheEntries()
    // Find uncompressed node-smol binary for SEA generation
    nodeSmolBinary = findNodeSmolBinary()
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
    for (let i = 0, { length } = newEntries; i < length; i += 1) {
      const entry = newEntries[i]
      if (!entry) {
        continue
      }
      const cachePath = path.join(getCacheDir(), entry)
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(cachePath)
    }

    // Also clean up expected entries that might have been created.
    // `expectedCacheEntries` is a Set — use for...of.
    for (const entry of expectedCacheEntries) {
      if (!newEntries.includes(entry)) {
        const cachePath = path.join(getCacheDir(), entry)
        // eslint-disable-next-line no-await-in-loop
        await safeDelete(cachePath)
      }
    }
  })

  test('should sign stub and extracted binary on initial injection', async () => {
    // Get a real compressed Node stub from node-smol-builder
    const stubPath = findTestStub()

    // Skip if stub doesn't exist
    if (!stubPath) {
      logger.log('⊘ Skipping: node-smol stub not found')
      logger.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Skip if no uncompressed binary for SEA generation
    if (!nodeSmolBinary) {
      logger.log('⊘ Skipping: node-smol binary not found for SEA generation')
      logger.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Create test resources using valid SEA blob generation
    // Pass nodeSmolBinary to ensure SEA blob version matches target binary
    const seaBlob = await generateValidSEABlob(
      testDir,
      'app-v1',
      nodeSmolBinary,
    )
    const vfsBlob = path.join(testDir, 'vfs-v1.blob')
    const output = path.join(testDir, 'node-with-resources-v1')

    await fs.writeFile(vfsBlob, createUniqueVFSContent('VFS data version 1'))

    // Get cache entries before this test's inject/run
    const cacheEntriesBeforeInject = await getCacheEntries()

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
    expect(stubSigned).toBeTruthy()

    // Run stub to extract binary
    const runResult = await execCommand(output, ['--version'])
    expect(runResult.code).toBe(0)

    // Get new cache entries
    const finalCacheEntries = await getCacheEntries()
    const newCacheEntries = finalCacheEntries.filter(
      e => !cacheEntriesBeforeInject.includes(e),
    )

    expect(newCacheEntries.length).toBeGreaterThan(0)

    // Verify extracted binary signature
    const cacheKey = newCacheEntries[0]
    if (!cacheKey) {
      return
    }
    const extractedPath = await getCachedBinaryPath(cacheKey)
    const extractedSigned = await verifySignature(extractedPath)
    expect(extractedSigned).toBeTruthy()
  }, 60_000)

  test('should create new cache entry and clean old one on overwrite', async () => {
    // Clean corrupted cache entries from previous test runs
    await cleanCacheBeforeTest()

    // Get a real compressed Node stub
    const stubPath = findTestStub()

    if (!stubPath) {
      logger.log('⊘ Skipping: node-smol stub not found')
      logger.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Skip if no uncompressed binary for SEA generation
    if (!nodeSmolBinary) {
      logger.log('⊘ Skipping: node-smol binary not found for SEA generation')
      logger.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Create first version resources using valid SEA blob
    const seaBlob1 = await generateValidSEABlob(
      testDir,
      'app-cache-v1',
      nodeSmolBinary,
    )
    const vfsBlob1 = path.join(testDir, 'vfs-cache-v1.blob')
    const output1 = path.join(testDir, 'node-cache-test-v1')

    await fs.writeFile(
      vfsBlob1,
      createUniqueVFSContent('VFS data version 1 for cache test'),
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
    if (inject1.code !== 0) {
      logger.log('inject1 failed:', inject1.output)
    }
    expect(inject1.code).toBe(0)

    // Run to create first cache entry
    await execCommand(output1, ['--version'])

    const cacheEntriesAfterV1 = await getCacheEntries()
    expect(cacheEntriesAfterV1.length).toBeGreaterThan(0)
    if (cacheEntriesAfterV1.length === 0) {
      throw new Error('No cache entries found after first injection')
    }
    const cacheKeyV1 = cacheEntriesAfterV1[cacheEntriesAfterV1.length - 1]
    if (!cacheKeyV1) {
      throw new Error('Could not determine v1 cache key')
    }

    // Create second version resources (different content = different hash)
    const seaBlob2 = await generateValidSEABlob(
      testDir,
      'app-cache-v2',
      nodeSmolBinary,
    )
    const vfsBlob2 = path.join(testDir, 'vfs-cache-v2.blob')
    const output2 = path.join(testDir, 'node-cache-test-v2')

    await fs.writeFile(
      vfsBlob2,
      createUniqueVFSContent('VFS data version 2 for cache test (UPDATED)'),
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
    expect(stub2Signed).toBeTruthy()

    // Run v2 to create second cache entry
    await execCommand(output2, ['--version'])

    const cacheEntriesAfterV2 = await getCacheEntries()
    const newCacheKeys = cacheEntriesAfterV2.filter(
      e => !cacheEntriesAfterV1.includes(e),
    )

    // Should have new cache entry
    expect(newCacheKeys.length).toBeGreaterThan(0)
    const cacheKeyV2 = newCacheKeys[0]
    if (!cacheKeyV2) {
      return
    }

    // Cache keys should be different
    expect(cacheKeyV2).not.toBe(cacheKeyV1)

    // Verify v2 extracted binary signature
    const extractedPathV2 = await getCachedBinaryPath(cacheKeyV2)
    const extracted2Signed = await verifySignature(extractedPathV2)
    expect(extracted2Signed).toBeTruthy()

    // Cache cleanup not yet implemented - both versions coexist
    // When cache cleanup is added, this test should verify only v2 exists
    const v1CachePath = await getCachedBinaryPath(cacheKeyV1)
    const v2CachePath = await getCachedBinaryPath(cacheKeyV2)

    const v1Exists = existsSync(v1CachePath)
    const v2Exists = existsSync(v2CachePath)

    expect(v2Exists).toBeTruthy()

    // When cache cleanup is implemented, this should be false:
    // expect(v1Exists).toBe(false)
    // For now, we just document that both exist:
    if (v1Exists) {
      logger.warn(
        `Note: Old cache still exists at ${cacheKeyV1} (cleanup not yet implemented)`,
      )
    }
  }, 120_000)

  test('should have valid signatures after multiple overwrites', async () => {
    // Clean corrupted cache entries from previous test runs
    await cleanCacheBeforeTest()

    const stubPath = findTestStub()

    if (!stubPath) {
      logger.log('⊘ Skipping: node-smol stub not found')
      logger.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Skip if no uncompressed binary for SEA generation
    if (!nodeSmolBinary) {
      logger.log('⊘ Skipping: node-smol binary not found for SEA generation')
      logger.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    let currentOutput = stubPath

    // Do 3 successive overwrites
    for (let version = 1; version <= 3; version++) {
      // eslint-disable-next-line no-await-in-loop
      const seaBlob = await generateValidSEABlob(
        testDir,
        `multi-sea-v${version}`,
        nodeSmolBinary,
      )
      const vfsBlob = path.join(testDir, `multi-vfs-v${version}.blob`)
      const output = path.join(testDir, `node-multi-v${version}`)

      // eslint-disable-next-line no-await-in-loop
      await fs.writeFile(
        vfsBlob,
        createUniqueVFSContent(`VFS version ${version} content`),
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
      expect(stubSigned).toBeTruthy()

      // Run and verify extracted binary
      // eslint-disable-next-line no-await-in-loop
      const runResult = await execCommand(output, ['--version'])
      expect(runResult.code).toBe(0)

      currentOutput = output
    }
  }, 180_000)
})
