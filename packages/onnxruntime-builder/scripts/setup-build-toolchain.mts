#!/usr/bin/env node
/**
 * @file Setup build toolchain for onnxruntime-builder
 *   Installs required system dependencies:
 *
 *   - Linux: gcc, make, cmake, python3
 *   - macOS: clang (Xcode), make, cmake, python3
 *   - Windows: mingw-w64, make, cmake, python3
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
    packageName: 'onnxruntime-builder',
    packageRoot,
    tools: {
      darwin: ['clang', 'make', 'cmake', 'python3'],
      linux: ['gcc', 'make', 'cmake', 'python3'],
      win32: ['mingw-w64', 'make', 'cmake', 'python3'],
    },
  })
}

main().catch(err => {
  logger.error(errorMessage(err))
  process.exitCode = 1
})
