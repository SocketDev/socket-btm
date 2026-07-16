#!/usr/bin/env node
/**
 * @file Setup build toolchain for binpress
 *   Installs required system dependencies:
 *
 *   - Linux: gcc, make (zstd compiled from submodule)
 *   - macOS: clang (Xcode), make (system Compression framework)
 *   - Windows: mingw-w64, make (Cabinet API)
 */

import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { runSetupToolchain } from 'build-infra/lib/setup-build-toolchain'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

export async function main() {
  await runSetupToolchain({
    packageName: 'binpress',
    packageRoot,
    tools: {
      darwin: ['clang', 'make'],
      darwinNote:
        'Note: Compression via system Compression framework (no extra deps)',
      linux: ['gcc', 'make'],
      linuxNote: 'Note: zstd compiled from bundled sources',
      win32: ['mingw-w64', 'make'],
      win32Note: 'Note: Compression via Cabinet API (no extra deps)',
    },
  })
}

main().catch(err => {
  logger.error(errorMessage(err))
  process.exitCode = 1
})
