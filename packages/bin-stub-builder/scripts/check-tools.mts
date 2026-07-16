#!/usr/bin/env node
/**
 * Check and optionally install required build tools for bin-stub-builder.
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
  const manualTools: Array<{
    name: string
    cmd: string
    args?: string[] | undefined
    filePaths?: string[] | undefined
    isLibrary?: boolean | undefined
  }> = []

  await runCheckTools({
    autoInstallableTools,
    manualTools,
    packageName: 'bin-stub-builder',
  })
}

main().catch(err => {
  logger.error(errorMessage(err))
  process.exitCode = 1
})
