/**
 * @file Command-exec, test-binary, and file-hash helpers for
 *   decompression-functional.test.mts. Split out to keep the describe/test
 *   scenarios under the file-size soft cap.
 */

import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'

import { makeExecutable } from 'build-infra/lib/build-helpers'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export type ExecOptions = {
  cwd?: string | undefined
  input?: string | undefined
}

export type ExecResult = {
  code: number | null
  stderr: string
  stdout: string
}

/**
 * Create a test binary file with known content.
 */
export async function createTestBinary(filePath: string, size = 1024 * 10) {
  // Create binary with repeated pattern (compresses well)
  const pattern = Buffer.from('TESTDATA'.repeat(16))
  const chunks = Math.ceil(size / pattern.length)
  const data = Buffer.concat(Array(chunks).fill(pattern)).subarray(0, size)
  await fs.writeFile(filePath, data)
  await makeExecutable(filePath)
}

/**
 * Execute command and return result.
 */
export async function execCommand(
  command: string,
  args: string[] = [],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise(resolve => {
    const spawnPromise = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // @socketsecurity/lib-stable/process/spawn/child returns a Promise with .process property
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
      resolve({ code, stderr, stdout })
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    spawnPromise.catch(() => {
      // Already handled by 'close' event
    })
  })
}

/**
 * Calculate file hash.
 */
export async function hashFile(filePath: string) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}
