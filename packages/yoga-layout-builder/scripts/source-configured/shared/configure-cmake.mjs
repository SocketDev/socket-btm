/**
 * Source configuration phase for Yoga Layout
 *
 * Configures CMake with Emscripten toolchain and optimization flags.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { activateEmscriptenSDK } from 'build-infra/lib/build-env'
import { printError } from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getOptimizationFlags } from '../../lib/optimization-flags.mjs'

const logger = getDefaultLogger()

/**
 * Configure CMake with Emscripten.
 *
 * @param {object} options - Configuration options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.cmakeBuildDir - CMake build directory
 * @param {string} options.sourceDir - Source directory
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function configureCMake(options) {
  const { buildDir, buildMode, cmakeBuildDir, forceRebuild, sourceDir } =
    options

  if (
    !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.SOURCE_CONFIGURED,
      forceRebuild,
    ))
  ) {
    return
  }

  logger.step('Configuring CMake with Emscripten')

  await safeMkdir(cmakeBuildDir)

  // Auto-detect and activate Emscripten SDK.
  const emscriptenResult = await ensureEmscripten({
    version: 'latest',
    autoInstall: false,
    quiet: true,
  })

  if (!emscriptenResult.available) {
    printError('Emscripten SDK required')
    throw new Error('Emscripten SDK required')
  }

  // Activate Emscripten SDK to ensure environment variables are set.
  // This is necessary for Homebrew installations where emcc is in PATH
  // but EMSDK/EMSCRIPTEN environment variables are not set.
  if (!activateEmscriptenSDK()) {
    printError('Failed to activate Emscripten SDK environment')
    throw new Error('Emscripten SDK activation failed')
  }

  // Determine Emscripten toolchain file location.
  let toolchainFile
  if (process.env.EMSCRIPTEN) {
    toolchainFile = path.join(
      process.env.EMSCRIPTEN,
      'cmake/Modules/Platform/Emscripten.cmake',
    )
  } else if (process.env.EMSDK) {
    toolchainFile = path.join(
      process.env.EMSDK,
      'upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake',
    )
  } else {
    printError('Emscripten SDK path not set')
    throw new Error('Emscripten SDK required')
  }

  logger.substep(`Using toolchain: ${toolchainFile}`)
  logger.substep(`Build mode: ${buildMode}`)

  // Get optimization flags from shared module
  const { cxxFlags, linkerFlags } = getOptimizationFlags(buildMode)

  const cmakeArgs = [
    'cmake',
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DCMAKE_CXX_FLAGS=${cxxFlags.join(' ')}`,
    `-DCMAKE_EXE_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    `-DCMAKE_SHARED_LINKER_FLAGS=${linkerFlags.join(' ')}`,
    '-S',
    sourceDir,
    '-B',
    cmakeBuildDir,
  ]

  logger.substep('Optimization flags:')
  logger.substep(`  CXX: ${cxxFlags.join(' ')}`)
  logger.substep(`  Linker: ${linkerFlags.join(' ')}`)

  const emcmakePath = await which('emcmake', { nothrow: true })
  if (!emcmakePath) {
    throw new Error('emcmake not found in PATH')
  }

  const cmakeResult = await spawn(emcmakePath, cmakeArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (cmakeResult.code !== 0) {
    throw new Error('CMake configuration failed')
  }

  logger.success('CMake configured')
  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_CONFIGURED,
    async () => {
      // Smoke test: Verify CMake build directory exists
      await fs.access(cmakeBuildDir)
      logger.substep('CMake build directory validated')
    },
    {
      artifactPath: sourceDir,
    },
  )
}
