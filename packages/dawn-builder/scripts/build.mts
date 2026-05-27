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

import { copyFileSync, existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { which } from '@socketsecurity/lib-stable/bin/which'
import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

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

  const platformArch = await getCurrentPlatformArch()
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

  // Generate Tint sources first, serially. Invoking via CMake's
  // tint_generate_sources target swallowed `go run` failures (cmake's
  // add_custom_command reports success even on non-zero exit when the
  // OUTPUT files exist from a prior run OR are declared but missing —
  // ninja just schedules dependents anyway). Calling `go run` directly
  // surfaces the real exit code and lets us fail loudly with the actual
  // gen tool's stderr.
  logger.step('Generating Tint source files (direct go run)')
  const goPath = await which('go')
  if (!goPath) {
    throw new Error(
      `go not found on PATH. Dawn's Tint code generator requires Go; install actions/setup-go in the workflow.`,
    )
  }
  const genOutDir = path.join(paths.cmakeDir, 'gen')
  // Compile the gen tool to a real binary under the dawn checkout
  // rather than using `go run`. Tint's fileutils.DawnRoot() walks up
  // from runtime.Caller's path looking for a DEPS file — `go run`
  // can normalize source paths in ways that defeat the walk (we've
  // seen 0.3s exits with no output even though the gen tool builds
  // cleanly). A `go build -o <dawn>/build/.../gen` keeps the source
  // paths embedded as the actual dawn checkout, so DawnRoot's walk
  // up from /<dawn>/tools/src/fileutils/paths.go finds DEPS at
  // /<dawn>/DEPS as expected.
  const genBinDir = path.join(paths.cmakeDir, '.gen-bin')
  await safeMkdir(genBinDir, { recursive: true })
  const genBin = path.join(genBinDir, process.platform === 'win32' ? 'gen.exe' : 'gen')
  logger.info(`Compiling gen → ${genBin}`)
  const buildBin = await spawn(
    goPath,
    ['build', '-o', genBin, './tools/src/cmd/gen'],
    { cwd: UPSTREAM_DAWN_DIR, stdio: 'inherit' },
  )
  if (buildBin.code !== 0) {
    throw new Error(`go build of Tint gen tool failed with exit code ${buildBin.code}.`)
  }
  // Diagnostics — confirm what the gen binary will actually see.
  const depsPath = path.join(UPSTREAM_DAWN_DIR, 'DEPS')
  logger.info(`UPSTREAM_DAWN_DIR=${UPSTREAM_DAWN_DIR}`)
  logger.info(`DEPS exists at ${depsPath}: ${existsSync(depsPath)}`)
  logger.info(`gen binary: ${genBin} (exists: ${existsSync(genBin)})`)
  logger.info(`output dir: ${genOutDir}`)
  // Strings dump of fileutils source paths embedded in the binary —
  // these are the values runtime.Caller will report, which DawnRoot's
  // walk-up uses to find DEPS. If the embedded path doesn't anchor at
  // <dawn>/tools/src/fileutils/, DawnRoot fails silently.
  logger.info('Embedded fileutils paths in binary:')
  const stringsResult = await spawn('sh', [
    '-c',
    `strings "${genBin}" | grep -E 'fileutils/paths\\.go|tools/src/fileutils' | head -5`,
  ], { stdio: 'inherit' })
  logger.info(`strings probe exit: ${stringsResult.code}`)
  // Upstream Tint's glob.Scan walker has a latent bug:
  //
  //   if rel == ".git" { return filepath.SkipDir }
  //
  // is meant to skip the .git DIRECTORY, but in a git submodule checkout
  // `.git` is a regular FILE (a gitdir pointer like
  // "gitdir: ../../.git/modules/<path>"). When filepath.Walk's callback
  // returns SkipDir for a file, Go skips the REMAINDER of the parent
  // directory — so the walker stops after 7 entries (`.bazelrc`,
  // `.bazelversion`, `.clang-format*`, `.git`) and never reaches
  // `src/tint/**/*.tmpl`, producing zero matches, zero generated files,
  // and a silent exit code 0.
  //
  // Workaround: temporarily move the .git file out of the way before
  // invoking gen, and restore it after. We can't patch upstream (fleet
  // forbids forks of canonical upstream sources), and the gen tool
  // doesn't honor any env-var override.
  const dotGit = path.join(UPSTREAM_DAWN_DIR, '.git')
  const dotGitMoved = path.join(UPSTREAM_DAWN_DIR, '.git.moved-for-tint-gen')
  const dotGitExists = existsSync(dotGit)
  if (dotGitExists) {
    await fs.rename(dotGit, dotGitMoved)
  }
  try {
    logger.info(`Running: ${genBin} sources ${genOutDir} (cwd=${UPSTREAM_DAWN_DIR})`)
    const genResult = await spawn(
      genBin,
      ['sources', genOutDir],
      { cwd: UPSTREAM_DAWN_DIR, stdio: 'inherit' },
    )
    logger.info(`gen exit code: ${genResult.code}`)
    if (genResult.code !== 0) {
      throw new Error(
        `Tint source generation failed with exit code ${genResult.code}.`,
      )
    }
  } finally {
    if (dotGitExists) {
      await fs.rename(dotGitMoved, dotGit)
    }
  }
  // Diagnostic: confirm the gen tool actually produced the canonical
  // first-target output file. If empty, fileutils.DawnRoot() returned
  // "" (couldn't walk up to DEPS) and glob matched 0 templates.
  const enumsCc = path.join(
    genOutDir, 'src', 'tint', 'lang', 'core', 'enums.cc',
  )
  if (!existsSync(enumsCc)) {
    throw new Error(
      `Tint gen produced no output: ${enumsCc} is missing. ` +
        `DawnRoot() likely returned "" (couldn't find DEPS in walked-up parents). ` +
        `Try running the gen binary with strace -f -e openat to confirm.`,
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

  // Stage public headers alongside the static lib. Dawn's CMake build
  // only emits libs to <out>/lib; the public C / C++ API headers ship
  // from the upstream tree directly. Copy them into <out>/include so
  // the workflow's verify-output + archive steps see a complete set.
  const headerSrcDir = path.join(UPSTREAM_DAWN_DIR, 'include')
  const headerDstDir = path.join(paths.outputDir, 'include')
  await safeMkdir(headerDstDir, { recursive: true })
  // Two top-level header subtrees: include/dawn/ + include/webgpu/.
  for (const sub of ['dawn', 'webgpu']) {
    const src = path.join(headerSrcDir, sub)
    const dst = path.join(headerDstDir, sub)
    if (existsSync(src)) {
      await fs.cp(src, dst, { recursive: true })
    }
  }
  logger.success(`Dawn headers staged at ${headerDstDir}`)
}

main().catch(err => {
  logger.fail(`dawn-builder failed: ${err}`)
  process.exitCode = 1
})
