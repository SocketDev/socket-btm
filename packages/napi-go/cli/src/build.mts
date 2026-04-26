/**
 * napi-go build driver.
 *
 * Compiles a Go package as a `-buildmode=c-archive` static library,
 * then links it against the napi-go C shim plus the consumer's own
 * shim to produce a `.node` addon for the current platform-arch.
 *
 * Intended entry point for downstream builder packages:
 *   import { buildNapiGoAddon } from 'napi-go/cli'
 *   await buildNapiGoAddon({
 *     packageRoot,      // absolute path to the consuming builder
 *     bindingName,      // output filename without .node suffix
 *     goDir,            // absolute path to Go source dir (contains *.go + go.mod)
 *     consumerShim,     // absolute path to consumer's C shim file
 *     outDir,           // where to write <bindingName>.node
 *     platformArch,     // e.g. 'darwin-arm64'
 *     mode,             // 'dev' | 'prod'
 *   })
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { getCCRemapFlags } from 'build-infra/lib/path-remap-flags'

import { getGoTarget, resolveNodeIncludeDir } from './resolve.mts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// napi-go package root (three levels up from cli/src/).
const NAPI_GO_ROOT = path.resolve(__dirname, '..', '..')
const NAPI_GO_CSHIM = path.join(NAPI_GO_ROOT, 'cshim', 'napi_go.c')
const NAPI_GO_INCLUDE = path.join(NAPI_GO_ROOT, 'include')
const NAPI_GO_SRC = path.join(NAPI_GO_ROOT, 'src')

const logger = getDefaultLogger()

/**
 * @typedef BuildOptions
 * @property {string} packageRoot   Absolute path to the consuming package.
 * @property {string} bindingName   Output name without the .node suffix.
 * @property {string} goDir         Absolute path to the consumer's Go source directory.
 * @property {string} consumerShim  Absolute path to the consumer's C shim (contains NAPI_MODULE_INIT).
 * @property {string} outDir        Absolute path where <bindingName>.node is written.
 * @property {string} platformArch  Target platform-arch (must match host for initial build; cross-compile later).
 * @property {string} [mode]        'dev' (default) or 'prod'. prod uses -O2 and strips symbols.
 */

/**
 * Build a napi-go addon end-to-end.
 *
 * @param {BuildOptions} opts
 * @returns {Promise<string>} Absolute path to the built .node file.
 */
