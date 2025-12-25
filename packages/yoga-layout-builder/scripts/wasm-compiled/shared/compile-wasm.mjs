/**
 * WASM compilation phase for Yoga Layout
 *
 * Builds static library and links WASM module with Emscripten bindings.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { formatDuration, getFileSize } from 'build-infra/lib/build-helpers'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

/**
 * Get linking optimization flags (different from configure flags due to bindings).
 *
 * @param {string} buildMode - 'prod' or 'dev'
 * @returns {{cxxFlags: string[], linkerFlags: string[]}}
 */
function getLinkingFlags(buildMode) {
  // Note: Emscripten bindings require RTTI, so we can't use -fno-rtti here.
  const cxxFlags =
    buildMode === 'prod'
      ? [
          '-Oz',
          '-flto=thin',
          '-ffunction-sections',
          '-fdata-sections',
          '-ffast-math',
          '-fno-finite-math-only',
        ]
      : ['-O1']

  const linkerFlags =
    buildMode === 'prod'
      ? [
          '--closure=1',
          '-Wl,--gc-sections',
          '-flto=thin',
          '-Oz',
          '-sDISABLE_EXCEPTION_CATCHING=1',
          '-sALLOW_MEMORY_GROWTH=1',
          '-sASSERTIONS=0',
          '-sEXPORT_ES6=1',
          '-sFILESYSTEM=0',
          '-sINITIAL_MEMORY=64KB',
          '-sMALLOC=emmalloc',
          '-sMODULARIZE=1',
          '-sNO_EXIT_RUNTIME=1',
          '-sSTACK_SIZE=16KB',
          '-sSUPPORT_LONGJMP=0',
          '--bind',
        ]
      : [
          '-sDISABLE_EXCEPTION_CATCHING=1',
          '-sALLOW_MEMORY_GROWTH=1',
          '-sASSERTIONS=2',
          '-sEXPORT_ES6=1',
          '-sFILESYSTEM=0',
          '-sMODULARIZE=1',
          '-sNO_EXIT_RUNTIME=1',
          '-sWASM_ASYNC_COMPILATION=0',
          '--bind',
        ]

  return { cxxFlags, linkerFlags }
}

/**
 * Build Yoga with Emscripten.
 *
 * @param {object} options - Build options
 * @param {string} options.buildDir - Build directory
 * @param {string} options.cmakeBuildDir - CMake build directory
 * @param {string} options.sourceDir - Source directory
 * @param {string} options.buildWasmFile - Output WASM file path
 * @param {string} options.buildJsFile - Output JS glue code file path
 * @param {string} options.bindingsFile - Emscripten bindings file path
 * @param {string} options.staticLibFile - Static library file path
 * @param {string} options.buildMode - Build mode ('prod' or 'dev')
 * @param {boolean} options.forceRebuild - Force rebuild (ignore checkpoints)
 */
export async function compileWasm(options) {
  const {
    bindingsFile,
    buildDir,
    buildJsFile,
    buildMode,
    buildWasmFile,
    cmakeBuildDir,
    forceRebuild,
    sourceDir,
    staticLibFile,
  } = options

  if (!(await shouldRun(buildDir, '', 'wasm-compiled', forceRebuild))) {
    return
  }

  logger.step('Building Yoga with Emscripten')

  const startTime = Date.now()

  // Build static library with CMake.
  logger.substep('Compiling C++ to static library...')
  const buildResult = await spawn(
    'emmake',
    ['cmake', '--build', cmakeBuildDir, '--target', 'yogacore'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (buildResult.code !== 0) {
    throw new Error('Static library build failed')
  }

  // Link WASM module with Emscripten bindings.
  logger.substep('Linking WASM module with Emscripten bindings...')

  // Get linking optimization flags
  const { cxxFlags, linkerFlags } = getLinkingFlags(buildMode)

  // Compile and link in one step.
  const emArgs = [
    `-I${sourceDir}`,
    ...cxxFlags,
    bindingsFile,
    staticLibFile,
    ...linkerFlags,
    '-o',
    buildJsFile,
  ]

  const emppResult = await spawn(await which('em++'), emArgs, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (emppResult.code !== 0) {
    throw new Error('WASM compilation failed')
  }

  logger.success(`JS glue code created: ${buildJsFile}`)
  logger.success(`WASM module created: ${buildWasmFile}`)

  const duration = formatDuration(Date.now() - startTime)
  logger.success(`Build completed in ${duration}`)

  // Create checkpoint with smoke test.
  const wasmSize = await getFileSize(buildWasmFile)
  await createCheckpoint(
    buildDir,
    'wasm-compiled',
    async () => {
      // Smoke test: Verify WASM is valid.
      const buffer = await fs.readFile(buildWasmFile)

      // Check WASM magic number.
      const magic = buffer.slice(0, 4).toString('hex')
      if (magic !== '0061736d') {
        throw new Error('Invalid WASM file (bad magic number)')
      }

      // Try to compile with WebAssembly API.
      const module = new WebAssembly.Module(buffer)
      const exports = WebAssembly.Module.exports(module)
      if (exports.length === 0) {
        throw new Error('WASM module has no exports')
      }
      logger.substep(
        `WASM valid: ${exports.length} exports, ${buffer.length} bytes`,
      )
    },
    {
      binarySize: wasmSize,
      binaryPath: path.relative(buildDir, path.dirname(buildWasmFile)),
      artifactPath: path.dirname(buildWasmFile),
    },
  )
}
