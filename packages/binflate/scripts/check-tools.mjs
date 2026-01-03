#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binflate
 */

import { checkTools } from '../../build-infra/lib/check-tools.mjs'

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
const manualTools = []

// On Linux, check for liblzma-dev via pkg-config
if (IS_LINUX) {
  manualTools.push({
    args: ['--exists', 'liblzma'],
    checkExists: true,
    cmd: 'pkg-config',
    isLibrary: true,
    name: 'liblzma-dev',
  })
}

async function main() {
  const autoInstall = !process.argv.includes('--no-auto-install')
  const autoYes = process.argv.includes('--yes') || 'CI' in process.env

  const success = await checkTools(
    {
      autoInstallableTools,
      manualTools,
      packageName: 'binflate',
    },
    { autoInstall, autoYes },
  )

  process.exit(success ? 0 : 1)
}

main().catch(err => {
  console.error('Error checking tools:', err)
  process.exit(1)
})
