#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binpress.
 */
import process from 'node:process'

import { runCheckTools } from 'build-infra/lib/check-tools'

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

await runCheckTools({
  autoInstallableTools,
  manualTools,
  packageName: 'binpress',
})
