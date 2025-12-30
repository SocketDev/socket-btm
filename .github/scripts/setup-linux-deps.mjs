#!/usr/bin/env node
/**
 * Install platform-specific build dependencies for binject
 * - Linux: liblzma-dev
 * - Windows: MinGW/gcc, CMake, make
 * - macOS: No additional dependencies
 */

import { platform } from 'node:os'
import { spawn } from 'node:child_process'

const currentPlatform = platform()
const isLinux = currentPlatform === 'linux'
const isWindows = currentPlatform === 'win32'

async function runCommand(command, args, shellMode = false) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: shellMode,
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

async function setupLinux() {
  console.log('Installing Linux build dependencies...')
  await runCommand('sudo', ['apt-get', 'update'])
  await runCommand('sudo', ['apt-get', 'install', '-y', 'liblzma-dev'])
  console.log('✓ Linux dependencies installed')
}

async function setupWindows() {
  console.log('Installing Windows build dependencies (MinGW/gcc, CMake)...')

  // Install MinGW for consistent ABI with LIEF library
  // Using gcc/g++ avoids ABI mismatch issues with LIEF
  await runCommand('choco', ['install', '-y', 'mingw'], true)

  // Install CMake (required for LIEF build)
  await runCommand('choco', ['install', '-y', 'cmake', '--installargs', 'ADD_CMAKE_TO_PATH=System'], true)

  // Verify installations
  await runCommand('gcc', ['--version'], true)
  await runCommand('g++', ['--version'], true)
  await runCommand('cmake', ['--version'], true)

  // Ensure make is available
  console.log('Checking for make...')
  try {
    await runCommand('where', ['make'], true)
    console.log('✓ make is available')
  } catch {
    console.log('Installing make...')
    await runCommand('choco', ['install', '-y', 'make'], true)
  }

  console.log('✓ Windows build tools configured')
  console.log('  Installed: gcc/g++ (MinGW), CMake, make')
}

async function main() {
  try {
    if (isLinux) {
      await setupLinux()
    } else if (isWindows) {
      await setupWindows()
    } else {
      console.log(`No additional dependencies needed for ${currentPlatform}`)
    }
    process.exit(0)
  } catch (error) {
    console.error('Failed to install dependencies:', error.message)
    process.exit(1)
  }
}

main()
