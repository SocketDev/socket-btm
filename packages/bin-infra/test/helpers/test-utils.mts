import process from 'node:process'

/**
 * Shared test utility functions for binary testing across binpress, binflate,
 * and binject.
 *
 * This module provides common test helpers to avoid code duplication.
 */

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

/**
 * Ad-hoc code sign a binary for macOS execution.
 * Required for binaries modified after build to execute on macOS.
 *
 * @param {string} binaryPath - Path to binary to sign.
 *
 * @returns {Promise<void>}
 *
 * @throws {Error} If code signing fails
 */
export async function codeSignBinary(binaryPath: string) {
  if (process.platform !== 'darwin') {
    // No-op on non-macOS platforms
    return
  }

  const result = await execCommand('codesign', [
    '--sign',
    '-',
    '--force',
    binaryPath,
  ])

  if (result.code !== 0) {
    throw new Error(`Code signing failed: ${result.stderr}`)
  }
}

/**
 * Execute a command and capture output.
 *
 * @param {string} command - Command to execute.
 * @param {string[]} args - Command arguments.
 * @param {Object} options - Spawn options.
 *
 * @returns {Promise<{ code: number | null; stdout: string; stderr: string }>}
 */
export function execCommand(
  command: string,
  args: string[] = [],
  options: Record<string, unknown> = {},
): Promise<{
  code: number | null | undefined
  stderr: string
  stdout: string
}> {
  return new Promise(resolve => {
    const spawnPromise = spawn(command, args, {
      ...(options as object),
      stdio: 'pipe',
    })

    // Prevent unhandled rejection — we handle exit via proc.on('close')
    spawnPromise.catch(() => {})

    // @socketsecurity/lib-stable/process/spawn/child returns a Promise with .process property
    const proc = spawnPromise.process

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data: Buffer | string) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data: Buffer | string) => {
      stderr += data.toString()
    })

    proc.on('close', (code: number | null) => {
      resolve({ code, stderr, stdout })
    })

    proc.on('error', (error: Error) => {
      resolve({ code: undefined, stderr: error.message, stdout })
    })
  })
}
