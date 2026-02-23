/**
 * Shared test utility functions for binary testing across binpress, binflate, and binject.
 *
 * This module provides common test helpers to avoid code duplication.
 */

import { spawn } from 'node:child_process'

/**
 * Execute a command and capture output
 * @param {string} command - Command to execute
 * @param {string[]} args - Command arguments
 * @param {Object} options - spawn options
 * @returns {Promise<{code: number|null, stdout: string, stderr: string}>}
 */
export function execCommand(command, args = [], options = {}) {
  return new Promise(resolve => {
    const proc = spawn(command, args, {
      ...options,
      stdio: 'pipe',
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
      resolve({ code, stdout, stderr })
    })

    proc.on('error', error => {
      resolve({ code: null, stdout, stderr: error.message })
    })
  })
}

/**
 * Ad-hoc code sign a binary for macOS execution.
 * Required for binaries modified after build to execute on macOS.
 *
 * @param {string} binaryPath - Path to binary to sign
 * @returns {Promise<void>}
 * @throws {Error} If code signing fails
 */
export async function codeSignBinary(binaryPath) {
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
