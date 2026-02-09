/**
 * SEA JSON Config Tests
 *
 * Tests automatic SEA blob generation from JSON config files.
 * Verifies that binject correctly handles --sea with .json files by:
 * 1. Running node --experimental-sea-config
 * 2. Finding the generated blob
 * 3. Injecting it into the binary
 */

import { spawn } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { safeDelete } from '@socketsecurity/lib/fs'

import { MAX_NODE_BINARY_SIZE } from './helpers/constants.mjs'
import { getBinjectPath } from './helpers/paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()

let testDir
let binjectExists = false
let nodeBinary = null

/**
 * Download latest node-smol release from GitHub
 * Returns path to downloaded binary in cache directory
 */
async function downloadNodeSmolRelease() {
  try {
    // Use a persistent cache directory (not testDir which gets cleaned up)
    const cacheDir = path.join(os.tmpdir(), 'binject-node-cache')
    await fs.mkdir(cacheDir, { recursive: true })

    // Get latest release info using gh CLI
    const { stdout: releaseJson } = await execCommand('gh', [
      'release',
      'view',
      '--repo',
      'SocketDev/socket-btm',
      '--json',
      'tagName,assets',
    ])

    const release = JSON.parse(releaseJson)
    if (!release || !release.tagName || !release.assets) {
      return null
    }

    // Determine platform-specific asset name
    const platform = os.platform()
    const arch = os.arch()
    let assetPattern

    if (platform === 'darwin') {
      assetPattern = `node-smol-.*-darwin-${arch}.tar.gz`
    } else if (platform === 'linux') {
      assetPattern = `node-smol-.*-linux-${arch}.tar.gz`
    } else if (platform === 'win32') {
      assetPattern = `node-smol-.*-win-${arch}.zip`
    } else {
      return null
    }

    // Find matching asset
    const asset = release.assets.find(a =>
      new RegExp(assetPattern).test(a.name),
    )
    if (!asset) {
      return null
    }

    const ext = platform === 'win32' ? '.exe' : ''
    const cachedBinary = path.join(cacheDir, `node-${release.tagName}${ext}`)

    // Check if already downloaded and cached
    try {
      await fs.access(cachedBinary, fs.constants.X_OK)
      return cachedBinary
    } catch {
      // Not cached, proceed with download
    }

    // Download asset to cache directory
    const downloadPath = path.join(cacheDir, asset.name)
    await execCommand('gh', [
      'release',
      'download',
      release.tagName,
      '--repo',
      'SocketDev/socket-btm',
      '--pattern',
      asset.name,
      '--dir',
      cacheDir,
    ])

    // Extract archive
    const extractedBinary = path.join(cacheDir, `node${ext}`)

    if (asset.name.endsWith('.tar.gz')) {
      await execCommand('tar', ['-xzf', downloadPath, '-C', cacheDir])
    } else if (asset.name.endsWith('.zip')) {
      await execCommand('unzip', ['-o', downloadPath, '-d', cacheDir])
    }

    // Rename to include version tag for cache identification
    await fs.rename(extractedBinary, cachedBinary)

    // Verify cached binary exists and is executable
    await fs.access(cachedBinary, fs.constants.X_OK)
    return cachedBinary
  } catch {
    return null
  }
}

/**
 * Find a suitable Node.js binary for testing
 * Priority: local node-smol build > released node-smol > system Node.js
 */
async function findNodeBinary() {
  // Check for node-smol-builder output in the monorepo
  const nodeSmolBuilderDir = path.join(
    __dirname,
    '..',
    '..',
    'node-smol-builder',
  )
  const possiblePaths = [
    // Relative to binject package - check build directories first (CI pattern)
    path.join(nodeSmolBuilderDir, 'build', 'dev', 'out', 'Final', 'node'),
    path.join(nodeSmolBuilderDir, 'build', 'prod', 'out', 'Final', 'node'),
    path.join(nodeSmolBuilderDir, 'build', 'dev', 'out', 'Final', 'node.exe'),
    path.join(nodeSmolBuilderDir, 'build', 'prod', 'out', 'Final', 'node.exe'),
    // Fallback to simple out/ directory (local builds)
    path.join(nodeSmolBuilderDir, 'out', 'Final', 'node'),
    path.join(nodeSmolBuilderDir, 'out', 'Final', 'node.exe'),
    // Common installation paths
    path.join(os.homedir(), '.btm', 'node'),
    path.join(os.homedir(), '.btm', 'node.exe'),
    '/usr/local/bin/node-smol',
    '/opt/btm/node',
  ]

  // Try each path
  for (const binaryPath of possiblePaths) {
    try {
      // Check if file exists and is executable
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(binaryPath)
      if (stats.isFile()) {
        // Try to access with execute permission
        // eslint-disable-next-line no-await-in-loop
        await fs.access(binaryPath, fs.constants.X_OK)
        return binaryPath
      }
    } catch {
      // Continue to next path
    }
  }

  // Try downloading latest release from GitHub
  const downloadedBinary = await downloadNodeSmolRelease()
  if (downloadedBinary) {
    return downloadedBinary
  }

  // Fall back to system Node.js
  return process.execPath
}

