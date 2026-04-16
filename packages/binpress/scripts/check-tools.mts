#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binpress.
 */
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { checkTools } from 'build-infra/lib/check-tools'

const logger = getDefaultLogger()

const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// Tools that can be auto-installed via package managers
const autoInstallableTools = ['make']

// Add platform-specific compilers
if (IS_MACOS) {
  autoInstallableTools.push('clang')
} else if (IS_LINUX) {
  autoInstallableTools.push('gcc')
}

// Tools that must exist but can't be auto-installed easily
// (zstd is compiled from bundled sources, no external deps needed)
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
      packageName: 'binpress',
    },
    { autoInstall, autoYes },
  )

  process.exitCode = success ? 0 : 1
}

main().catch(error => {
  logger.fail(`Error checking tools: ${error}`)
  process.exitCode = 1
})
