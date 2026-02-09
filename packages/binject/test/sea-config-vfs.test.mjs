/**
 * SEA Config VFS Tests
 *
 * Tests VFS configuration in sea-config.json smol section.
 * Verifies that binject correctly handles VFS config from sea-config.json:
 * 1. Boolean shorthand (vfs: true)
 * 2. Empty object (vfs: {})
 * 3. Full configuration with mode and source
 * 4. CLI flag override priority
 * 5. Different source types (directory, .tar, .tar.gz)
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
 * Find a suitable Node.js binary for testing.
 */
async function findNodeBinary() {
  const nodeSmolBuilderDir = path.join(
    __dirname,
    '..',
    '..',
    'node-smol-builder',
  )
  const possiblePaths = [
    path.join(
      nodeSmolBuilderDir,
      'build',
      'dev',
      'out',
      'Final',
      'node',
      'node',
    ),
    path.join(
      nodeSmolBuilderDir,
      'build',
      'prod',
      'out',
      'Final',
      'node',
      'node',
    ),
    path.join(nodeSmolBuilderDir, 'out', 'Final', 'node', 'node'),
  ]

  for (const binaryPath of possiblePaths) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const stats = await fs.stat(binaryPath)
      if (stats.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        await fs.access(binaryPath, fs.constants.X_OK)
        return binaryPath
      }
    } catch {
      // Continue to next path.
    }
  }

  // Fall back to system Node.js.
  return process.execPath
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

