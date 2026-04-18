/**
 * Source configuration phase for Yoga Layout
 *
 * Configures CMake with Emscripten toolchain and optimization flags.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { printError } from 'build-infra/lib/build-output'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getOptimizationFlags } from '../../lib/optimization-flags.mts'

const logger = getDefaultLogger()

/**
 * Configure CMake with Emscripten.
 *
 * @param {object} options - Configuration options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.cmakeBuildDir - CMake build directory
 * @param {string} options.sourceDir - Source directory
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {string} options.emscriptenVersion - Emscripten version from external-tools.json
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function configureCMake(options) {
  const {
    buildDir,
    buildMode,
    cmakeBuildDir,
    emscriptenVersion,
    forceRebuild,
    sourceDir,
  } = options

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

  // Auto-detect and activate Emscripten SDK (auto-install if needed).
  const emscriptenResult = await ensureEmscripten({
    autoInstall: true,
    quiet: false,
    version: emscriptenVersion,
  })

  if (!emscriptenResult.available) {
    printError('Failed to install or activate Emscripten SDK')
    printError('Please install manually:')
    printError(
      '  git clone https://github.com/emscripten-core/emsdk.git ~/.emsdk',
    )
    printError(
      '  cd ~/.emsdk && ./emsdk install latest && ./emsdk activate latest',
    )
    printError('  source ~/.emsdk/emsdk_env.sh')
    throw new Error('Emscripten SDK required')
  }

  // ensureEmscripten() already sets EMSDK/EMSCRIPTEN environment variables.
  // Determine Emscripten toolchain file location.
  // Different installations have different layouts:
  // - emsdk: EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
  // - Homebrew: /opt/homebrew/Cellar/emscripten/X.X.X/libexec/cmake/Modules/Platform/Emscripten.cmake
  const toolchainSuffix = 'cmake/Modules/Platform/Emscripten.cmake'
  const searchPaths = []

  if (process.env.EMSCRIPTEN) {
    searchPaths.push(
      path.join(process.env.EMSCRIPTEN, toolchainSuffix),
      // Homebrew: EMSCRIPTEN is bin/, toolchain is in sibling libexec/
      path.join(process.env.EMSCRIPTEN, '..', 'libexec', toolchainSuffix),
    )
  }
  if (process.env.EMSDK) {
    searchPaths.push(
      path.join(process.env.EMSDK, 'upstream', 'emscripten', toolchainSuffix),
    )
  }

  let toolchainFile
  for (const candidate of searchPaths) {
    if (existsSync(candidate)) {
      toolchainFile = candidate
      break
    }
  }

  if (!toolchainFile) {
    printError('Emscripten toolchain file not found')
    printError('Searched paths:')
    for (const p of searchPaths) {
      printError(`  ${p}`)
    }
    throw new Error('Emscripten toolchain file required')
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
      if (!existsSync(cmakeBuildDir)) {
        throw new Error(
          `CMake build directory missing after configure: ${cmakeBuildDir}`,
        )
      }
      logger.substep('CMake build directory validated')
    },
    {
      artifactPath: sourceDir,
    },
  )
}
