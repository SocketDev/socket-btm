/**
 * CLI Integration Tests for binject
 * Tests all command-line flags, help output, and user-facing workflows
 */

import { spawn } from 'node:child_process'
import { promises as fs, constants as FS_CONSTANTS } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'

import { MAX_NODE_BINARY_SIZE } from './helpers/constants.mjs'
import { getBinjectPath } from './helpers/paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false
let nodeBinary = null

/**
 * Download latest node-smol release from GitHub
 * Returns path to downloaded binary in a cache directory (can be copied repeatedly)
 */
async function downloadNodeSmolRelease() {
  try {
    // Use a persistent cache directory (not testDir which gets cleaned up)
    const cacheDir = path.join(os.tmpdir(), 'binject-node-cache')
    await safeMkdir(cacheDir)

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
    let assetPattern: string

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
      await fs.access(cachedBinary, FS_CONSTANTS.X_OK)
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
    await fs.access(cachedBinary, FS_CONSTANTS.X_OK)
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
  const nodeSmolBuilderDir = path.join(PROJECT_ROOT, '..', 'node-smol-builder')
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

  // Try each path sequentially
  for (const binaryPath of possiblePaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.access(binaryPath, FS_CONSTANTS.X_OK)
      return binaryPath
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

async function execCommand(command, args = []) {
  return new Promise((resolve, _reject) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr.on('data', data => {
      stderr += data.toString()
    })

    proc.on('error', err => {
      // Handle spawn errors (ENOENT, EACCES, etc.)
      // Command not found
      resolve({
        code: 127,
        stdout,
        stderr: `${stderr}\nSpawn error: ${err.message}`,
        output: `${stdout + stderr}\nSpawn error: ${err.message}`,
        error: err,
      })
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

/**
 * Create a copy of the real Node.js binary for testing
 *
 * This ensures we test with valid, real binaries across all platforms.
 * The copy is created in tmpdir to avoid corrupting the source binary.
 *
 * For compressed node-smol binaries:
 * - Simply copies the stub to tmpdir
 * - Tests will inject into the stub, which will handle extraction/repacking internally
 *
 * For regular Node binaries:
 * - Copies the binary directly to tmpdir
 */
async function createTestBinary(name) {
  const filePath = path.join(testDir, name)

  // Simply copy nodeBinary (works for both regular Node and node-smol stubs)
  // If it's a compressed stub, binject will handle extraction and repacking
  await fs.copyFile(nodeBinary, filePath)
  await fs.chmod(filePath, 0o755)

  return filePath
}

async function createTestResource(name) {
  const filePath = path.join(testDir, name)
  await fs.writeFile(filePath, 'Test resource data\n')
  return filePath
}

describe('binject CLI', () => {
  beforeAll(async () => {
    // Check if binject binary exists
    console.log('Checking for BINJECT at:', BINJECT)
    try {
      await fs.access(BINJECT, FS_CONSTANTS.X_OK)
      const stats = await fs.stat(BINJECT)
      console.log(
        'BINJECT found! Size:',
        stats.size,
        'Mode:',
        stats.mode.toString(8),
      )
      binjectExists = true
    } catch (err) {
      console.error('BINJECT not accessible:', err.code, err.message)
      binjectExists = false
      // Skip tests gracefully if binary not built yet
      return
    }

    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-test-'))

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
    console.log('Copied node binary to tmpdir:', nodeBinary)
  })

  beforeEach(ctx => {
    if (!binjectExists) {
      ctx.skip()
    }
  })

  afterAll(async () => {
    // Cleanup
    if (testDir) {
      await safeDelete(testDir)
    }
  })

  describe('Help and Version', () => {
    it('--help should show Usage section', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('Usage:')
    })

    it('--help should show Commands section', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('Commands:')
    })

    it('--help should show Options section', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('Options:')
    })

    it('--help should document inject command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('inject')
    })

    it('--help should document list command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('list')
    })

    it('--help should document extract command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('extract')
    })

    it('--help should document verify command', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('verify')
    })

    it('--help should document -e flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('-e')
    })

    it('--help should document --executable flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--executable')
    })

    it('--help should document -o flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('-o')
    })

    it('--help should document --output flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--output')
    })

    it('--help should document --sea flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--sea')
    })

    it('--help should document --vfs flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--vfs')
    })

    it('--help should document --vfs-in-memory flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--vfs-in-memory')
    })

    it('--help should document --vfs-on-disk flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--vfs-on-disk')
    })

    it('--help should document --update-config flag', async () => {
      const { output } = await execCommand(BINJECT, ['--help'])
      expect(output).toContain('--update-config')
      expect(output).toContain('update-config.json')
    })

    it('should accept both --vfs-on-disk and --vfs-in-memory flags together', async () => {
      const binary = await createTestBinary('test-both-flags.bin')
      const seaResource = await createTestResource('test-both.blob')
      const vfsResource = await createTestResource('test-both.tar')
      const output = path.join(testDir, 'output-both-flags.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs-on-disk',
        vfsResource,
        '--vfs-in-memory',
      ])

      // Should not error - both flags are valid together
      expect(result.output).toMatch(/(Success|both|injected)/i)
      await expect(
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })

    it('--version should show program name', async () => {
      const { output } = await execCommand(BINJECT, ['--version'])
      expect(output).toContain('binject')
    })

    it('--version should show version number', async () => {
      const { output } = await execCommand(BINJECT, ['--version'])
      // Accept both semver (1.2.3) and git-style (20251212-abc123) versions
      expect(output).toMatch(/([0-9]+\.[0-9]+\.[0-9]+|[0-9]+-[a-f0-9]+)/)
    })
  })

  describe('Argument Validation', () => {
    it('inject without args should show error', async () => {
      const result = await execCommand(BINJECT, ['inject'])
      expect(result.output).toContain('requires')
    })

    it('inject without --executable should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '--sea',
        'test.blob',
      ])
      expect(result.output).toContain('executable')
    })

    it('inject without --output should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        'test.bin',
        '--sea',
        'test.blob',
      ])
      expect(result.output).toContain('output')
    })

    it('inject without --sea or --vfs should show error', async () => {
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        'test.bin',
        '-o',
        'out.bin',
      ])
      expect(result.output).toMatch(/sea|vfs/)
    })

    it('inject with nonexistent executable should show error', async () => {
      const resource = await createTestResource('test.blob')
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        '/nonexistent/binary',
        '-o',
        'out.bin',
        '--sea',
        resource,
      ])
      expect(result.output).toMatch(/(not found|cannot open|error|unknown)/i)
    })

    it('inject with nonexistent resource should show error', async () => {
      const binary = await createTestBinary('test.bin')
      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        'out.bin',
        '--sea',
        '/nonexistent/resource',
      ])
      expect(result.output).toMatch(/(not found|cannot open|error)/i)
    })
  })

  describe('Single Resource Injection', () => {
    it('--sea injection should create output file', async () => {
      // Copy binject binary itself to a temp location we can modify (much smaller than Node.js)
      const binary = path.join(testDir, 'test-binary')
      await fs.copyFile(BINJECT, binary)
      await fs.chmod(binary, 0o755)

      const resource = await createTestResource('test.blob')
      const output = path.join(testDir, 'output-sea.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      // All platforms should succeed with --sea injection
      expect(result.output).toMatch(/(Success|injected)/i)
      await expect(
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })

    it('--vfs without --sea should show error', async () => {
      const binary = await createTestBinary('test-vfs-only.bin')
      const resource = await createTestResource('test.tar')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        path.join(testDir, 'out.bin'),
        '--vfs',
        resource,
      ])

      // Should error with helpful message about requiring --sea
      expect(result.code).not.toBe(0)
      expect(result.output).toMatch(/--vfs requires --sea/i)
      expect(result.output).toMatch(/Virtual File System.*alongside.*SEA/i)
    })
  })

  describe('Batch Injection', () => {
    it('batch injection (--sea + --vfs) should create output file', async () => {
      const binary = await createTestBinary('test-batch.bin')
      const seaResource = await createTestResource('test.blob')
      const vfsResource = await createTestResource('test.tar')
      const output = path.join(testDir, 'output-batch.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs',
        vfsResource,
      ])

      expect(result.output).toMatch(/(Success|both|injected)/i)
      await expect(
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })

    it('batch injection should modify binary', async () => {
      const binary = await createTestBinary('test-batch2.bin')
      const seaResource = await createTestResource('test2.blob')
      const vfsResource = await createTestResource('test2.tar')
      const output = path.join(testDir, 'output-batch2.bin')

      const _result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        seaResource,
        '--vfs',
        vfsResource,
      ])

      const inputData = await fs.readFile(binary)
      const outputData = await fs.readFile(output)
      expect(Buffer.compare(inputData, outputData)).not.toBe(0)
    })
  })

  describe('Output Parameter', () => {
    it('inject without -o should show error about missing output', async () => {
      const binary = await createTestBinary('test-no-output.bin')
      const resource = await createTestResource('test.blob')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '--sea',
        resource,
      ])
      expect(result.output).toContain('output')
    })

    it('inject should create output in different directory', async () => {
      // Copy binject binary itself to a temp location we can modify (much smaller than Node.js)
      const binary = path.join(testDir, 'test-binary-dir')
      await fs.copyFile(BINJECT, binary)
      await fs.chmod(binary, 0o755)

      const resource = await createTestResource('test.blob')
      const subdir = path.join(testDir, 'subdir')
      await fs.mkdir(subdir, { recursive: true })
      const output = path.join(subdir, 'output.bin')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        output,
        '--sea',
        resource,
      ])

      // All platforms should succeed with --sea injection
      expect(result.code).toBe(0)
      await expect(
        fs.access(output, FS_CONSTANTS.F_OK),
      ).resolves.toBeUndefined()
    })
  })

  describe('Auto-Overwrite Behavior', () => {
    it('should auto-overwrite on three sequential injections', async () => {
      // Copy Node binary to temp directory for modification
      const binary = await createTestBinary('test-binary-overwrite')

      const resource1 = await createTestResource('test1.blob')
      const resource2 = await createTestResource('test2.blob')
      const resource3 = await createTestResource('test3.blob')

      // First injection
      // Use tmpdir to avoid in-place modification issues on Windows
      const tmpOutput1 = path.join(testDir, 'tmp-output1')
      const result1 = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        tmpOutput1,
        '--sea',
        resource1,
      ])

      if (result1.code !== 0) {
        console.error('First injection failed:')
        console.error('Exit code:', result1.code)
        console.error('Output:', result1.output)
      }
      expect(result1.code).toBe(0)
      expect(result1.output).toMatch(/(Success|injected)/i)

      // Move tmpOutput1 back to binary
      await safeDelete(binary)
      await fs.rename(tmpOutput1, binary)
      await fs.chmod(binary, 0o755)

      // Second injection (should auto-overwrite)
      const tmpOutput2 = path.join(testDir, 'tmp-output2')
      const result2 = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        tmpOutput2,
        '--sea',
        resource2,
      ])

      if (result2.code !== 0) {
        console.error('Second injection failed:')
        console.error('Exit code:', result2.code)
        console.error('Output:', result2.output)
      }
      expect(result2.code).toBe(0)
      expect(result2.output).toMatch(/(Success|injected)/i)

      // Move tmpOutput2 back to binary
      await safeDelete(binary)
      await fs.rename(tmpOutput2, binary)
      await fs.chmod(binary, 0o755)

      // Third injection (should still auto-overwrite)
      const tmpOutput3 = path.join(testDir, 'tmp-output3')
      const result3 = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        tmpOutput3,
        '--sea',
        resource3,
      ])

      if (result3.code !== 0) {
        console.error('Third injection failed:')
        console.error('Exit code:', result3.code)
        console.error('Output:', result3.output)
      }
      expect(result3.code).toBe(0)
      expect(result3.output).toMatch(/(Success|injected)/i)

      // Move tmpOutput3 back to binary
      await safeDelete(binary)
      await fs.rename(tmpOutput3, binary)
      await fs.chmod(binary, 0o755)
    })
  })

  describe('List Command', () => {
    it('list command should run on binary', async () => {
      const binary = await createTestBinary('test-list.bin')

      const result = await execCommand(BINJECT, ['list', binary])
      expect(result.output).toMatch(/(Listing|resources|sections)/i)
    })
  })

  describe('Extract Command', () => {
    it('extract without section flag should show error', async () => {
      const binary = await createTestBinary('test-extract.bin')

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '-o',
        'output.blob',
      ])
      expect(result.output).toMatch(/(sea|vfs|either)/i)
    })

    it('extract without --output should show error', async () => {
      const binary = await createTestBinary('test-extract2.bin')

      const result = await execCommand(BINJECT, [
        'extract',
        '-e',
        binary,
        '--sea',
      ])
      expect(result.output).toMatch(/output/i)
    })
  })

  describe('Verify Command', () => {
    it('verify without section flag should show error', async () => {
      const binary = await createTestBinary('test-verify.bin')

      const result = await execCommand(BINJECT, ['verify', '-e', binary])
      expect(result.output).toMatch(/(sea|vfs|either)/i)
    })
  })

  describe('Invalid Flag Combinations', () => {
    it('--sea and --vfs together should enable batch injection', async () => {
      const binary = await createTestBinary('test-flags.bin')
      const resource = await createTestResource('test.blob')

      const result = await execCommand(BINJECT, [
        'inject',
        '-e',
        binary,
        '-o',
        path.join(testDir, 'out.bin'),
        '--sea',
        resource,
        '--vfs',
        resource,
      ])

      expect(result.output).toMatch(/(Success|both|batch|injected)/i)
    })
  })
})
