#!/usr/bin/env node
/**
 * Clean script for binflate C package
 * Wraps the Makefile clean target for pnpm integration
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const WIN32 = process.platform === 'win32'

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    console.log(`\x1b[36m▶ Running: ${command} ${args.join(' ')}\x1b[0m`)

    const proc = spawn(command, args, {
      cwd,
      stdio: 'inherit',
      shell: WIN32,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

async function main() {
  try {
    console.log(
      '\x1b[1m\x1b[36m🧹 Cleaning binflate build artifacts...\x1b[0m\n',
    )
    await runCommand('make', ['clean'], packageRoot)
    console.log('\n\x1b[32m✓ Clean completed successfully!\x1b[0m')
  } catch (error) {
    console.error(`\n\x1b[31m✗ Clean failed: ${error.message}\x1b[0m`)
    process.exit(1)
  }
}

main()
