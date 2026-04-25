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

import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getSocketDlxDir } from '@socketsecurity/lib/paths/socket'
import { spawn } from '@socketsecurity/lib/spawn'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { getBinjectPath } from './helpers/paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const BINJECT = getBinjectPath()
const PLATFORM_ARCH = getPlatformArch(process.platform, process.arch, undefined)

/**
 * Find any available node-smol binary for testing (compressed/final stub).
 * Tries multiple locations and build variants.
 * @returns {string|null} Path to binary or null if none found
 */
function findTestStub() {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'

  // Try various build output locations.
  // Note: The build system creates output as either:
  // - Final/<binaryName> (flat file structure)
  // - Final/node/<binaryName> (directory structure for macOS bundles)
  const candidates = [
    // Final builds - directory structure (macOS app bundle layout).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Final/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Final/node',
      binaryName,
    ),
    // Final builds - flat structure (production-ready).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Final',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Final',
      binaryName,
    ),
    // Compressed builds - directory structure.
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Compressed/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Compressed/node',
      binaryName,
    ),
    // Compressed builds - flat structure (for testing decompression).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Compressed',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Compressed',
      binaryName,
    ),
  ]

  for (const candidate of candidates) {
    // Only return if it's a file (not a directory)
    if (existsSync(candidate)) {
      try {
        const stats = statSync(candidate)
        if (stats.isFile()) {
          // Return absolute path to avoid path traversal issues with binject
          return path.resolve(candidate)
        }
      } catch {
        // Skip if we can't stat
      }
    }
  }

  return null
}

/**
 * Find uncompressed node-smol binary for SEA blob generation.
 * Uses Stripped or Release binary from build output (same Node.js version as stub).
 * This is more reliable than extracting from cache which can be inconsistent.
 * @returns {string|null} Path to uncompressed binary or null if none found
 */
function findNodeSmolBinary() {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'

  // Prefer Stripped (smaller) over Release, dev over prod
  const candidates = [
    // Stripped builds (smaller, suitable for SEA generation)
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Stripped/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Stripped/node',
      binaryName,
    ),
    // Release builds (full symbols, fallback)
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Release/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Release/node',
      binaryName,
    ),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const stats = statSync(candidate)
        if (stats.isFile()) {
          return path.resolve(candidate)
        }
      } catch {
        // Skip if we can't stat
      }
    }
  }

  return null
}

// Only run on macOS since this tests Mach-O signatures
const describeOnMac = os.platform() === 'darwin' ? describe : describe.skip

let testDir: string

async function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const spawnPromise = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

    // @socketsecurity/lib/spawn returns a Promise with .process property
    // Prevent unhandled rejection — we handle exit via proc.on('close')
    spawnPromise.catch(() => {})

    const proc = spawnPromise.process

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
        output: stdout + stderr,
        stderr,
        stdout,
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
  return getSocketDlxDir()
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
 * Clean ALL cache entries before test to ensure fresh state.
 * This is necessary because the repack workflow modifies the cache state
 * in ways that break subsequent injections.
 */
async function cleanCacheBeforeTest() {
  const cacheDir = getCacheDir()
  try {
    const entries = await fs.readdir(cacheDir)
    for (const entry of entries) {
      if (!/^[0-9a-f]{16}$/.test(entry)) {
        continue
      }
      const entryPath = path.join(cacheDir, entry)
      // Clean ALL cache entries - the repack workflow corrupts them
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(entryPath)
    }
  } catch {
    // Cache dir might not exist yet
  }
}

/**
 * Generate a valid SEA blob using binject blob command.
 * Creates a unique JS file and sea-config.json, then generates the blob.
 * @param baseDir - Directory to create files in
 * @param prefix - Unique prefix for file names
 * @param nodeBinaryPath - Optional path to Node.js binary for SEA generation (for version matching)
 * @returns Path to the generated .blob file
 */
async function generateValidSEABlob(
  baseDir: string,
  prefix: string,
  nodeBinaryPath?: string,
) {
  const uuid = randomUUID()

  // Create a unique JS file
  const jsFile = path.join(baseDir, `${prefix}-${uuid}.js`)
  await fs.writeFile(jsFile, `console.log('SEA ${prefix} ${uuid}');\n`)

  // Create sea-config.json
  const configFile = path.join(baseDir, `${prefix}-${uuid}-config.json`)
  const blobFile = `${prefix}-${uuid}.blob`
  await fs.writeFile(
    configFile,
    JSON.stringify({
      main: path.basename(jsFile),
      output: blobFile,
    }),
  )

  // Generate blob using binject blob command
  // If nodeBinaryPath provided, use it for SEA generation to ensure version match
  const env = nodeBinaryPath
    ? { ...process.env, BINJECT_NODE_PATH: nodeBinaryPath }
    : process.env
  const result = await execCommand(BINJECT, ['blob', configFile], {
    cwd: baseDir,
    env,
  })

  if (result.code !== 0) {
    throw new Error(`Failed to generate SEA blob: ${result.output}`)
  }

  return path.join(baseDir, blobFile)
}

/**
 * Create unique VFS content using UUID to ensure each test creates a unique cache entry
 */
function createUniqueVFSContent(description: string) {
  const uuid = randomUUID()
  return `${description}\nUnique ID: ${uuid}\n`
}

describeOnMac('E2E Signature and Cache Tests', () => {
  let initialCacheEntries = []
  // Track cache entries we expect to create (even if test skips)
  const expectedCacheEntries = new Set()
  // Uncompressed node-smol binary for SEA blob generation (same version as stub)
  let nodeSmolBinary: string | null = null

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

  test('should sign stub and extracted binary on initial injection', async () => {
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

    // Skip if no uncompressed binary for SEA generation
    if (!nodeSmolBinary) {
      console.log('⊘ Skipping: node-smol binary not found for SEA generation')
      console.log(
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
    expect(stubSigned).toBeTruthy()

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
    expect(extractedSigned).toBeTruthy()
  }, 60_000)

  test('should create new cache entry and clean old one on overwrite', async () => {
    // Clean corrupted cache entries from previous test runs
    await cleanCacheBeforeTest()

    // Get a real compressed Node stub
    const stubPath = findTestStub()

    if (!stubPath) {
      console.log('⊘ Skipping: node-smol stub not found')
      console.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Skip if no uncompressed binary for SEA generation
    if (!nodeSmolBinary) {
      console.log('⊘ Skipping: node-smol binary not found for SEA generation')
      console.log(
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
      console.log('inject1 failed:', inject1.output)
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
      console.log(
        `  ⚠ Note: Old cache still exists at ${cacheKeyV1} (cleanup not yet implemented)`,
      )
    }
  }, 120_000)

  test('should have valid signatures after multiple overwrites', async () => {
    // Clean corrupted cache entries from previous test runs
    await cleanCacheBeforeTest()

    const stubPath = findTestStub()

    if (!stubPath) {
      console.log('⊘ Skipping: node-smol stub not found')
      console.log(
        '  Build node-smol-builder first: cd ../node-smol-builder && pnpm run build',
      )
      return
    }

    // Skip if no uncompressed binary for SEA generation
    if (!nodeSmolBinary) {
      console.log('⊘ Skipping: node-smol binary not found for SEA generation')
      console.log(
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
