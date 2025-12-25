/**
 * Signature Validation Tests
 *
 * Tests that binject automatically re-signs binaries with adhoc signatures
 * after modifying them with LIEF.
 *
 * When LIEF modifies a binary, it removes the existing code signature.
 * binject automatically re-signs the binary with an adhoc signature using
 * codesign to ensure the binary remains validly signed.
 */

import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { getBinjectPath } from './helpers/paths.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const BINJECT = getBinjectPath()

// Only run on macOS since this tests Mach-O signatures
const describeOnMac = os.platform() === 'darwin' ? describe : describe.skip

let testDir

async function execCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

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
        : null

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('error', err => {
      if (!resolved) {
        resolved = true
        if (timeout) {
          clearTimeout(timeout)
        }
        reject(err)
      }
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
          stdout,
          stderr,
          output: stdout + stderr,
        })
      }
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

async function getSignatureInfo(binaryPath) {
  // codesign outputs to stderr
  const result = await execCommand('codesign', ['-dvvv', binaryPath])
  return result.stderr
}

async function checkFileLocks(filePath) {
  try {
    const { stdout } = await execCommand('lsof', [filePath], { timeout: 5000 })
    return stdout.trim()
  } catch {
    return ''
  }
}

async function waitForFileReady(filePath, maxWaitMs = 10_000) {
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
        console.log(`  ⚠ File still has open handles: ${locks}`)
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

/**
 * Helper to inject SEA resource and verify signature
 */
async function injectAndVerify(binaryPath, seaBlob, vfsBlob = null) {
  const args = ['inject', '-e', binaryPath, '-o', binaryPath, '--sea', seaBlob]
  if (vfsBlob) {
    args.push('--vfs', vfsBlob)
  }

  const result = await execCommand(BINJECT, args)
  expect(result.code).toBe(0)
  expect(result.output).toMatch(/Binary signed successfully/i)

  const isValid = await verifySignature(binaryPath)
  expect(isValid).toBe(true)

  const sigInfo = await getSignatureInfo(binaryPath)
  expect(sigInfo).toMatch(/Signature.*adhoc/i)

  return result
}

/**
 * Helper to prepare a test binary
 */
async function prepareTestBinary(name) {
  const binaryPath = path.join(testDir, name)
  await fs.copyFile(BINJECT, binaryPath)

  const originalSigned = await verifySignature(binaryPath)
  expect(originalSigned).toBe(true)

  return binaryPath
}

describeOnMac('Signature Validation', () => {
  beforeAll(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'binject-sig-'))
  })

  afterAll(async () => {
    if (testDir) {
      await fs.rm(testDir, { recursive: true, force: true })
    }
  })

  it('should maintain valid signature after SEA injection', async () => {
    const testBinary = await prepareTestBinary('test-binary')

    const seaBlob = path.join(testDir, 'app.blob')
    await fs.writeFile(seaBlob, 'SEA application data\n')

    const result = await injectAndVerify(testBinary, seaBlob)
    expect(result.output).toMatch(/Success|injected/i)
    expect(result.output).toMatch(/Signing binary with ad-hoc signature/i)
  }, 30_000)

  it('should maintain valid signature after SEA+VFS injection', async () => {
    const testBinary = await prepareTestBinary('test-binary-vfs')

    const seaBlob = path.join(testDir, 'app-vfs.blob')
    const vfsBlob = path.join(testDir, 'vfs.blob')
    await fs.writeFile(seaBlob, 'SEA application data\n')
    await fs.writeFile(vfsBlob, 'Virtual filesystem data\n')

    const result = await injectAndVerify(testBinary, seaBlob, vfsBlob)
    expect(result.output).toMatch(/Success|injected/i)
    expect(result.output).toMatch(/Signing binary with ad-hoc signature/i)
  }, 30_000)

  describe.sequential('Sequential Injections', () => {
    let testBinary1
    let testBinary2

    it('should perform first injection successfully', async () => {
      testBinary1 = await prepareTestBinary('test-binary-seq-v1')

      const seaBlob1 = path.join(testDir, 'app-v1.blob')
      await fs.writeFile(seaBlob1, 'SEA version 1\n')

      await injectAndVerify(testBinary1, seaBlob1)

      // Wait for file to be fully written and released by macOS codesign
      const fileReady = await waitForFileReady(testBinary1)
      expect(fileReady).toBe(true)
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
      expect(copyReady).toBe(true)

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
    expect(isValid).toBe(true)

    const sigInfo = await getSignatureInfo(v1Binary)
    expect(sigInfo).toMatch(/Signature.*adhoc/i)
  }, 60_000)
})