export async function buildNapiGoAddon(opts) {
  const {
    packageRoot,
    bindingName,
    goDir,
    consumerShim,
    outDir,
    platformArch,
    mode = 'dev',
  } = opts

  validateOptions(opts)

  const { goos, goarch } = getGoTarget(platformArch)
  const nodeInclude = resolveNodeIncludeDir()

  await safeMkdir(outDir)

  // Step 1: Go c-archive. The Go entry package must live at goDir
  // and contain at least one //export symbol plus `package main` and
  // a no-op func main().
  const archive = path.join(outDir, `lib${bindingName}.a`)
  const archiveHeader = path.join(outDir, `lib${bindingName}.h`)

  logger.substep(
    `Compiling Go c-archive for ${platformArch} (${goos}/${goarch})`,
  )

  // cgo does not honor CLI -I flags; it reads CFLAGS from the env
  // plus any `#cgo CFLAGS:` directives in .go files. We pass both the
  // Node include dir and napi-go's own include dir so consumer Go
  // packages can include <node_api.h> and <napi_go.h> without further
  // configuration. Path-remap flags ensure the cgo-compiled C glue
  // doesn't carry the dev's home dir or the dev's home dir strings via
  // __FILE__ macros into the shipped .node — Go's own -trimpath
  // doesn't touch C side.
  const cgoCflags = [
    `-I${nodeInclude}`,
    `-I${NAPI_GO_INCLUDE}`,
    ...getCCRemapFlags(),
    process.env['CGO_CFLAGS'] || '',
  ]
    .filter(Boolean)
    .join(' ')
  const cgoCxxflags = [
    ...getCCRemapFlags(),
    process.env['CGO_CXXFLAGS'] || '',
  ]
    .filter(Boolean)
    .join(' ')

  const goEnv = {
    __proto__: null,
    ...process.env,
    CGO_ENABLED: '1',
    CGO_CFLAGS: cgoCflags,
    CGO_CXXFLAGS: cgoCxxflags,
    GOOS: goos,
    GOARCH: goarch,
  }

  // -trimpath + ldflags -s -w always: any committed or distributed
  // .node file must not carry host-absolute paths or retained DWARF.
  // Socket-btm's pre-push gate blocks personal paths in binaries, and
  // debug symbols survive into DWARF sections unless stripped. On
  // macOS the linker writes a sidecar dSYM bundle that our .gitignore
  // excludes; the .node itself ships clean either way.
  const goArgs = [
    'build',
    '-buildmode=c-archive',
    '-trimpath',
    '-ldflags=-s -w',
    '-o',
    archive,
  ]
  // Build the package at goDir (Go resolves the package from its dir).
  goArgs.push('./')

  const goResult = await spawn('go', goArgs, {
    cwd: goDir,
    env: goEnv,
    shell: WIN32,
    stdio: 'inherit',
  })
  const goExit = goResult.code ?? goResult.exitCode ?? 0
  if (goExit !== 0) {
    throw new Error(
      `napi-go: go build failed (exit ${goExit}). ` +
        `Ran: go ${goArgs.join(' ')} in ${goDir}. ` +
        `Verify Go >= 1.21 is on PATH and the package has a main func + //export symbols.`,
    )
  }

  if (!existsSync(archive)) {
    throw new Error(
      `napi-go: expected Go archive at ${archive} but it was not produced. ` +
        `Check 'go build' output above for the real failure.`,
    )
  }

  // Step 2: Link the N-API shim (napi-go's + consumer's) against the Go archive.
  const nodePath = path.join(outDir, `${bindingName}.node`)

  logger.substep(`Linking ${nodePath}`)

  const cc = await resolveCompiler()
  const linkArgs = buildLinkArgs({
    cc,
    platformArch,
    nodeInclude,
    napiGoInclude: NAPI_GO_INCLUDE,
    napiGoShim: NAPI_GO_CSHIM,
    consumerShim,
    goArchive: archive,
    outPath: nodePath,
    mode,
  })

  const ccResult = await spawn(cc.cmd, linkArgs, {
    cwd: outDir,
    env: process.env,
    shell: WIN32,
    stdio: 'inherit',
  })
  const ccExit = ccResult.code ?? ccResult.exitCode ?? 0
  if (ccExit !== 0) {
    throw new Error(
      `napi-go: linker failed (exit ${ccExit}). ` +
        `Ran: ${cc.cmd} ${linkArgs.join(' ')}. ` +
        `Verify the consumer shim at ${consumerShim} compiles against ` +
        `node_api.h and includes <${NAPI_GO_INCLUDE}/napi_go.h>.`,
    )
  }

  if (!existsSync(nodePath)) {
    throw new Error(
      `napi-go: expected ${nodePath} but no file was produced. ` +
        `Linker exit was 0 — check linker output above for silent warnings.`,
    )
  }

  // Clean up intermediate c-archive artifacts; the .node is self-contained.
  await fs.rm(archive, { force: true })
  await fs.rm(archiveHeader, { force: true })

  logger.success(`Built: ${nodePath}`)
  return nodePath
}

/**
 * @param {BuildOptions} opts
 */
function validateOptions(opts) {
  const required = [
    'packageRoot',
    'bindingName',
    'goDir',
    'consumerShim',
    'outDir',
    'platformArch',
  ]
  for (const key of required) {
    if (!opts[key]) {
      throw new Error(
        `napi-go.buildNapiGoAddon: missing required option '${key}'. ` +
          `All of { ${required.join(', ')} } must be provided.`,
      )
    }
  }
  if (!existsSync(opts.goDir)) {
    throw new Error(
      `napi-go: goDir does not exist: ${opts.goDir}. ` +
        `Point it at the directory containing the consumer's Go source files + go.mod.`,
    )
  }
  if (!existsSync(opts.consumerShim)) {
    throw new Error(
      `napi-go: consumerShim does not exist: ${opts.consumerShim}. ` +
        `Create a minimal C file that #includes <node_api.h> and <napi_go.h>, ` +
        `and registers NAPI_MODULE_INIT to forward to the consumer's Go //export init.`,
    )
  }
}

/**
 * Resolve a C compiler + driver flavor for the host platform.
 *
 * On darwin, prefer the Xcode-shipped clang located via xcrun — plain
 * `clang` on PATH is often a Homebrew LLVM install that can't find
 * the macOS system libraries/frameworks (`ld: library 'System' not
 * found`). xcrun points at the developer-tools clang which links
 * against the SDK correctly.
 *
 * @returns {Promise<{ cmd: string, flavor: 'clang' | 'gcc' | 'msvc' }>}
 */
async function resolveCompiler() {
  const override = process.env['NAPI_GO_CC']
  if (override) {
    return { cmd: override, flavor: classifyCompiler(override) }
  }
  const platform = process.platform
  if (platform === 'darwin') {
    const resolved = await resolveXcrunClang()
    return { cmd: resolved, flavor: 'clang' }
  }
  if (platform === 'linux') {
    return { cmd: 'cc', flavor: 'gcc' }
  }
  if (platform === 'win32') {
    throw new Error(
      `napi-go: Windows builds are not yet supported by the reference build driver. ` +
        `Set NAPI_GO_CC to a working C compiler, or contribute MSVC support.`,
    )
  }
  throw new Error(
    `napi-go: unsupported host platform '${platform}'. ` +
      `Set NAPI_GO_CC to override compiler detection.`,
  )
}

