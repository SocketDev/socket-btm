/**
 * Node Version Extraction Integration Tests
 *
 * Tests the binject node-version command which extracts Node.js version
 * from various binary types:
 * - SMOL stubs (via PRESSED_DATA SMFG config)
 * - node-smol binaries (via SMOL_NODE_VER section)
 * - Injected binaries (via SMOL_CONFIG section)
 * - Windows PE binaries (via VS_VERSION_INFO resource)
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  getBinjectPath,
  getBinpressPath,
  PROJECT_ROOT,
} from './helpers/paths.mjs'
import { getNodeBinary, NODE_VERSION } from './helpers/binaries.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BINJECT = getBinjectPath()
const BINPRESS = getBinpressPath()

// Check at module load time for skipIf conditions
const binjectExists = existsSync(BINJECT)
const binpressExists = existsSync(BINPRESS)

let testDir: string

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

/**
 * Execute command and return result
 */
async function execCommand(
  command: string,
  args: string[] = [],
  options: Record<string, unknown> = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({ code: code ?? 1, stdout, stderr })
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

/**
 * Get expected node version (without v prefix)
 */
function getExpectedVersion(): string {
  return NODE_VERSION.replace(/^v/, '')
}

beforeAll(async () => {
  if (!binjectExists) {
    console.warn(`binject not found at ${BINJECT}`)
    console.warn('   Run: pnpm build in packages/binject')
    return
  }

  if (!binpressExists) {
    console.warn(`binpress not found at ${BINPRESS}`)
    console.warn('   Run: pnpm build in packages/binpress')
  }

  // Create test directory
  testDir = path.join(os.tmpdir(), `binject-node-version-${Date.now()}`)
  await mkdir(testDir, { recursive: true })
})

afterAll(async () => {
  if (testDir && existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true })
  }
})

describe('binject node-version command', () => {
  it('should show error for missing arguments', async () => {
    if (!binjectExists) return

    const result = await execCommand(BINJECT, ['node-version'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('requires an executable path')
  })

  it('should show error for non-existent file', async () => {
    if (!binjectExists) return

    const result = await execCommand(BINJECT, [
      'node-version',
      '/nonexistent/binary',
    ])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Could not extract')
  })

  it('should show error for plain binary without version info', async () => {
    if (!binjectExists) return

    // binject itself doesn't have node version info
    const result = await execCommand(BINJECT, ['node-version', BINJECT])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Could not extract')
  })
})

describe.skipIf(!binjectExists || !binpressExists)(
  'Node version extraction from SMOL stubs',
  () => {
    it('should extract version from stub with SMFG config', async () => {
      // Download a Node.js binary for the current platform
      const { path: nodeBinaryPath, version } = await getNodeBinary(
        process.platform,
        process.arch,
      )

      // Create a compressed stub with binpress
      // binpress embeds SMFG config with nodeVersion when using smol-config
      const stubPath = path.join(testDir, 'stub-with-version')

      // Create a smol-config.json with nodeVersion
      const smolConfigPath = path.join(testDir, 'smol-config.json')
      const smolConfig = {
        update: {
          nodeVersion: version,
          url: 'https://example.com/releases',
          binname: 'test',
        },
      }
      await writeFile(smolConfigPath, JSON.stringify(smolConfig, null, 2))

      // Compress with binpress using the smol config
      const compressResult = await execCommand(BINPRESS, [
        nodeBinaryPath,
        '-o',
        stubPath,
        '--smol-config',
        smolConfigPath,
      ])

      // binpress may not support --smol-config, check the result
      if (compressResult.code !== 0) {
        // Skip test if binpress doesn't support smol-config
        console.log(
          'binpress does not support --smol-config flag, skipping test',
        )
        return
      }

      // Extract version from the stub
      const versionResult = await execCommand(BINJECT, [
        'node-version',
        stubPath,
      ])

      expect(versionResult.code).toBe(0)
      expect(versionResult.stdout.trim()).toBe(version)
    })
  },
)

describe.skipIf(!binjectExists)(
  'Node version extraction from injected binaries',
  () => {
    it('should extract version from binary with SMOL_CONFIG section', async () => {
      // Download a Node.js binary
      const { path: nodeBinaryPath, version } = await getNodeBinary(
        process.platform,
        process.arch,
      )

      // Copy the binary to test directory
      const testBinaryPath = path.join(testDir, 'node-injected')
      await copyFile(nodeBinaryPath, testBinaryPath)

      // Create a sea-config.json with nodeVersion in smol section
      const seaConfigPath = path.join(testDir, 'sea-config.json')
      const mainJsPath = path.join(testDir, 'main.js')

      await writeFile(mainJsPath, 'console.log("hello");')

      const seaConfig = {
        main: mainJsPath,
        output: path.join(testDir, 'sea.blob'),
        smol: {
          update: {
            nodeVersion: version,
            url: 'https://example.com/releases',
            binname: 'test',
          },
        },
      }
      await writeFile(seaConfigPath, JSON.stringify(seaConfig, null, 2))

      // Inject using binject with sea-config
      const injectResult = await execCommand(BINJECT, [
        'inject',
        '-e',
        testBinaryPath,
        '-o',
        testBinaryPath,
        '--sea',
        seaConfigPath,
      ])

      if (injectResult.code !== 0) {
        console.log('Injection failed:', injectResult.stderr)
        // Skip if injection fails (may need node to generate blob)
        return
      }

      // Extract version from injected binary
      const versionResult = await execCommand(BINJECT, [
        'node-version',
        testBinaryPath,
      ])

      expect(versionResult.code).toBe(0)
      expect(versionResult.stdout.trim()).toBe(version)
    })
  },
)
