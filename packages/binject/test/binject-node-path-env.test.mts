/**
 * BINJECT_NODE_PATH Environment Variable Tests
 *
 * Tests the BINJECT_NODE_PATH environment variable behavior:
 * 1. When set, uses the specified binary exclusively (no searching)
 * 2. If version doesn't match, disables code cache/bytecode but proceeds
 * 3. If path is invalid, fails with explicit error
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { safeDelete } from '@socketsecurity/lib/fs'
import { spawn } from '@socketsecurity/lib/spawn'

import { getBinjectPath } from './helpers/paths.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()

let testDir: string
let binjectExists = false

async function execCommand(
  command: string,
  args: string[] = [],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return new Promise<{
    code: number
    stdout: string
    stderr: string
    output: string
  }>(resolve => {
    const spawnPromise = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

    // Prevent unhandled rejection — we handle exit via proc.on('close')
    spawnPromise.catch(() => {})

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
      resolve({
        code: code ?? -1,
        output: stdout + stderr,
        stderr,
        stdout,
      })
    })
  })
}

/**
 * Create a copy of BINJECT for a test to use as input (-e parameter)
 */
async function createTestBinject(name = 'test-binject') {
  const testBinject = path.join(testDir, name)
  await fs.copyFile(BINJECT, testBinject)
  await makeExecutable(testBinject)
  return testBinject
}

