#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binflate
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { whichSync } from '@socketsecurity/lib/bin'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { ensureAllToolsInstalled } from '../../build-infra/lib/tool-installer.mjs'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// Tools that can be auto-installed via package managers
const autoInstallableTools = ['make']

// Add platform-specific compilers
if (IS_MACOS) {
  // On macOS, clang is preferred and comes with Xcode Command Line Tools
  autoInstallableTools.push('clang')
} else if (IS_LINUX) {
  // On Linux, gcc is standard
  autoInstallableTools.push('gcc')
  // Note: liblzma-dev is installed by the workflow, not checked here
  // (it's a library package with no binary to verify in PATH)
}

// Tools that must exist but can't be auto-installed easily
const manualTools = []

// On Linux, check for liblzma-dev via pkg-config (library package, not a binary)
if (IS_LINUX) {
  manualTools.push({
    name: 'liblzma-dev',
    cmd: 'pkg-config',
    args: ['--exists', 'liblzma'],
    checkExists: true,
    isLibrary: true,
  })
}

async function main() {
  const autoInstall = !process.argv.includes('--no-auto-install')
  const autoYes = process.argv.includes('--yes') || 'CI' in process.env

  console.log('Checking required build tools for binflate...\n')

  // Check auto-installable tools
  const result = await ensureAllToolsInstalled(autoInstallableTools, {
    autoInstall,
    autoYes,
  })

  // Report auto-installable tools
  for (const tool of autoInstallableTools) {
    if (result.installed.includes(tool)) {
      console.log(`✅ ${tool} installed automatically`)
    } else if (!result.missing.includes(tool)) {
      console.log(`✓ ${tool} is available`)
    }
  }

  // Check manual tools
  let allManualAvailable = true
  for (const tool of manualTools) {
    const { args, cmd, isLibrary, name } = tool

    if (isLibrary && args) {
      // For library packages, run command with args (e.g., pkg-config --exists liblzma)
      const cmdPath = whichSync(cmd, { nothrow: true })
      if (!cmdPath) {
        logger.fail(`${name} is NOT available (${cmd} not found)`)
        allManualAvailable = false
        continue
      }

      try {
        const { spawnSync } = await import('node:child_process')
        const result = spawnSync(cmd, args, { encoding: 'utf8' })
        if (result.status === 0) {
          logger.success(`${name} is available`)
        } else {
          logger.fail(`${name} is NOT available`)
          allManualAvailable = false
        }
      } catch {
        logger.fail(`${name} is NOT available`)
        allManualAvailable = false
      }
    } else {
      // For binary tools, check if they exist in PATH
      const binPath = whichSync(cmd, { nothrow: true })
      if (binPath) {
        logger.success(`${name} is available`)
      } else {
        logger.fail(`${name} is NOT available`)
        allManualAvailable = false
      }
    }
  }

  // Handle missing tools
  if (!result.allAvailable || !allManualAvailable) {
    console.error('\n❌ Some required tools are missing\n')

    if (result.missing.length > 0) {
      console.error('Missing auto-installable tools:')
      for (const tool of result.missing) {
        console.error(`  - ${tool}`)
      }

      if (IS_MACOS) {
        console.error('\nTo install missing tools on macOS:')
        if (result.missing.includes('clang')) {
          console.error('  xcode-select --install')
        }
        for (const tool of result.missing) {
          if (tool !== 'clang') {
            console.error(`  brew install ${tool}`)
          }
        }
      } else if (IS_LINUX) {
        console.error('\nTo install missing tools on Linux:')
        console.error(
          `  sudo apt-get install -y ${result.missing.join(' ')} build-essential`,
        )
      }
    }

    console.error(
      '\nRe-run without --no-auto-install to attempt automatic installation',
    )
    process.exit(1)
  }

  console.log('\n✅ All required tools are available\n')
  process.exit(0)
}

main().catch(err => {
  console.error('Error checking tools:', err)
  process.exit(1)
})
