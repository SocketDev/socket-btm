/**
 * Signature Validation Tests.
 *
 * Tests that binject automatically re-signs binaries with adhoc signatures
 * after modifying them with LIEF.
 *
 * When LIEF modifies a binary, it removes the existing code signature. binject
 * automatically re-signs the binary with an adhoc signature using codesign to
 * ensure the binary remains validly signed.
 */

import { afterAll, beforeAll, describe, expect, it, test } from 'vitest'

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { setTimeout as sleep } from 'node:timers/promises'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { getBinjectPath } from './helpers/paths.mts'
import { describeIf } from './helpers/vitest-skip.mts'

const logger = getDefaultLogger()

const BINJECT = getBinjectPath()

// Only run on macOS with binject binary built (tests Mach-O signatures)
const canRun = os.platform() === 'darwin' && existsSync(BINJECT)

let testDir: string

export async function checkFileLocks(filePath: string) {
  try {
    const { stdout } = await execCommand('lsof', [filePath], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

interface ExecOptions {
  timeout?: number | undefined
}

interface ExecResult {
  code: number
  output: string
  stderr: string
  stdout: string
}

export async function execCommand(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
) {
  return new Promise<ExecResult>((resolve, reject) => {
    const spawnPromise = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

    // @socketsecurity/lib-stable/process/spawn/child returns a Promise with .process property
    const proc = spawnPromise.process

    let stdout = ''
    let stderr = ''
    let resolved = false

    // Add timeout protection (45 seconds default to stay under test timeout)
    const timeoutMs = options.timeout || 45_000
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            if (!resolved) {
              resolved = true
              proc.kill('SIGTERM')
              reject(
                new Error(
                  `Command timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}`,
                ),
              )
            }
          }, timeoutMs)
        : undefined

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      if (!resolved) {
        resolved = true
        if (timeout) {
          clearTimeout(timeout)
        }
        // Ensure code is never null
        resolve({
          code: code ?? -1,
          output: stdout + stderr,
          stderr,
          stdout,
        })
      }
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    spawnPromise.catch(() => {
      // Already handled by 'close' event
    })
  })
}

export async function getSignatureInfo(binaryPath: string) {
  // codesign outputs to stderr
  const result = await execCommand('codesign', ['-dvvv', binaryPath])
  return result.stderr
}

/**
 * Helper to inject SEA resource and verify signature. Called exclusively from
 * `it()` bodies below, so these assertions do run as part of a test case —
 * the rule can't see across the call boundary, hence the per-line bypass.
 */
export async function injectAndVerify(
  binaryPath: string,
  seaBlob: string,
  vfsBlob: string | undefined = undefined,
) {
  const args = ['inject', '-e', binaryPath, '-o', binaryPath, '--sea', seaBlob]
  if (vfsBlob) {
    args.push('--vfs', vfsBlob)
  }

  const result = await execCommand(BINJECT, args)
  // oxlint-disable-next-line socket/no-vitest-standalone-expect -- helper called only from it() bodies below; the assertion runs as part of that test case.
  expect(result.code).toBe(0)
  // oxlint-disable-next-line socket/no-vitest-standalone-expect -- helper called only from it() bodies below; the assertion runs as part of that test case.
  expect(result.output).toMatch(/Binary signed successfully/i)

  const isValid = await verifySignature(binaryPath)
  // oxlint-disable-next-line socket/no-vitest-standalone-expect -- helper called only from it() bodies below; the assertion runs as part of that test case.
  expect(isValid).toBeTruthy()

  const sigInfo = await getSignatureInfo(binaryPath)
  // oxlint-disable-next-line socket/no-vitest-standalone-expect -- helper called only from it() bodies below; the assertion runs as part of that test case.
  expect(sigInfo).toMatch(/Signature.*adhoc/i)

  return result
}

/**
 * Helper to prepare a test binary Uses Node.js binary as consistent test input
 * (not BINJECT which may vary between builds). Called exclusively from
 * `it()` bodies below, so the assertion runs as part of that test case.
 */
export async function prepareTestBinary(name: string) {
  const binaryPath = path.join(testDir, name)
  // Use process.execPath (Node.js binary) as consistent test input
  await fs.copyFile(process.execPath, binaryPath)

  const originalSigned = await verifySignature(binaryPath)
  // oxlint-disable-next-line socket/no-vitest-standalone-expect -- helper called only from it() bodies below; the assertion runs as part of that test case.
  expect(originalSigned).toBeTruthy()

  return binaryPath
}

export async function verifySignature(binaryPath: string) {
  const result = await execCommand('codesign', [
    '--verify',
    '--strict',
    '--deep',
    binaryPath,
  ])
  return result.code === 0
}

export async function waitForFileReady(filePath: string, maxWaitMs = 10_000) {
  const startTime = Date.now()
  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Try to open the file for reading
      // eslint-disable-next-line no-await-in-loop
      const handle = await fs.open(filePath, 'r')
      // eslint-disable-next-line no-await-in-loop
      await handle.close()

      // Check for file locks
      // eslint-disable-next-line no-await-in-loop
      const locks = await checkFileLocks(filePath)
      if (locks) {
        logger.warn(`File still has open handles: ${locks}`)
        // eslint-disable-next-line no-await-in-loop
        await sleep(1000)
        continue
      }

      // Long delay to ensure codesign and any background processes complete
      // macOS codesign can take time to release file handles
      // eslint-disable-next-line no-await-in-loop
      await sleep(3000)
      return true
    } catch {
      // File not ready, wait and try again
      // eslint-disable-next-line no-await-in-loop
      await sleep(200)
    }
  }
  return false
}

