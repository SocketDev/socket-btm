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
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const BINJECT = path.join(PROJECT_ROOT, 'out', 'binject')

let testDir

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

/**
 * Find the system node binary
 */
function getNodeBinary() {
  // Use the node binary running this test
  return process.execPath
}

describe('SEA JSON Config', () => {
  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-json-'))
  })

  afterAll(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true })
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

    // Run binject from the test directory (so relative paths work)
    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        getNodeBinary(),
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
    const blobExists = await fs
      .access(generatedBlob)
      .then(() => true)
      .catch(() => false)
    expect(blobExists).toBe(true)

    // Should have created output binary
    const outputExists = await fs
      .access(outputBinary)
      .then(() => true)
      .catch(() => false)
    expect(outputExists).toBe(true)
  }, 60_000)

  it('should auto-generate blob from JSON config with absolute path', async () => {
    // Create a simple JS file
    const jsFile = path.join(testDir, 'app.js')
    await fs.writeFile(jsFile, "console.log('App running');\n")

    // Create SEA config with absolute output path
    const configFile = path.join(testDir, 'sea-config-abs.json')
    const absoluteBlobPath = path.join(testDir, 'absolute-output.blob')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: path.join(testDir, 'app.js'), // Absolute path for main too
        output: absoluteBlobPath,
      }),
    )

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-abs.blob')
    await fs.writeFile(vfsBlob, 'VFS absolute test\n')

    // Create output binary
    const outputBinary = path.join(testDir, 'output-absolute')

    // Run binject from anywhere (absolute paths should work)
    const result = await execCommand(BINJECT, [
      'inject',
      '-e',
      getNodeBinary(),
      '-o',
      outputBinary,
      '--sea',
      configFile,
      '--vfs',
      vfsBlob,
    ])

    // Should succeed
    expect(result.code).toBe(0)

    // Should show it detected JSON config
    expect(result.output).toMatch(/Detected SEA config file/)
    expect(result.output).toMatch(/Generated SEA blob/)

    // Should have created the blob file at absolute path
    const blobExists = await fs
      .access(absoluteBlobPath)
      .then(() => true)
      .catch(() => false)
    expect(blobExists).toBe(true)

    // Should have created output binary
    const outputExists = await fs
      .access(outputBinary)
      .then(() => true)
      .catch(() => false)
    expect(outputExists).toBe(true)
  }, 60_000)

  it('should handle JSON config in subdirectory', async () => {
    // Create subdirectory
    const subdir = path.join(testDir, 'config')
    await fs.mkdir(subdir, { recursive: true })

    // Create JS file in subdirectory
    const jsFile = path.join(subdir, 'index.js')
    await fs.writeFile(jsFile, "console.log('Subdir app');\n")

    // Create SEA config in subdirectory with relative path
    const configFile = path.join(subdir, 'sea-config.json')
    await fs.writeFile(
      configFile,
      JSON.stringify({
        main: 'index.js',
        output: 'build.blob',
      }),
    )

    // Create VFS blob in subdirectory
    const vfsBlob = path.join(subdir, 'vfs.blob')
    await fs.writeFile(vfsBlob, 'VFS subdir\n')

    // Create output binary
    const outputBinary = path.join(testDir, 'output-subdir')

    // Run binject from subdirectory
    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        getNodeBinary(),
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
    const generatedBlob = path.join(subdir, 'build.blob')
    const blobExists = await fs
      .access(generatedBlob)
      .then(() => true)
      .catch(() => false)
    expect(blobExists).toBe(true)
  }, 60_000)

  it('should error gracefully if JSON config is invalid', async () => {
    // Create invalid JSON config
    const configFile = path.join(testDir, 'invalid-config.json')
    await fs.writeFile(configFile, '{ "main": "app.js", invalid json }')

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-invalid.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    // Create output binary
    const outputBinary = path.join(testDir, 'output-invalid')

    // Run binject
    const result = await execCommand(BINJECT, [
      'inject',
      '-e',
      getNodeBinary(),
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
        // Missing "output" field
      }),
    )

    // Create VFS blob
    const vfsBlob = path.join(testDir, 'vfs-no-output.blob')
    await fs.writeFile(vfsBlob, 'VFS\n')

    // Create output binary
    const outputBinary = path.join(testDir, 'output-no-field')

    // Run binject
    const result = await execCommand(
      BINJECT,
      [
        'inject',
        '-e',
        getNodeBinary(),
        '-o',
        outputBinary,
        '--sea',
        configFile,
        '--vfs',
        vfsBlob,
      ],
      { cwd: testDir },
    )

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

    // Create output binary
    const outputBinary = path.join(testDir, 'output-manual')

    // Run binject with .blob file (should NOT trigger JSON handling)
    const result = await execCommand(BINJECT, [
      'inject',
      '-e',
      getNodeBinary(),
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
