#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binject.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { checkTools } from '../../build-infra/lib/check-tools.mjs'

const logger = getDefaultLogger()

const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'
const IS_WINDOWS = process.platform === 'win32'

// Tools that can be auto-installed via package managers
const autoInstallableTools = ['make']

// Add platform-specific compilers (both C and C++ for LIEF support)
if (IS_MACOS) {
  autoInstallableTools.push('clang', 'clang++')
} else if (IS_LINUX) {
  autoInstallableTools.push('gcc', 'g++')
} else if (IS_WINDOWS) {
  autoInstallableTools.push('gcc', 'g++')
}

// Tools that must exist but can't be auto-installed easily
const manualTools = []

if (IS_MACOS) {
  manualTools.push({ checkExists: true, cmd: 'tar', name: 'tar' })
  manualTools.push({
    checkExists: true,
    cmd: 'segedit',
    name: 'segedit (Xcode CLT)',
  })
} else if (IS_LINUX) {
  manualTools.push({ checkExists: true, cmd: 'tar', name: 'tar' })
} else if (IS_WINDOWS) {
  manualTools.push({
    checkExists: true,
    cmd: 'dlltool',
    name: 'dlltool (MinGW)',
  })
}

async function main() {
  const autoInstall = !process.argv.includes('--no-auto-install')
  const autoYes =
    process.argv.includes('--yes') ||
    'CI' in process.env ||
    'CONTINUOUS_INTEGRATION' in process.env

  const success = await checkTools(
    {
      autoInstallableTools,
      manualTools,
      packageName: 'binject',
    },
    { autoInstall, autoYes },
  )

  process.exit(success ? 0 : 1)
}

main().catch(err => {
  logger.fail(`Error checking tools: ${err}`)
  process.exit(1)
})
