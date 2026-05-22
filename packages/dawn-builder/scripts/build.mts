#!/usr/bin/env node
/**
 * Build Dawn via the CMake island-build path.
 *
 * Dawn ships two build systems:
 *   - GN + depot_tools (Chromium's default; ~3 GB of tooling)
 *   - Self-contained CMake at upstream/dawn/CMakeLists.txt
 *
 * We use the CMake form — same shape as yoga-layout-builder /
 * onnxruntime-builder. CMake fetches Dawn's third-party deps via
 * FetchContent (DAWN_FETCH_DEPENDENCIES=ON), so no manual checkout
 * of abseil-cpp / spirv-tools / etc. is required.
 *
 * Output (per --mode = dev|prod, current platform-arch):
 *   build/<mode>/<platform-arch>/cmake/   — cmake configure artifacts
 *   build/<mode>/<platform-arch>/out/
 *     lib/libwebgpu_dawn.a                — static library node-smol links
 *     include/                            — public headers
 *
 * Flags:
 *   --mode=dev|prod   (default: dev)        debug vs release optimization
 *   --force                                  re-configure even if cached
 *   --jobs=N         (default: ncpu)        parallel ninja workers
 *
 * Drift watch:
 *   - DAWN_BUILD_NODE_BINDINGS=OFF — we adapt the binding ourselves.
 *   - DAWN_BUILD_TESTS=OFF + TINT_BUILD_TESTS=OFF — Dawn's CMake
 *     pulls googletest when tests are on; we don't run them.
 *   - DAWN_BUILD_SAMPLES=OFF — sample apps would also pull GLFW.
 *   - BUILD_SHARED_LIBS=OFF + CMAKE_POSITION_INDEPENDENT_CODE=ON —
 *     we need a static lib that can be linked into node-smol's
 *     executable (PIC required for static libs included in the
 *     final relocatable link).
 *
 * NOTE: this is the D3 scaffold. The full build will take 30-60 min
 * on first run + ~150 GB peak disk during the third-party fetch.
 * Build caching (ccache) lands in a follow-up.
 */

import { copyFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { which } from '@socketsecurity/lib-stable/bin/which'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { UPSTREAM_DAWN_DIR, getBuildPaths } from './paths.mts'

const logger = getDefaultLogger()

interface BuildOptions {
  mode: 'dev' | 'prod'
  force: boolean
  jobs: number
}

export function parseArgs(): BuildOptions {
  const args = process.argv.slice(2)
  let mode: 'dev' | 'prod' = 'dev'
  let force = false
  let jobs = 0
  for (let i = 0, { length } = args; i < length; i += 1) {
    const a = args[i]
    if (a === '--prod') {
      mode = 'prod'
    } else if (a === '--dev') {
      mode = 'dev'
    } else if (a.startsWith('--mode=')) {
      const v = a.slice('--mode='.length)
      if (v === 'dev' || v === 'prod') {
        mode = v
      }
    } else if (a === '--force') {
      force = true
    } else if (a.startsWith('--jobs=')) {
      jobs = parseInt(a.slice('--jobs='.length), 10) || 0
    }
  }
  if (jobs === 0) {
    jobs = (typeof os.availableParallelism === 'function'
      ? os.availableParallelism()
      : os.cpus().length) || 4
  }
  return { force, jobs, mode }
}

async function main(): Promise<void> {
  const opts = parseArgs()

  if (!existsSync(UPSTREAM_DAWN_DIR)) {
    throw new Error(
      `Dawn submodule not found at ${UPSTREAM_DAWN_DIR}. Run \`git submodule update --init packages/dawn-builder/upstream/dawn\` first.`,
    )
  }

  const cmakePath = await which('cmake')
  if (!cmakePath) {
    throw new Error(
      `cmake not found on PATH. Dawn requires CMake ≥ 3.30; pinned version + install lives in packages/dawn-builder/external-tools.json.`,
    )
  }
  const ninjaPath = await which('ninja')
  if (!ninjaPath) {
    throw new Error(
      `ninja not found on PATH. Dawn's CMake setup generates Ninja files; pinned version lives in packages/dawn-builder/external-tools.json.`,
    )
  }

  const platformArch = getCurrentPlatformArch()
  const paths = getBuildPaths(opts.mode, platformArch)

  await safeMkdir(paths.cmakeDir, { recursive: true })
  await safeMkdir(paths.outputDir, { recursive: true })

  // CMake configure.
  const configureArgs = [
    '-S',
    UPSTREAM_DAWN_DIR,
    '-B',
    paths.cmakeDir,
    '-G',
    'Ninja',
    `-DCMAKE_BUILD_TYPE=${opts.mode === 'prod' ? 'Release' : 'RelWithDebInfo'}`,
    '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
    '-DBUILD_SHARED_LIBS=OFF',
    '-DDAWN_BUILD_NODE_BINDINGS=OFF',
    '-DDAWN_BUILD_SAMPLES=OFF',
    '-DDAWN_BUILD_TESTS=OFF',
    '-DDAWN_FETCH_DEPENDENCIES=ON',
    '-DTINT_BUILD_TESTS=OFF',
    `-DCMAKE_INSTALL_PREFIX=${paths.outputDir}`,
  ]
  logger.step(`Configuring Dawn (mode=${opts.mode}, jobs=${opts.jobs})`)
  const configureResult = await spawn(cmakePath, configureArgs, {
    cwd: UPSTREAM_DAWN_DIR,
    stdio: 'inherit',
  })
  if (configureResult.code !== 0) {
    throw new Error(
      `cmake configure failed with exit code ${configureResult.code}`,
    )
  }

  // CMake build — produces libwebgpu_dawn.a + transitive Tint /
  // SPIRV-Tools static libs.
  const buildArgs = [
    '--build',
    paths.cmakeDir,
    '--target',
    'webgpu_dawn',
    '--parallel',
    String(opts.jobs),
  ]
  logger.step('Building webgpu_dawn target')
  const buildResult = await spawn(cmakePath, buildArgs, {
    stdio: 'inherit',
  })
  if (buildResult.code !== 0) {
    throw new Error(`cmake build failed with exit code ${buildResult.code}`)
  }

  // Verify the expected output landed AND copy it into the canonical
  // output path that paths.mts declares. CMake places the static lib
  // at <cmakeDir>/src/dawn/native/libwebgpu_dawn.a; downstream consumers
  // (node-smol's configure step that defines HAVE_DAWN) look at
  // paths.outputLibFile, so we land it there in one step.
  const builtLib = path.join(
    paths.cmakeDir, 'src', 'dawn', 'native', 'libwebgpu_dawn.a',
  )
  if (!existsSync(builtLib)) {
    throw new Error(
      `Build succeeded but ${builtLib} not found. CMake target layout may have changed; check Dawn's CMakeLists.txt.`,
    )
  }
  await safeMkdir(path.dirname(paths.outputLibFile), { recursive: true })
  copyFileSync(builtLib, paths.outputLibFile)
  logger.success(`Dawn built at ${paths.outputLibFile}`)
}

main().catch(err => {
  logger.fail(`dawn-builder failed: ${err}`)
  process.exitCode = 1
})
