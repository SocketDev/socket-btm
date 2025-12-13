#!/usr/bin/env node
/**
 * Install Linux build dependencies for binject
 * Only runs on Linux platforms - no-op on macOS/Windows
 */

import { platform } from 'node:os'
import { spawn } from 'node:child_process'

const isLinux = platform() === 'linux'

if (!isLinux) {
  console.log('Not Linux, skipping dependency installation')
  process.exit(0)
}

console.log('Installing Linux build dependencies...')

async function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: false,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} exited with code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

async function main() {
  try {
    await runCommand('sudo', ['apt-get', 'update'])
    await runCommand('sudo', ['apt-get', 'install', '-y', 'liblzma-dev'])
    console.log('✓ Linux dependencies installed')
    process.exit(0)
  } catch (error) {
    console.error('Failed to install dependencies:', error.message)
    process.exit(1)
  }
}

main()
