/**
 * Build yoga-layout — size-optimized Yoga Layout WASM for Socket CLI.
 *
 * Declarative manifest consumed by build-infra/lib/build-pipeline. The
 * orchestrator handles:
 *   - --prod / --dev / --force / --clean / --clean-stage / --from-stage
 *   - Unified cache key (external-tools.json + package.json sources)
 *   - Per-stage shouldRun() / createCheckpoint() wrapping
 *   - Missing-output clean-up
 *
 * Stage workers (./<stage>/shared/*.mts) return StageResult objects that
 * carry the smoke test + artifactPath instead of writing the checkpoint
 * themselves.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

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

import {
  PACKAGE_ROOT,
  getBindingsPaths,
  getBuildPaths,
  getSharedBuildPaths,
} from './paths.mts'
import { finalizeWasm } from './finalized/shared/finalize-wasm.mts'
import { cloneYogaSource } from './source-cloned/shared/clone-source.mts'
import { configureCMake } from './source-configured/shared/configure-cmake.mts'
import { compileWasm } from './wasm-compiled/shared/compile-wasm.mts'
import { optimizeWasm } from './wasm-optimized/shared/optimize-wasm.mts'
import { copyToRelease } from './wasm-released/shared/copy-to-release.mts'
import { generateSync } from './wasm-synced/shared/generate-sync.mts'

const pkgJson = JSON.parse(
  await fs.readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'),
)
const yogaSource = pkgJson.sources?.yoga
if (!yogaSource) {
  throw new Error('Missing sources.yoga in package.json')
}

await runPipelineCli({
  packageRoot: PACKAGE_ROOT,
  packageName: 'yoga',
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
    const emscriptenVersion = await getEmscriptenVersion(PACKAGE_ROOT)
    const emscriptenResult = await ensureEmscripten({
      autoInstall: true,
      quiet: false,
      version: emscriptenVersion,
    })
    if (!emscriptenResult.available) {
      throw new Error('Emscripten SDK required')
    }
    await ensureToolInstalled('wasm-opt', { autoInstall: true })
    await checkDiskSpace(PACKAGE_ROOT, 1)
  },
  stages: [
    {
      name: CHECKPOINTS.SOURCE_CLONED,
      shared: true,
      run: async ctx =>
        cloneYogaSource({
          sharedBuildDir: ctx.sharedPaths.buildDir,
          sharedSourceDir: ctx.sharedPaths.sourceDir,
          yogaRepo: yogaSource.url,
          yogaSha: yogaSource.ref,
          yogaVersion: `v${yogaSource.version}`,
        }),
    },
    {
      name: CHECKPOINTS.SOURCE_CONFIGURED,
      run: async ctx => {
        const emscriptenVersion = await getEmscriptenVersion(ctx.packageRoot)
        return configureCMake({
          buildMode: ctx.buildMode,
          cmakeBuildDir: ctx.paths.cmakeDir,
          emscriptenVersion,
          sourceDir: ctx.sharedPaths.sourceDir,
        })
      },
    },
    {
      name: CHECKPOINTS.WASM_COMPILED,
      run: async ctx => {
        const { bindingsDir, bindingsFiles } = getBindingsPaths(
          ctx.sharedPaths.sourceDir,
        )
        return compileWasm({
          bindingsDir,
          bindingsFiles,
          buildDir: ctx.paths.buildDir,
          buildJsFile: ctx.paths.jsFile,
          buildMode: ctx.buildMode,
          buildWasmFile: ctx.paths.wasmFile,
          cmakeBuildDir: ctx.paths.cmakeDir,
          sourceDir: ctx.sharedPaths.sourceDir,
          staticLibFile: ctx.paths.staticLibFile,
        })
      },
    },
    {
      name: CHECKPOINTS.WASM_RELEASED,
      run: async ctx =>
        copyToRelease({
          buildDir: ctx.paths.buildDir,
          buildJsFile: ctx.paths.jsFile,
          buildWasmFile: ctx.paths.wasmFile,
          outputReleaseDir: ctx.paths.outputReleaseDir,
        }),
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
        generateSync({
          buildDir: ctx.paths.buildDir,
          buildMode: ctx.buildMode,
          outputOptimizedDir: ctx.paths.outputOptimizedDir,
          outputReleaseDir: ctx.paths.outputReleaseDir,
          outputSyncDir: ctx.paths.outputSyncDir,
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
