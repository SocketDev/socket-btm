#!/usr/bin/env node
/**
 * Build script for binflate C package
 * Wraps the Makefile build target for pnpm integration
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const WIN32 = process.platform === 'win32'

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    logger.info(`Running: ${command} ${args.join(' ')}`)

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
    logger.info('🔨 Building binflate...\n')

    // Check required build tools
    logger.info('Checking required build tools...')
    await runCommand(
      'node',
      [path.join(packageRoot, 'scripts', 'check-tools.mjs')],
      packageRoot,
    )
    logger.info('')

    await runCommand('make', ['all'], packageRoot)
    logger.info('')
    logger.success('Build completed successfully!')
  } catch (error) {
    logger.info('')
    logger.fail(`Build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