/**
 * Resolve the path to Xcode's clang via `xcrun --find clang`. Falls
 * back to plain `clang` on error so local installs without Xcode (but
 * with command-line tools or mingw cross-compilers) still have a
 * chance; diagnostic remains actionable on link failure.
 *
 * @returns {Promise<string>}
 */
async function resolveXcrunClang() {
  const result = await spawn('xcrun', ['--find', 'clang'], {
    shell: false,
    stdio: 'pipe',
  })
  const exit = result.code ?? result.exitCode ?? 0
  if (exit === 0) {
    const p = result.stdout?.toString().trim()
    if (p) {
      return p
    }
  }
  return 'clang'
}

/**
 * Classify a compiler command as clang / gcc / msvc based on its name.
 *
 * @param {string} cmd
 * @returns {'clang' | 'gcc' | 'msvc'}
 */
function classifyCompiler(cmd) {
  const base = path.basename(cmd).toLowerCase()
  if (base.includes('clang')) {
    return 'clang'
  }
  if (base === 'cl' || base === 'cl.exe') {
    return 'msvc'
  }
  return 'gcc'
}

/**
 * Build the compiler argument list to link the final .node.
 *
 * @param {object} params
 * @param {{cmd: string, flavor: string}} params.cc
 * @param {string} params.platformArch
 * @param {string} params.nodeInclude
 * @param {string} params.napiGoInclude
 * @param {string} params.napiGoShim
 * @param {string} params.consumerShim
 * @param {string} params.goArchive
 * @param {string} params.outPath
 * @param {string} params.mode
 */
function buildLinkArgs({
  cc,
  platformArch,
  nodeInclude,
  napiGoInclude,
  napiGoShim,
  consumerShim,
  goArchive,
  outPath,
  mode,
}) {
  const args = ['-shared']
  // Never embed DWARF from the C shim into the .node. Distribution
  // binaries must not carry host-path references, and the shim is
  // trivial enough that dev-mode debug info has no practical value.
  // When dev debugging is needed, rerun the build with
  // NAPI_GO_C_EXTRA='-g' and accept the local-only artifact.
  const optimize = mode === 'prod' ? ['-O2'] : ['-O0']

  if (platformArch.startsWith('darwin')) {
    // N-API symbols are resolved dynamically from the running Node.
    args.push('-undefined', 'dynamic_lookup')
    // -Wl,-S strips the symbol table on macOS at link time, matching
    // what `strip -x` would do post-link; keeps .node path-free.
    args.push('-Wl,-S')
    const sdk = process.env['SDKROOT']
    if (!sdk) {
      args.push('-isysroot', path.join(macosSDKFallback()))
    }
  } else if (platformArch.startsWith('linux')) {
    args.push('-fPIC')
    // -Wl,-s = strip all symbols at link time (GNU ld).
    args.push('-Wl,-s')
  }

  args.push(
    ...optimize,
    // Path-remap so the C shim and consumer shim don't embed host paths via
    // __FILE__ in error messages or DWARF in any debug builds that survive
    // into the .node.
    ...getCCRemapFlags(),
    `-I${nodeInclude}`,
    `-I${napiGoInclude}`,
    '-o',
    outPath,
    consumerShim,
    napiGoShim,
    goArchive,
  )

  // macOS frameworks Go's c-archive links against (CoreFoundation +
  // Security are pulled in by cgo's runtime on darwin).
  if (platformArch.startsWith('darwin')) {
    args.push('-framework', 'CoreFoundation', '-framework', 'Security')
  } else if (platformArch.startsWith('linux')) {
    // Go's c-archive on linux pulls in pthread/dl and libresolv for cgo.
    args.push('-lpthread', '-ldl', '-lresolv')
  }

  return args
}

/**
 * Best-effort fallback for macOS SDK path when SDKROOT is unset. The
 * build-infra `spawn` helper does not expose xcrun; we probe common
 * locations and otherwise throw, which the user resolves by running
 * `export SDKROOT=$(xcrun --show-sdk-path)`.
 *
 * @returns {string}
 */
function macosSDKFallback() {
  const common = [
    '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk',
    '/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk',
  ]
  for (const p of common) {
    if (existsSync(p)) {
      return p
    }
  }
  throw new Error(
    `napi-go: could not locate the macOS SDK. Expected one of: ${common.join(', ')}. ` +
      `Run 'xcode-select --install' or set SDKROOT=$(xcrun --show-sdk-path) before building.`,
  )
}
