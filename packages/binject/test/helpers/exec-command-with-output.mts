/**
 * @file Shared command-exec helper (merged `output` field variant) for
 *   binject SEA config/VFS tests. Split out to keep each test file under
 *   the file-size soft cap.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

export interface ExecResultWithOutput {
  code: number
  output: string
  stderr: string
  stdout: string
}

export async function execCommand(
  command: string,
  args: string[] = [],
  options: Record<string, unknown> = {},
) {
  return new Promise<ExecResultWithOutput>(resolve => {
    const spawnPromise = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

    // Prevent unhandled rejection — we handle exit via proc.on('close')
    spawnPromise.catch(() => {})

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
      resolve({
        code: code ?? -1,
        output: stdout + stderr,
        stderr,
        stdout,
      })
    })
  })
}