describe('bINJECT_NODE_PATH environment variable', () => {
  beforeAll(async () => {
    // Check if binject binary exists
    binjectExists = existsSync(BINJECT)
    if (!binjectExists) {
      return
    }

    // Create temporary test directory
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-node-path-'))
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

  it('should use BINJECT_NODE_PATH when set to valid node binary', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    // Create SEA config
    const configFile = path.join(testDir, 'sea-config.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app.js',
        output: 'app.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-valid-path')
    const testBinject = await createTestBinject('test-binject-valid-path')

    // Use process.execPath as the explicit node path
    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: process.execPath,
        },
      },
    )

    // Should succeed
    expect(result.code).toBe(0)

    // Should show it's generating blob (uses the specified node)
    expect(result.output).toMatch(/Generating SEA blob/)
    expect(result.output).toMatch(/Generated SEA blob/)

    // Should have created output binary
    expect(existsSync(outputBinary)).toBeTruthy()
  }, 60_000)

  it('should fail with explicit error when BINJECT_NODE_PATH points to invalid binary', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app-invalid.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    // Create SEA config
    const configFile = path.join(testDir, 'sea-config-invalid.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-invalid.js',
        output: 'app-invalid.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-invalid-path')
    const testBinject = await createTestBinject('test-binject-invalid-path')

    // Point to a non-existent binary
    const invalidPath = path.join(testDir, 'nonexistent-node')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: invalidPath,
        },
      },
    )

    // Should fail
    expect(result.code).not.toBe(0)

    // Should show explicit error about invalid BINJECT_NODE_PATH
    expect(result.output).toMatch(
      /BINJECT_NODE_PATH is set but binary is invalid/,
    )
    expect(result.output).toContain(invalidPath)
  }, 30_000)

  it('should fail when BINJECT_NODE_PATH points to non-executable file', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app-noexec.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    // Create SEA config
    const configFile = path.join(testDir, 'sea-config-noexec.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-noexec.js',
        output: 'app-noexec.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-noexec-path')
    const testBinject = await createTestBinject('test-binject-noexec-path')

    // Create a regular text file (not executable)
    const notExecutable = path.join(testDir, 'not-a-binary.txt')
    await fs.writeFile(notExecutable, 'This is not a binary\n')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: notExecutable,
        },
      },
    )

    // Should fail
    expect(result.code).not.toBe(0)

    // Should show explicit error about invalid BINJECT_NODE_PATH
    expect(result.output).toMatch(
      /BINJECT_NODE_PATH is set but binary is invalid/,
    )
  }, 30_000)

  it('should not search PATH when BINJECT_NODE_PATH is set', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app-nosearch.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    // Create SEA config
    const configFile = path.join(testDir, 'sea-config-nosearch.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-nosearch.js',
        output: 'app-nosearch.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-nosearch')
    const testBinject = await createTestBinject('test-binject-nosearch')

    // Set BINJECT_NODE_PATH to a valid node and clear PATH
    // If binject were still searching PATH, this would fail
    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: process.execPath,
          // Clear PATH to prove we're not searching it
          PATH: '',
        },
      },
    )

    // Should succeed because BINJECT_NODE_PATH is used directly
    expect(result.code).toBe(0)

    // Should have created output binary
    expect(existsSync(outputBinary)).toBeTruthy()
  }, 60_000)

  it('should proceed with version mismatch warning when BINJECT_NODE_PATH version differs', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app-mismatch.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    // Create SEA config
    const configFile = path.join(testDir, 'sea-config-mismatch.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-mismatch.js',
        output: 'app-mismatch.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-mismatch')
    const testBinject = await createTestBinject('test-binject-mismatch')

    // Use current node - when targeting binject (not node-smol), there's no embedded version
    // so this should succeed without version mismatch warnings
    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: process.execPath,
        },
      },
    )

    // Should succeed (version mismatch doesn't block, just disables optimizations)
    expect(result.code).toBe(0)

    // Should have created output binary
    expect(existsSync(outputBinary)).toBeTruthy()
  }, 60_000)

  it('should ignore empty BINJECT_NODE_PATH and fall back to normal search', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app-empty.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    // Create SEA config
    const configFile = path.join(testDir, 'sea-config-empty.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-empty.js',
        output: 'app-empty.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-empty')
    const testBinject = await createTestBinject('test-binject-empty')

    // Set BINJECT_NODE_PATH to empty string
    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: '',
        },
      },
    )

    // Should succeed (falls back to normal PATH search)
    expect(result.code).toBe(0)

    // Should have created output binary
    expect(existsSync(outputBinary)).toBeTruthy()
  }, 60_000)

  it('should handle relative paths correctly', async () => {
    // Create app files
    const jsFile = path.join(testDir, 'app-relative.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    const configFile = path.join(testDir, 'sea-config-relative.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-relative.js',
        output: 'app-relative.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-relative-path')
    const testBinject = await createTestBinject('test-binject-relative-path')

    // Copy node to test directory with a simple name
    const localNode = path.join(testDir, 'my-node')
    await fs.copyFile(process.execPath, localNode)
    await makeExecutable(localNode)

    // Use relative path (from testDir)
    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: './my-node',
        },
      },
    )

    // Should succeed - realpath resolves relative paths
    expect(result.code).toBe(0)
    expect(existsSync(outputBinary)).toBeTruthy()
  }, 60_000)

  it('should handle paths with spaces', async () => {
    // Create directory with spaces
    const dirWithSpaces = path.join(testDir, 'Program Files', 'nodejs')
    await fs.mkdir(dirWithSpaces, { recursive: true })

    // Copy node to path with spaces
    const ext = process.platform === 'win32' ? '.exe' : ''
    const nodeWithSpaces = path.join(dirWithSpaces, `node${ext}`)
    await fs.copyFile(process.execPath, nodeWithSpaces)
    await makeExecutable(nodeWithSpaces)

    // Create app files
    const jsFile = path.join(testDir, 'app-spaces.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    const configFile = path.join(testDir, 'sea-config-spaces.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-spaces.js',
        output: 'app-spaces.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-spaces')
    const testBinject = await createTestBinject('test-binject-spaces')

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: nodeWithSpaces,
        },
      },
    )

    // Should succeed with paths containing spaces
    expect(result.code).toBe(0)
    expect(existsSync(outputBinary)).toBeTruthy()
  }, 60_000)

  it('should reject paths longer than PATH_MAX', async () => {
    // Create app files
    const jsFile = path.join(testDir, 'app-longpath.js')
    await fs.writeFile(jsFile, "console.log('Hello');\n")

    const configFile = path.join(testDir, 'sea-config-longpath.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'app-longpath.js',
        output: 'app-longpath.blob',
      }),
    )

    const outputBinary = path.join(testDir, 'output-longpath')
    const testBinject = await createTestBinject('test-binject-longpath')

    // Create a path longer than PATH_MAX (typically 1024 on macOS, 4096 on Linux)
    const longPath = `/tmp/${'a'.repeat(5000)}/node`

    const result = await execCommand(
      BINJECT,
      ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
      {
        cwd: testDir,
        env: {
          ...process.env,
          BINJECT_NODE_PATH: longPath,
        },
      },
    )

    // Should fail - path too long
    expect(result.code).not.toBe(0)
    expect(result.output).toMatch(
      /BINJECT_NODE_PATH is set but binary is invalid/,
    )
  }, 30_000)

  // Skip symlink test on Windows (different symlink semantics)
  it.skipIf(process.platform === 'win32')(
    'should handle symlinks to valid node binary',
    async () => {
      // Create app files
      const jsFile = path.join(testDir, 'app-symlink.js')
      await fs.writeFile(jsFile, "console.log('Hello');\n")

      const configFile = path.join(testDir, 'sea-config-symlink.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          main: 'app-symlink.js',
          output: 'app-symlink.blob',
        }),
      )

      const outputBinary = path.join(testDir, 'output-symlink')
      const testBinject = await createTestBinject('test-binject-symlink')

      // Create symlink to node
      const symlinkPath = path.join(testDir, 'node-symlink')
      await fs.symlink(process.execPath, symlinkPath)

      const result = await execCommand(
        BINJECT,
        ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
        {
          cwd: testDir,
          env: {
            ...process.env,
            BINJECT_NODE_PATH: symlinkPath,
          },
        },
      )

      // Should succeed - symlinks are resolved by realpath()
      expect(result.code).toBe(0)
      expect(existsSync(outputBinary)).toBeTruthy()
    },
    60_000,
  )

  // Skip symlink test on Windows
  it.skipIf(process.platform === 'win32')(
    'should fail when symlink points to non-existent target',
    async () => {
      // Create app files
      const jsFile = path.join(testDir, 'app-badsymlink.js')
      await fs.writeFile(jsFile, "console.log('Hello');\n")

      const configFile = path.join(testDir, 'sea-config-badsymlink.json')
      await fs.writeFile(
        configFile,
        JSON.stringify({
          main: 'app-badsymlink.js',
          output: 'app-badsymlink.blob',
        }),
      )

      const outputBinary = path.join(testDir, 'output-badsymlink')
      const testBinject = await createTestBinject('test-binject-badsymlink')

      // Create symlink to non-existent target
      const brokenSymlink = path.join(testDir, 'broken-symlink')
      await fs.symlink('/nonexistent/path/to/node', brokenSymlink)

      const result = await execCommand(
        BINJECT,
        ['inject', '-e', testBinject, '-o', outputBinary, '--sea', configFile],
        {
          cwd: testDir,
          env: {
            ...process.env,
            BINJECT_NODE_PATH: brokenSymlink,
          },
        },
      )

      // Should fail - broken symlink
      expect(result.code).not.toBe(0)
      expect(result.output).toMatch(
        /BINJECT_NODE_PATH is set but binary is invalid/,
      )
    },
    30_000,
  )
})