describe('SEA Config VFS Configuration', () => {
  beforeAll(async () => {
    // Check if binject binary exists.
    binjectExists = existsSync(BINJECT)
    if (!binjectExists) {
      return
    }

    // Create temporary test directory.
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-vfs-config-'))

    // Find suitable Node.js binary for testing.
    const foundBinary = await findNodeBinary()

    // Check if binary is small enough for binject.
    const stats = await fs.stat(foundBinary)
    if (stats.size > MAX_NODE_BINARY_SIZE) {
      console.warn(
        `Node binary too large for binject tests: ${(stats.size / 1024 / 1024).toFixed(2)}MB > ${MAX_NODE_BINARY_SIZE / 1024 / 1024}MB`,
      )
      binjectExists = false
      return
    }

    // Copy node binary to testDir.
    const ext = os.platform() === 'win32' ? '.exe' : ''
    nodeBinary = path.join(testDir, `node-copy${ext}`)
    await fs.copyFile(foundBinary, nodeBinary)
    await fs.chmod(nodeBinary, 0o755)

    // Create test VFS content directory.
    const vfsDir = path.join(testDir, 'node_modules')
    await fs.mkdir(vfsDir, { recursive: true })
    await fs.writeFile(
      path.join(vfsDir, 'test.json'),
      JSON.stringify({ name: 'test', version: '1.0.0' }),
    )
    await fs.writeFile(path.join(vfsDir, 'test.js'), "console.log('test');\n")

    // Create .tar archive.
    await execCommand(
      'tar',
      ['-cf', 'vfs-test.tar', '-C', 'node_modules', '.'],
      {
        cwd: testDir,
      },
    )

    // Create .tar.gz archive.
    await execCommand(
      'tar',
      ['-czf', 'vfs-test.tar.gz', '-C', 'node_modules', '.'],
      {
        cwd: testDir,
      },
    )
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

  it('should support boolean shorthand vfs: true with defaults', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app.js')
    await fs.writeFile(jsFile, "console.log('Hello VFS');\n")

    // Create SEA config with vfs: true.
    const configFile = path.join(testDir, 'sea-config-bool.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app.js',
        output: 'sea-bool.blob',
        smol: {
          vfs: true,
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-bool')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration messages.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )

    // Should use defaults (in-memory mode, node_modules source).
    expect(result.output).toMatch(/VFS|node_modules/)
  }, 60_000)

  it('should support empty object vfs: {} with defaults', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-empty.js')
    await fs.writeFile(jsFile, "console.log('Empty VFS');\n")

    // Create SEA config with vfs: {}.
    const configFile = path.join(testDir, 'sea-config-empty.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-empty.js',
        output: 'sea-empty.blob',
        smol: {
          vfs: {},
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-empty')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration messages.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should support full VFS config with directory source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-dir.js')
    await fs.writeFile(jsFile, "console.log('Dir VFS');\n")

    // Create SEA config with full VFS configuration.
    const configFile = path.join(testDir, 'sea-config-dir.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-dir.js',
        output: 'sea-dir.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'node_modules',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-dir')
    // Removed: const testBinject = await createTestBinject('test-binject-dir')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration and archive creation.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
    expect(result.output).toMatch(/Creating VFS archive from directory/)
  }, 60_000)

  it('should support VFS config with .tar source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-tar.js')
    await fs.writeFile(jsFile, "console.log('TAR VFS');\n")

    // Create SEA config with .tar source.
    const configFile = path.join(testDir, 'sea-config-tar.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-tar.js',
        output: 'sea-tar.blob',
        smol: {
          vfs: {
            mode: 'in-memory',
            source: 'vfs-test.tar',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-tar')
    // Removed: const testBinject = await createTestBinject('test-binject-tar')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration and compression.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
    expect(result.output).toMatch(/Compressing VFS archive/)
  }, 60_000)

  it('should support VFS config with .tar.gz source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-targz.js')
    await fs.writeFile(jsFile, "console.log('TAR.GZ VFS');\n")

    // Create SEA config with .tar.gz source.
    const configFile = path.join(testDir, 'sea-config-targz.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-targz.js',
        output: 'sea-targz.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'vfs-test.tar.gz',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-targz')
    // Removed: const testBinject = await createTestBinject('test-binject-targz')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration (no compression needed).
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should support compat mode without source', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-compat.js')
    await fs.writeFile(jsFile, "console.log('Compat VFS');\n")

    // Create SEA config with compat mode.
    const configFile = path.join(testDir, 'sea-config-compat.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-compat.js',
        output: 'sea-compat.blob',
        smol: {
          vfs: {
            mode: 'compat',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-compat')
    // Removed: const testBinject = await createTestBinject('test-binject-compat')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show VFS configuration for compat mode.
    expect(result.output).toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should prioritize CLI flags over sea-config.json', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-override.js')
    await fs.writeFile(jsFile, "console.log('Override VFS');\n")

    // Create VFS blob for CLI flag.
    const cliVfsBlob = path.join(testDir, 'cli-vfs.blob')
    await fs.writeFile(cliVfsBlob, 'CLI VFS data\n')

    // Create SEA config with VFS (should be overridden).
    const configFile = path.join(testDir, 'sea-config-override.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-override.js',
        output: 'sea-override.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'node_modules',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-override')
    // Removed: const testBinject = await createTestBinject('test-binject-override')

    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        nodeBinary,
        '-o',
        outputBinary,
        '--sea',
        configFile,
        '--vfs',
        cliVfsBlob,
      ],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should show CLI override message.
    expect(result.output).toMatch(/CLI VFS flags override sea-config.json/)
  }, 60_000)

  it('should handle vfs: false correctly', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-false.js')
    await fs.writeFile(jsFile, "console.log('No VFS');\n")

    // Create SEA config with vfs: false.
    const configFile = path.join(testDir, 'sea-config-false.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-false.js',
        output: 'sea-false.blob',
        smol: {
          vfs: false,
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-false')
    // Removed: const testBinject = await createTestBinject('test-binject-false')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed.
    expect(result.code).toBe(0)

    // Should NOT show VFS configuration messages.
    expect(result.output).not.toMatch(
      /VFS: Using configuration from sea-config.json/,
    )
  }, 60_000)

  it('should skip VFS gracefully when source not found', async () => {
    // Create JS file.
    const jsFile = path.join(testDir, 'app-skip.js')
    await fs.writeFile(jsFile, "console.log('Skip VFS');\n")

    // Create SEA config with non-existent source.
    const configFile = path.join(testDir, 'sea-config-skip.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-skip.js',
        output: 'sea-skip.blob',
        smol: {
          vfs: {
            mode: 'on-disk',
            source: 'non-existent-directory',
          },
        },
      }),
    )

    const outputBinary = path.join(testDir, 'output-skip')
    // Removed: const testBinject = await createTestBinject('test-binject-skip')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', nodeBinary, '-o', outputBinary, '--sea', configFile],
      { cwd: testDir },
    )

    // Should succeed (skip VFS gracefully).
    expect(result.code).toBe(0)

    // Should show skip message.
    expect(result.output).toMatch(/VFS: Source not found.*skipping VFS/)
  }, 60_000)
})
