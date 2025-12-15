#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binject
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { whichSync } from '@socketsecurity/lib/bin'

import { ensureAllToolsInstalled } from '../../build-infra/lib/tool-installer.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'
const IS_WINDOWS = process.platform === 'win32'

// Tools that can be auto-installed via package managers
const autoInstallableTools = ['make']

// Add platform-specific compilers (both C and C++ for LIEF support)
if (IS_MACOS) {
  // On macOS, clang/clang++ come with Xcode Command Line Tools
  autoInstallableTools.push('clang', 'clang++')
} else if (IS_LINUX) {
  // On Linux, gcc/g++ are standard
  autoInstallableTools.push('gcc', 'g++')
} else if (IS_WINDOWS) {
  // On Windows, gcc/g++ come with MinGW
  autoInstallableTools.push('gcc', 'g++')
}

// Tools that must exist but can't be auto-installed easily
const manualTools = []

// On macOS, add tar and segedit (segedit comes with Xcode Command Line Tools)
if (IS_MACOS) {
  manualTools.push({ name: 'tar', cmd: 'tar', checkExists: true })
  manualTools.push({
    name: 'segedit (Xcode CLT)',
    cmd: 'segedit',
    checkExists: true,
  })
} else if (IS_LINUX) {
  manualTools.push({ name: 'tar', cmd: 'tar', checkExists: true })
} else if (IS_WINDOWS) {
  manualTools.push({
    name: 'dlltool (MinGW)',
    cmd: 'dlltool',
    checkExists: true,
  })
}

async function main() {
  const autoInstall = !process.argv.includes('--no-auto-install')
  const autoYes = process.argv.includes('--yes') || 'CI' in process.env

  console.log('Checking required build tools for binject...\n')

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
  for (const { cmd, name } of manualTools) {
    const binPath = whichSync(cmd, { nothrow: true })
    if (binPath) {
      console.log(`✓ ${name} is available`)
    } else {
      console.error(`✗ ${name} is NOT available`)
      allManualAvailable = false
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
        if (
          result.missing.includes('clang') ||
          result.missing.includes('clang++')
        ) {
          console.error('  xcode-select --install')
        }
        for (const tool of result.missing) {
          if (tool !== 'clang' && tool !== 'clang++') {
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
