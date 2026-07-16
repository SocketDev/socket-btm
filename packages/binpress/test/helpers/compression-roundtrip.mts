/**
 * @file Command-exec and file-hash helpers for compression-roundtrip.test.mts.
 *   Split out to keep the describe/test scenarios under the file-size soft
 *   cap.
 */

import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

export interface ExecCommandResult {
  code: number | null
  stderr: string
  stdout: string
}

/**
 * Execute command and return result.
 */
export async function execCommand(
  command: string,
  args: string[] | readonly string[] = [],
  options: SpawnOptions = {},
): Promise<ExecCommandResult> {
  return new Promise<ExecCommandResult>(resolve => {
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
      resolve({ code, stderr, stdout })
    })

    // Handle spawn Promise rejection (non-zero exit codes)
    // We still resolve with the code/stdout/stderr for test assertions
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
