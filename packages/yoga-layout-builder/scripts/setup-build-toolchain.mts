#!/usr/bin/env node
/**
 * @file Setup build toolchain for yoga-layout-builder.
 *
 *   - Initializes the upstream `yoga` submodule when missing.
 *   - Installs C/C++ build deps (gcc/clang/make/cmake/python3) per the host
 *     platform via runSetupToolchain.
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
    packageName: 'yoga-layout-builder',
    packageRoot,
    submodules: [
      {
        name: 'yoga',
        sentinelFile: 'CMakeLists.txt',
        submodulePath: 'packages/yoga-layout-builder/upstream/yoga',
      },
    ],
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
