#!/usr/bin/env node
/**
 * Check and optionally install required build tools for bin-stubs.
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { checkTools } from '../../build-infra/lib/check-tools.mjs'

const logger = getDefaultLogger()

const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'
const IS_WINDOWS = process.platform === 'win32'

// Tools that can be auto-installed via package managers.
const autoInstallableTools = ['make']

// Add platform-specific compilers (C only - stubs are pure C).
if (IS_MACOS) {
  autoInstallableTools.push('clang')
} else if (IS_LINUX) {
  autoInstallableTools.push('gcc')
} else if (IS_WINDOWS) {
  autoInstallableTools.push('gcc')
}

// Tools that must exist but can't be auto-installed easily.
// (curl is downloaded, LZFSE is a submodule, no external deps needed)
const manualTools = []

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
      packageName: 'bin-stubs',
    },
    { autoInstall, autoYes },
  )

  process.exit(success ? 0 : 1)
}

main().catch(err => {
  logger.fail(`Error checking tools: ${err}`)
  process.exit(1)
})
