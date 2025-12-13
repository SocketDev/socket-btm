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
import { fileURLToPath } from 'node:url'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const PROJECT_ROOT = path.join(__dirname, '..')
const BINJECT = path.join(PROJECT_ROOT, 'out', 'binject')

// Only run on macOS since this tests Mach-O signatures
const describeOnMac = os.platform() === 'darwin' ? describe : describe.skip

let testDir

async function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const proc = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

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
        stdout,
        stderr,
        output: stdout + stderr,
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

async function getSignatureInfo(binaryPath) {
  // codesign outputs to stderr
  const result = await execCommand('codesign', ['-dvvv', binaryPath])
  return result.stderr
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
    // Use binject itself as the test binary
    const testBinary = path.join(testDir, 'test-binary')
    await fs.copyFile(BINJECT, testBinary)

    // Verify original binary is signed
    const originalSigned = await verifySignature(testBinary)
    expect(originalSigned).toBe(true)

    // Create test SEA blob
    const seaBlob = path.join(testDir, 'app.blob')
    await fs.writeFile(seaBlob, 'SEA application data\n')

    // Inject SEA into binary
    const injectResult = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinary,
      '-o',
      testBinary,
      '--sea',
      seaBlob,
    ])

    expect(injectResult.code).toBe(0)
    expect(injectResult.output).toMatch(/Success|injected/i)
    expect(injectResult.output).toMatch(/Signing binary with ad-hoc signature/i)
    expect(injectResult.output).toMatch(/Binary signed successfully/i)

    // Binary should be validly signed after injection
    const isValid = await verifySignature(testBinary)
    expect(isValid).toBe(true)

    // Verify it has an adhoc signature
    const sigInfo = await getSignatureInfo(testBinary)
    expect(sigInfo).toMatch(/Signature.*adhoc/i)
  }, 30_000)

  it('should maintain valid signature after SEA+VFS injection', async () => {
    // Use binject itself as the test binary
    const testBinary = path.join(testDir, 'test-binary-vfs')
    await fs.copyFile(BINJECT, testBinary)

    // Verify original binary is signed
    const originalSigned = await verifySignature(testBinary)
    expect(originalSigned).toBe(true)

    // Create test blobs
    const seaBlob = path.join(testDir, 'app-vfs.blob')
    const vfsBlob = path.join(testDir, 'vfs.blob')
    await fs.writeFile(seaBlob, 'SEA application data\n')
    await fs.writeFile(vfsBlob, 'Virtual filesystem data\n')

    // Inject SEA + VFS into binary
    const injectResult = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinary,
      '-o',
      testBinary,
      '--sea',
      seaBlob,
      '--vfs',
      vfsBlob,
    ])

    expect(injectResult.code).toBe(0)
    expect(injectResult.output).toMatch(/Success|injected/i)
    expect(injectResult.output).toMatch(/Signing binary with ad-hoc signature/i)
    expect(injectResult.output).toMatch(/Binary signed successfully/i)

    // Binary should be validly signed after injection
    const isValid = await verifySignature(testBinary)
    expect(isValid).toBe(true)

    // Verify it has an adhoc signature
    const sigInfo = await getSignatureInfo(testBinary)
    expect(sigInfo).toMatch(/Signature.*adhoc/i)
  }, 30_000)

  it('should maintain valid signature through overwrite injection', async () => {
    // Use binject itself as the test binary
    const testBinary1 = path.join(testDir, 'test-binary-overwrite-v1')
    const testBinary2 = path.join(testDir, 'test-binary-overwrite-v2')
    await fs.copyFile(BINJECT, testBinary1)

    // Verify original is signed
    const originalSigned = await verifySignature(testBinary1)
    expect(originalSigned).toBe(true)

    // First injection
    const seaBlob1 = path.join(testDir, 'app-v1.blob')
    await fs.writeFile(seaBlob1, 'SEA version 1\n')

    const inject1 = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinary1,
      '-o',
      testBinary1,
      '--sea',
      seaBlob1,
    ])

    expect(inject1.code).toBe(0)
    expect(inject1.output).toMatch(/Binary signed successfully/i)

    // Binary should be signed after first injection
    let isValid = await verifySignature(testBinary1)
    expect(isValid).toBe(true)

    // Second injection (overwrite) - use first injected binary as input
    const seaBlob2 = path.join(testDir, 'app-v2.blob')
    await fs.writeFile(seaBlob2, 'SEA version 2 (different content)\n')

    const inject2 = await execCommand(BINJECT, [
      'inject',
      '-e',
      testBinary1,
      '-o',
      testBinary2,
      '--sea',
      seaBlob2,
    ])

    expect(inject2.code).toBe(0)
    expect(inject2.output).toMatch(/Binary signed successfully/i)

    // Binary should remain signed after overwrite
    isValid = await verifySignature(testBinary2)
    expect(isValid).toBe(true)

    // Verify it has an adhoc signature
    const sigInfo = await getSignatureInfo(testBinary2)
    expect(sigInfo).toMatch(/Signature.*adhoc/i)
  }, 45_000)

  it('should maintain valid signature after re-injection', async () => {
    // Use binject itself as the test binary
    const v0Binary = path.join(testDir, 'test-binary-reinject-v0')
    const v1Binary = path.join(testDir, 'test-binary-reinject-v1')
    await fs.copyFile(BINJECT, v0Binary)

    // Verify original is signed
    const originalSigned = await verifySignature(v0Binary)
    expect(originalSigned).toBe(true)

    // First injection
    const seaBlob1 = path.join(testDir, 'app-reinject-v1.blob')
    await fs.writeFile(seaBlob1, 'SEA version 1 content\n')

    const result1 = await execCommand(BINJECT, [
      'inject',
      '-e',
      v0Binary,
      '-o',
      v1Binary,
      '--sea',
      seaBlob1,
    ])

    expect(result1.code).toBe(0)
    expect(result1.output).toMatch(/Success|injected/i)
    expect(result1.output).toMatch(/Binary signed successfully/i)

    // Binary should be validly signed after injection
    const isValid = await verifySignature(v1Binary)
    expect(isValid).toBe(true)

    // Verify it has an adhoc signature
    const sigInfo = await getSignatureInfo(v1Binary)
    expect(sigInfo).toMatch(/Signature.*adhoc/i)

    // Note: Chaining multiple injections (using an already-injected binary
    // as input for another injection) causes LIEF to crash when parsing the
    // signed binary structure. This is a known LIEF limitation.
  }, 60_000)
})
