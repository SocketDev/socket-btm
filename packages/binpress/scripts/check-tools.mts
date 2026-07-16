#!/usr/bin/env node
/**
 * Check and optionally install required build tools for binpress.
 */
import process from 'node:process'

import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { runCheckTools } from 'build-infra/lib/check-tools'

const logger = getDefaultLogger()

const IS_MACOS = process.platform === 'darwin'
const IS_LINUX = process.platform === 'linux'

export async function main() {
  // Tools that can be auto-installed via package managers.
  const autoInstallableTools = ['make']

  // Add platform-specific compilers (both C and C++ for LIEF support).
  if (IS_MACOS) {
    autoInstallableTools.push('clang', 'clang++')
  } else if (IS_LINUX) {
    autoInstallableTools.push('gcc', 'g++')
  } else if (WIN32) {
    autoInstallableTools.push('gcc', 'g++')
  }

  // No manual-check tools: zstd is compiled from bundled sources, so no
  // external deps are needed.
  await runCheckTools({
    autoInstallableTools,
    manualTools: [],
    packageName: 'binpress',
  })
}

main().catch(err => {
  logger.error(errorMessage(err))
  process.exitCode = 1
})
