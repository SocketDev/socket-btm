/**
 * Build onnxruntime — size-optimized ONNX Runtime WASM for Socket CLI.
 *
 * Declarative manifest consumed by build-infra/lib/build-pipeline. The
 * orchestrator handles build mode, cache keys, shouldRun/createCheckpoint
 * wrapping, and all CLI flags. Stage workers under ./<stage>/shared/
 * return StageResult objects instead of writing checkpoints directly.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import {
  checkDiskSpace,
  freeDiskSpace,
} from 'build-infra/lib/build-helpers'
import { printError } from 'build-infra/lib/build-output'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { ensureEmscripten } from 'build-infra/lib/emscripten-installer'
import { ensureToolInstalled } from 'build-infra/lib/tool-installer'
import { getEmscriptenVersion } from 'build-infra/lib/version-helpers'
import { runPipelineCli } from 'build-infra/lib/build-pipeline'
import { generateSync as generateSyncShared } from 'build-infra/wasm-synced/generate-sync-phase'

import {
  PACKAGE_ROOT,
  getBuildOutputPaths,
  getBuildPaths,
  getSharedBuildPaths,
} from './paths.mts'
import { finalizeWasm } from './finalized/shared/finalize-wasm.mts'
import { cloneOnnxSource } from './source-cloned/shared/clone-source.mts'
import { compileWasm } from './wasm-compiled/shared/compile-wasm.mts'
import { optimizeWasm } from './wasm-optimized/shared/optimize-wasm.mts'
import { copyToRelease } from './wasm-released/shared/copy-to-release.mts'

const IS_CI = process.env.CI === 'true' || process.env.CI === '1'

const pkgJson = JSON.parse(
  await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
)
const onnxSource = pkgJson.sources?.onnxruntime
if (!onnxSource) {
  throw new Error('Missing sources.onnxruntime in package.json')
}
const eigenSource = pkgJson.sources?.eigen
if (!eigenSource) {
  throw new Error('Missing sources.eigen in package.json')
}

await runPipelineCli({
  packageRoot: PACKAGE_ROOT,
  packageName: 'onnxruntime',
  getBuildPaths,
  getSharedBuildPaths,
  getOutputFiles: paths => [
    paths.outputWasmFile,
    paths.outputMjsFile,
    paths.outputSyncJsFile,
  ],
  preflight: async () => {
    await freeDiskSpace()
    const cmakeResult = await ensureToolInstalled('cmake', {
      autoInstall: true,
    })
    if (!cmakeResult.available) {
      printError('CMake is required but not found')
      throw new Error('CMake required')
    }
    const pythonResult = await ensureToolInstalled('python3', {
      autoInstall: true,
    })
    if (!pythonResult.available) {
      printError('Python 3 is required but not found')
      throw new Error('Python 3 required')
    }
    const emscriptenVersion = await getEmscriptenVersion(PACKAGE_ROOT)
    const emscriptenResult = await ensureEmscripten({
      autoInstall: true,
      quiet: false,
      version: emscriptenVersion,
    })
    if (!emscriptenResult.available) {
      throw new Error('Emscripten SDK required')
    }
    const ninjaResult = await ensureToolInstalled('ninja', {
      autoInstall: true,
    })
    if (!ninjaResult.available && IS_CI) {
      throw new Error('Ninja required for CI builds')
    }
    await ensureToolInstalled('wasm-opt', { autoInstall: true })
    await checkDiskSpace(PACKAGE_ROOT, 5)
  },
  stages: [
    {
      name: CHECKPOINTS.SOURCE_CLONED,
      shared: true,
      run: async ctx => {
        const shared = ctx.sharedPaths
        return cloneOnnxSource({
          eigenCommit: eigenSource.ref,
          eigenSha1: eigenSource.sha1,
          onnxRepo: onnxSource.url,
          onnxSha: onnxSource.ref,
          onnxVersion: `v${onnxSource.version}`,
          sharedBuildDir: shared.buildDir,
          sharedCmakeDepsFile: shared.cmakeDepsFile,
          sharedCmakeListsFile: shared.cmakeListsFile,
          sharedCmakeWebassemblyFile: shared.cmakeWebassemblyFile,
          sharedPostBuildSourceFile: shared.postBuildSourceFile,
          sharedSourceDir: shared.sourceDir,
        })
      },
    },
    {
      name: CHECKPOINTS.WASM_COMPILED,
      run: async ctx => {
        const emscriptenVersion = await getEmscriptenVersion(ctx.packageRoot)
        return compileWasm({
          buildDir: ctx.paths.buildDir,
          buildMode: ctx.buildMode,
          buildOutputPaths: getBuildOutputPaths(ctx.sharedPaths.sourceDir),
          buildScriptFile: ctx.sharedPaths.buildScriptFile,
          emscriptenVersion,
          isCI: IS_CI,
          modeSourceDir: ctx.sharedPaths.sourceDir,
        })
      },
    },
    {
      name: CHECKPOINTS.WASM_RELEASED,
      run: async ctx => {
        const { buildMjsFile, buildWasmFile } = getBuildOutputPaths(
          ctx.sharedPaths.sourceDir,
        )
        return copyToRelease({
          buildDir: ctx.paths.buildDir,
          buildMjsFile,
          buildWasmFile,
          outputReleaseDir: ctx.paths.outputReleaseDir,
        })
      },
    },
    {
      name: CHECKPOINTS.WASM_OPTIMIZED,
      skipInDev: true,
      run: async ctx =>
        optimizeWasm({
          buildDir: ctx.paths.buildDir,
          optimizedDir: ctx.paths.outputOptimizedDir,
          releaseDir: ctx.paths.outputReleaseDir,
        }),
    },
    {
      name: CHECKPOINTS.WASM_SYNCED,
      run: async ctx =>
        generateSyncShared({
          buildDir: ctx.paths.buildDir,
          buildMode: ctx.buildMode,
          outputOptimizedDir: ctx.paths.outputOptimizedDir,
          outputReleaseDir: ctx.paths.outputReleaseDir,
          outputSyncDir: ctx.paths.outputSyncDir,
          packageConfig: {
            description:
              'Built with WASM threading + SIMD for synchronous instantiation.',
            expectedExports: 45,
            exportName: 'ort',
            fileBaseName: 'ort',
            initFunctionName: 'ortWasmThreaded',
            packageName: 'onnxruntime',
          },
        }),
    },
    {
      name: CHECKPOINTS.FINALIZED,
      run: async ctx =>
        finalizeWasm({
          buildDir: ctx.paths.buildDir,
          outputFinalDir: ctx.paths.outputFinalDir,
          outputMjsFile: ctx.paths.outputMjsFile,
          outputSyncDir: ctx.paths.outputSyncDir,
          outputSyncJsFile: ctx.paths.outputSyncJsFile,
          outputWasmFile: ctx.paths.outputWasmFile,
        }),
    },
  ],
})