/**
 * Create a copy of BINJECT for a test to use as input (-e parameter)
 *
 * The injection process modifies the input binary in-place to remove signatures,
 * so each test needs its own copy to avoid affecting other tests.
 */
async function createTestBinject(name = 'test-binject') {
  const testBinject = path.join(testDir, name)
  await fs.copyFile(BINJECT, testBinject)
  await fs.chmod(testBinject, 0o755)
  return testBinject
}

async function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
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
      resolve({
        code: code ?? -1,
        stdout,
        stderr,
        output: stdout + stderr,
      })
    })
  })
}

describe('SEA JSON Config', () => {
  beforeAll(async () => {
    // Check if binject binary exists
    binjectExists = existsSync(BINJECT)
    if (!binjectExists) {
      // Skip tests gracefully if binary not built yet
      return
    }

    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-json-'))

    // Find suitable Node.js binary for testing
    const foundBinary = await findNodeBinary()

    // Check if binary is small enough for binject
    const stats = await fs.stat(foundBinary)
    if (stats.size > MAX_NODE_BINARY_SIZE) {
      console.warn(
        `Node binary too large for binject tests: ${(stats.size / 1024 / 1024).toFixed(2)}MB > ${MAX_NODE_BINARY_SIZE / 1024 / 1024}MB`,
      )
      console.warn(
        'Skipping tests - node-smol not available and system Node.js too large',
      )
      binjectExists = false
      return
    }

    // CRITICAL: ALWAYS copy node binary to tmpdir to avoid corrupting ANY node installation
    const ext = os.platform() === 'win32' ? '.exe' : ''
    nodeBinary = path.join(testDir, `node-copy${ext}`)
    await fs.copyFile(foundBinary, nodeBinary)
    await fs.chmod(nodeBinary, 0o755)
  })

  beforeEach(ctx => {
    if (!binjectExists) {
      ctx.skip()
    }
  })

  afterAll(async () => {
    if (testDir) {
      await safeDelete(testDir)
    }
  })

  it('should auto-generate blob from JSON config with relative path', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'hello.js')
    await fs.writeFile(jsFile, "console.log('Hello from SEA!');\n")

    // Create SEA config with relative output path
    const configFile = path.join(testDir, 'sea-config.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'hello.js',
        output: 'sea-prep.blob',
      }),
    )

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs.blob')
    await fs.writeFile(vfsBlob, 'VFS data\n')

    // Create output binary
    const outputBinary = path.join(testDir, 'output-relative')

    // Create a copy of binject for this test (injection modifies input in-place)
    const testBinject = await createTestBinject('test-binject-relative')

    // Run binject from the test directory (so relative paths work)
    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        testBinject,
        '-o',
        outputBinary,
        '--sea',
        configFile,
        '--vfs',
        vfsBlob,
      ],
      { cwd: testDir },
    )

    // Should succeed
    expect(result.code).toBe(0)

    // Should show it detected JSON config
    expect(result.output).toMatch(/Detected SEA config file/)
    expect(result.output).toMatch(/Generating SEA blob/)
    expect(result.output).toMatch(/Generated SEA blob/)

    // Should have created the blob file in the same directory
    const generatedBlob = path.join(testDir, 'sea-prep.blob')
    expect(existsSync(generatedBlob)).toBe(true)

    // Should have created output binary
    expect(existsSync(outputBinary)).toBe(true)
  }, 60_000)

  it('should auto-generate blob from JSON config with absolute path', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app.js')
    await fs.writeFile(jsFile, "console.log('App running');\n")

    // Create SEA config with absolute path for main, relative for output
    // (binject rejects absolute paths in output for security)
    const configFile = path.join(testDir, 'sea-config-abs.json')
    const relativeBlobPath = 'absolute-output.blob'
    const absoluteBlobPath = path.join(testDir, relativeBlobPath)
    await fs.writeFile(
      configFile,
      JSON.stringify({
        // Absolute path for main too
        main: path.join(testDir, 'app.js'),
        // Must be relative for security
        output: relativeBlobPath,
      }),
    )

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-abs.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    // Create output binary
    const outputBinary = path.join(testDir, 'output-absolute')

    // Create a copy of binject for this test (injection modifies input in-place)
    const testBinject = await createTestBinject('test-binject-absolute')

    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        testBinject,
        '-o',
        outputBinary,
        '--sea',
        configFile,
        '--vfs',
        vfsBlob,
      ],
      // Run from testDir so relative output path works
      { cwd: testDir },
    )

    // Should succeed
    expect(result.code).toBe(0)

    // Should show it detected JSON config
    expect(result.output).toMatch(/Detected SEA config file/)
    expect(result.output).toMatch(/Generating SEA blob/)

    // Should have created the blob at absolute path
    expect(existsSync(absoluteBlobPath)).toBe(true)

    // Should have created output binary
    expect(existsSync(outputBinary)).toBe(true)
  }, 60_000)

  it('should handle JSON config in subdirectory', async () => {
    // Create subdirectory
    const subdir = path.join(testDir, 'config')
    await fs.mkdir(subdir, { recursive: true })

    // Create JS file in subdirectory
    const jsFile = path.join(subdir, 'index.js')
    await fs.writeFile(jsFile, "console.log('Subdir app');\n")

    // Create SEA config in subdirectory
    const configFile = path.join(subdir, 'sea-config.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'index.js',
        output: 'app.blob',
      }),
    )

    // Create VFS blob
    const vfsBlob = path.join(subdir, 'vfs-subdir.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    // Create output binary (parent directory)
    const outputBinary = path.join(testDir, 'output-subdir')

    // Create a copy of binject for this test (injection modifies input in-place)
    const testBinject = await createTestBinject('test-binject-subdir')

    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        testBinject,
        '-o',
        outputBinary,
        '--sea',
        configFile,
        '--vfs',
        vfsBlob,
      ],
      { cwd: subdir },
    )

    // Should succeed
    expect(result.code).toBe(0)

    // Should have created the blob file in subdirectory
    const generatedBlob = path.join(subdir, 'app.blob')
    expect(existsSync(generatedBlob)).toBe(true)
  }, 60_000)

  it('should error gracefully if JSON config is invalid', async () => {
    // Create invalid JSON config
    const configFile = path.join(testDir, 'invalid-config.json')
    await fs.writeFile(configFile, '{ "main": "app.js", invalid json }')

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-invalid.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    const outputBinary = path.join(testDir, 'output-invalid')

    // Create a copy of binject for this test (injection modifies input in-place)
    const testBinject = await createTestBinject('test-binject-invalid')

    const result = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinject,
      '-o',
      outputBinary,
      '--sea',
      configFile,
      '--vfs',
      vfsBlob,
    ])

    // Should fail
    expect(result.code).not.toBe(0)

    // Should show error about node command failing
    expect(result.output).toMatch(/node --experimental-sea-config failed/)
  }, 30_000)

  it('should error if output field is missing from config', async () => {
    // Create JS file
    const jsFile = path.join(testDir, 'missing-output.js')
    await fs.writeFile(jsFile, "console.log('test');\n")

    // Create config without output field
    const configFile = path.join(testDir, 'no-output.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'missing-output.js',
      }),
    )

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-no-output.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    const outputBinary = path.join(testDir, 'output-no-field')

    // Create a copy of binject for this test (injection modifies input in-place)
    const testBinject = await createTestBinject('test-binject-no-output')

    const result = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinject,
      '-o',
      outputBinary,
      '--sea',
      configFile,
      '--vfs',
      vfsBlob,
    ])

    // Should fail
    expect(result.code).not.toBe(0)

    // Should show error about parsing output field
    expect(result.output).toMatch(
      /Could not parse 'output' field from config|node --experimental-sea-config failed/,
    )
  }, 30_000)

  it('should work with .blob file directly (not JSON)', async () => {
    // Create a pre-generated blob file
    const blobFile = path.join(testDir, 'manual.blob')
    await fs.writeFile(blobFile, 'Pre-generated SEA blob\n')

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-manual.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    const outputBinary = path.join(testDir, 'output-manual')

    // Create a copy of binject for this test (injection modifies input in-place)
    const testBinject = await createTestBinject('test-binject-manual')

    const result = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinject,
      '-o',
      outputBinary,
      '--sea',
      blobFile,
      '--vfs',
      vfsBlob,
    ])

    // Should succeed
    expect(result.code).toBe(0)

    // Should NOT show JSON detection messages
    expect(result.output).not.toMatch(/Detected SEA config file/)
    expect(result.output).not.toMatch(/Generating SEA blob/)
  }, 30_000)
})
