#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binject.
 */
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'

import { runCheckTools } from 'build-infra/lib/check-tools'

const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// Tools that can be auto-installed via package managers
const autoInstallableTools = ['make']

// Add platform-specific compilers (both C and C++ for LIEF support)
if (IS_MACOS) {
  autoInstallableTools.push('clang', 'clang++')
} else if (IS_LINUX) {
  autoInstallableTools.push('gcc', 'g++')
} else if (WIN32) {
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
} else if (WIN32) {
  manualTools.push({
    checkExists: true,
    cmd: 'dlltool',
    name: 'dlltool (MinGW)',
  })
}

await runCheckTools({
  autoInstallableTools,
  manualTools,
  packageName: 'binject',
})
