#!/usr/bin/env node
/**
 * Check and optionally install required build tools for stubs-builder.
 */
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib/constants/platform'

import { runCheckTools } from 'build-infra/lib/check-tools'

const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

// Tools that can be auto-installed via package managers.
const autoInstallableTools = ['make']

// Add platform-specific compilers (C only - stubs are pure C).
if (IS_MACOS) {
  autoInstallableTools.push('clang')
} else if (IS_LINUX) {
  autoInstallableTools.push('gcc')
} else if (WIN32) {
  autoInstallableTools.push('gcc')
}

// Tools that must exist but can't be auto-installed easily.
// (curl is downloaded, zstd is bundled, no external deps needed)
const manualTools = []

await runCheckTools({
  autoInstallableTools,
  manualTools,
  packageName: 'stubs-builder',
})