describeIf(canRun)('Signature Validation', () => {
  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-sig-'))
  })

  afterAll(async () => {
    if (testDir) {
      await safeDelete(testDir)
    }
  })

  test('should maintain valid signature after SEA injection', async () => {
    const testBinary = await prepareTestBinary('test-binary')

    const seaBlob = path.join(testDir, 'app.blob')
    await fs.writeFile(seaBlob, 'SEA application data\n')

    const result = await injectAndVerify(testBinary, seaBlob)
    expect(result.output).toMatch(/Success|injected/i)
    expect(result.output).toMatch(/Signing binary with ad-hoc signature/i)
  }, 30_000)

  test('should maintain valid signature after SEA+VFS injection', async () => {
    const testBinary = await prepareTestBinary('test-binary-vfs')

    const seaBlob = path.join(testDir, 'app-vfs.blob')
    const vfsBlob = path.join(testDir, 'vfs.blob')
    await fs.writeFile(seaBlob, 'SEA application data\n')
    await fs.writeFile(vfsBlob, 'Virtual filesystem data\n')

    const result = await injectAndVerify(testBinary, seaBlob, vfsBlob)
    expect(result.output).toMatch(/Success|injected/i)
    expect(result.output).toMatch(/Signing binary with ad-hoc signature/i)
  }, 30_000)

  describe.sequential('sequential Injections', () => {
    let testBinary1: string
    let testBinary2: string

    it('should perform first injection successfully', async () => {
      testBinary1 = await prepareTestBinary('test-binary-seq-v1')

      const seaBlob1 = path.join(testDir, 'app-v1.blob')
      await fs.writeFile(seaBlob1, 'SEA version 1\n')

      await injectAndVerify(testBinary1, seaBlob1)

      // Wait for file to be fully written and released by macOS codesign
      const fileReady = await waitForFileReady(testBinary1)
      expect(fileReady).toBeTruthy()
    }, 30_000)

    it('should perform second injection (overwrite) successfully', async () => {
      // Wait between tests to ensure file handles are released
      await sleep(2000)

      // Use the already-injected binary from first test as input
      // This tests that binject can handle re-injecting into already-injected binaries
      testBinary2 = path.join(testDir, 'test-binary-seq-v2')
      await fs.copyFile(testBinary1, testBinary2)

      // Wait for copied file to be ready
      const copyReady = await waitForFileReady(testBinary2, 15_000)
      expect(copyReady).toBeTruthy()

      // Second injection with different content (overwrite)
      const seaBlob2 = path.join(testDir, 'app-v2.blob')
      await fs.writeFile(seaBlob2, 'SEA version 2 (different content)\n')

      // The fix works - LIEF can now parse already-injected binaries because
      // we remove signatures before parsing.
      await injectAndVerify(testBinary2, seaBlob2)
    }, 60_000)
  })

  it('should maintain valid signature after re-injection', async () => {
    const v0Binary = await prepareTestBinary('test-binary-reinject-v0')
    const v1Binary = path.join(testDir, 'test-binary-reinject-v1')

    const seaBlob1 = path.join(testDir, 'app-reinject-v1.blob')
    await fs.writeFile(seaBlob1, 'SEA version 1 content\n')

    // Inject into fresh binary writing to a different output file
    const args = ['inject', '-e', v0Binary, '-o', v1Binary, '--sea', seaBlob1]
    const result = await execCommand(BINJECT, args)

    expect(result.code).toBe(0)
    expect(result.output).toMatch(/Success|injected/i)
    expect(result.output).toMatch(/Binary signed successfully/i)

    const isValid = await verifySignature(v1Binary)
    expect(isValid).toBeTruthy()

    const sigInfo = await getSignatureInfo(v1Binary)
    expect(sigInfo).toMatch(/Signature.*adhoc/i)
  }, 60_000)
})
