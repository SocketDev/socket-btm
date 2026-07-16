/**
 * @file Shared command-exec + file-hash helpers for binject
 *   format/config-validation tests. Split out to keep each test file under
 *   the file-size soft cap.
 */

import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export interface ExecResult {
  code: number | null
  stderr: string
  stdout: string
}

/**
 * Execute command.
 */
export async function execCommand(
  command: string,
  args: string[] = [],
  options: Record<string, unknown> = {},
) {
  return new Promise<ExecResult>(resolve => {
    const spawnPromise = spawn(command, args, {
      ...options,
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
      resolve({ code: code ?? -1, stderr, stdout })
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    spawnPromise.catch(() => {
      // Already handled by 'close' event
    })
  })
}

/**
 * Calculate SHA-256 hash of file.
 */
export async function hashFile(filePath: string) {
  const data = await fs.readFile(filePath)
  return crypto.createHash('sha256').update(data).digest('hex')
}
