#!/usr/bin/env node
/**
 * Build script for LIEF library.
 * Downloads prebuilt LIEF from GitHub releases or builds from source.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import { BUILD_STAGES, getBuildMode } from 'build-infra/lib/constants'
import { ALPINE_RELEASE_FILE } from 'build-infra/lib/environment-constants'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  detectLibc,
  downloadSocketBtmRelease,
  getPlatformArch,
} from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

const BUILD_MODE = getBuildMode()
const buildDir = path.join(packageRoot, 'build', BUILD_MODE)

const liefUpstream = path.join(packageRoot, 'upstream/lief')
const liefBuildDir = path.join(
  packageRoot,
  'build',
  BUILD_MODE,
  'out',
  BUILD_STAGES.FINAL,
  'lief',
)

const WIN32 = process.platform === 'win32'

/**
 * Extract LIEF version from .gitmodules comment.
 * The version is specified in the comment above the LIEF submodule entry.
 * @returns {string} LIEF version (e.g., "0.17.2")
 */
function getLiefVersion() {
  const gitmodulesPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '.gitmodules',
  )

  if (existsSync(gitmodulesPath)) {
    const content = readFileSync(gitmodulesPath, 'utf8')
    const liefSection = content.match(
      /\[submodule "packages\/bin-infra\/upstream\/lief"\][^[]*/,
    )
    if (liefSection) {
      const versionComment = liefSection[0].match(/# v(\d+\.\d+\.\d+)/)
      if (versionComment) {
        const version = versionComment[1]
        logger.info(`Detected LIEF version from .gitmodules: ${version}`)
        return version
      }
    }
  }

  throw new Error(
    'Failed to detect LIEF version. ' +
      'Expected version comment (e.g., "# v0.17.2") above LIEF submodule in .gitmodules',
  )
}

// LIEF version (extracted from .gitmodules comment).
const LIEF_VERSION = getLiefVersion()

/**
 * Detect if running on musl libc (Alpine Linux).
 */
function isMusl() {
  if (process.platform !== 'linux') {
    return false
  }

  // Check for Alpine release file.
  if (existsSync(ALPINE_RELEASE_FILE)) {
    return true
  }

  // Check ldd version for musl.
  try {
    const { execSync } = require('node:child_process')
    const lddVersion = execSync('ldd --version 2>&1', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return lddVersion.includes('musl')
  } catch {
    return false
  }
}

/**
 * Check if tar supports --no-absolute-names (GNU tar has it, busybox tar doesn't)
 */
async function tarSupportsNoAbsoluteNames() {
  try {
    const result = await spawn('tar', ['--help'], { stdio: 'pipe' })
    return result.stdout.includes('--no-absolute-names')
  } catch {
    return false
  }
}

async function runCommand(command, args, cwd, env = {}) {
  logger.info(`Running: ${command} ${args.join(' ')}`)

  // Merge env properly, filtering out undefined values.
  const mergedEnv = { ...process.env }
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete mergedEnv[key]
    } else {
      mergedEnv[key] = value
    }
  }

  const result = await spawn(command, args, {
    cwd,
    env: mergedEnv,
    stdio: 'inherit',
  })

  if (result.error) {
    throw new Error(`Command failed to spawn: ${result.error.message}`)
  }

  if (result.signal) {
    throw new Error(`Command terminated by signal: ${result.signal}`)
  }

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

/**
 * Verify that a prebuilt LIEF library is compatible with musl libc.
 * Checks for glibc-specific fortify symbols that would cause linker errors.
 * @param {string} libPath - Path to libLIEF.a
 * @returns {Promise<{compatible: boolean, reason?: string}>}
 */
async function verifyMuslCompatibility(libPath) {
  if (!isMusl()) {
    return { compatible: true }
  }

  logger.info('Verifying LIEF library for musl compatibility...')

  try {
    // Use nm to check for glibc-specific fortify symbols.
    // These symbols (__memcpy_chk, __printf_chk, etc.) don't exist in musl.
    const { execSync } = require('node:child_process')

    // First check if nm is available.
    try {
      execSync('which nm', { encoding: 'utf8', stdio: 'pipe' })
    } catch {
      logger.info('Warning: nm not found, cannot verify musl compatibility')
      return { compatible: true }
    }

    // Run nm and capture output (don't use || true so we can see errors).
    let nmOutput
    try {
      // 50MB buffer for large libraries.
      nmOutput = execSync(`nm ${libPath}`, {
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
      })
    } catch (nmError) {
      logger.info(`Warning: nm failed on ${libPath}: ${nmError.message}`)
      return { compatible: true }
    }

    // Check for common glibc fortify symbols.
    const glibcSymbols = [
      '__memcpy_chk',
      '__memmove_chk',
      '__memset_chk',
      '__strcpy_chk',
      '__strncpy_chk',
      '__strcat_chk',
      '__strncat_chk',
      '__sprintf_chk',
      '__snprintf_chk',
      '__printf_chk',
      '__fprintf_chk',
      '__vprintf_chk',
      '__vfprintf_chk',
      '__vsprintf_chk',
      '__vsnprintf_chk',
    ]

    const foundSymbols = glibcSymbols.filter(sym => nmOutput.includes(sym))

    if (foundSymbols.length > 0) {
      logger.info(`Found ${foundSymbols.length} glibc fortify symbol(s)`)
      return {
        compatible: false,
        reason: `Library contains glibc-specific fortify symbols: ${foundSymbols.join(', ')}`,
      }
    }

    logger.info('No glibc fortify symbols found - library is musl-compatible')
    return { compatible: true }
  } catch (error) {
    // If we can't check, warn but don't fail.
    logger.info(
      `Warning: Could not verify musl compatibility: ${error.message}`,
    )
    return { compatible: true }
  }
}

async function downloadPrebuiltLIEF() {
  try {
    logger.info('Checking for prebuilt LIEF releases...')

    const libc = detectLibc()
    const platformArch = getPlatformArch(process.platform, process.arch, libc)
    const assetName = `lief-${platformArch}.tar.gz`

    // Create build directory.
    await safeMkdir(liefBuildDir)

    // Download archive using socket-btm release helper.
    logger.info(`Downloading ${assetName}...`)

    await downloadSocketBtmRelease({
      asset: assetName,
      downloadDir: liefBuildDir,
      output: assetName,
      tool: 'lief',
    })

    // Extract archive.
    logger.info('Extracting LIEF archive...')

    // Ensure extract directory exists before extraction.
    await safeMkdir(liefBuildDir)

    // Path traversal protection: verify tarball contents before extraction
    const listResult = await spawn('tar', ['-tzf', assetName], {
      cwd: liefBuildDir,
      stdio: 'pipe',
    })
    const files = listResult.stdout
      .split('\n')
      .filter(Boolean)
      .map(f => f.trim())

    // Check for path traversal attempts
    for (const file of files) {
      const normalized = path.normalize(file)
      if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
        throw new Error(
          `Archive contains unsafe path: ${file} (path traversal attempt detected)`,
        )
      }
    }

    // Use relative path for tar to avoid Windows path issues with MSYS.
    // Extract from current directory (liefBuildDir) using just the filename.
    // Add --no-absolute-names on platforms that support it (defense in depth)
    const tarArgs = ['-xzf', assetName, '-C', '.']
    if (await tarSupportsNoAbsoluteNames()) {
      tarArgs.push('--no-absolute-names')
    }
    await runCommand('tar', tarArgs, liefBuildDir)

    // Clean up archive.
    await safeDelete(path.join(liefBuildDir, assetName))

    // Verify the downloaded library is compatible with musl if running on musl.
    const liefLibPath = path.join(liefBuildDir, 'libLIEF.a')
    if (existsSync(liefLibPath)) {
      const compatibility = await verifyMuslCompatibility(liefLibPath)
      if (!compatibility.compatible) {
        logger.info(
          `Prebuilt LIEF is not compatible with musl: ${compatibility.reason}`,
        )
        logger.info('Will need to build from source for musl compatibility')
        // Clean up the incompatible download.
        await safeDelete(liefBuildDir)
        return false
      }
    }

    logger.success('Successfully downloaded and extracted prebuilt LIEF')
    return true
  } catch (error) {
    logger.info(`Failed to download prebuilt LIEF: ${error.message}`)
    return false
  }
}

async function main() {
  try {
    // Determine which LIEF library file to check for (platform-specific naming)
    const liefLibUnix = path.join(
      buildDir,
      'out',
      BUILD_STAGES.FINAL,
      'lief',
      'libLIEF.a',
    )
    const liefLibMSVC = path.join(
      buildDir,
      'out',
      BUILD_STAGES.FINAL,
      'lief',
      'LIEF.lib',
    )
    const liefLibPath = existsSync(liefLibUnix)
      ? liefLibUnix
      : existsSync(liefLibMSVC)
        ? liefLibMSVC
        : null

    // Check if LIEF is already built.
    const forceRebuild = process.argv.includes('--force')
    const checkpointExists = !(await shouldRun(
      buildDir,
      '',
      'lief-built',
      forceRebuild,
    ))

    // Validate checkpoint: both checkpoint file AND library file must exist
    if (checkpointExists && liefLibPath && existsSync(liefLibPath)) {
      logger.success('LIEF already built (checkpoint exists)')
      return
    }

    // If checkpoint exists but library is missing, invalidate and rebuild
    if (checkpointExists && !liefLibPath) {
      logger.info(
        'Checkpoint exists but LIEF library missing, rebuilding from scratch',
      )
    }

    logger.info('🔨 Building LIEF library...\n')

    // Check if LIEF submodule is initialized.
    const liefSourceDir = path.join(packageRoot, 'upstream', 'lief')
    const liefCMakeLists = path.join(liefSourceDir, 'CMakeLists.txt')
    const isLiefBuild = existsSync(liefCMakeLists)

    if (!isLiefBuild) {
      // Not building LIEF itself - download prebuilt.
      logger.info('LIEF submodule not initialized, downloading prebuilt...')
      const downloaded = await downloadPrebuiltLIEF()
      if (downloaded) {
        // Verify library exists after download.
        const liefLibUnixNew = path.join(
          buildDir,
          'out',
          BUILD_STAGES.FINAL,
          'lief',
          'libLIEF.a',
        )
        const liefLibMSVCNew = path.join(
          buildDir,
          'out',
          BUILD_STAGES.FINAL,
          'lief',
          'LIEF.lib',
        )
        const liefLibPathNew = existsSync(liefLibUnixNew)
          ? liefLibUnixNew
          : existsSync(liefLibMSVCNew)
            ? liefLibMSVCNew
            : null

        if (liefLibPathNew && existsSync(liefLibPathNew)) {
          const stats = await fs.stat(liefLibPathNew)
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

          await createCheckpoint(
            buildDir,
            'lief-built',
            async () => {
              // Verify library exists and has reasonable size.
              const libStats = await fs.stat(liefLibPathNew)
              if (libStats.size < 1_000_000) {
                throw new Error(
                  `LIEF library too small: ${libStats.size} bytes (expected >1MB)`,
                )
              }

              // Verify config.h was generated (required for compilation).
              const configHeader = path.join(
                liefBuildDir,
                'include',
                'LIEF',
                'config.h',
              )
              if (!existsSync(configHeader)) {
                throw new Error(
                  `LIEF config.h not found at ${configHeader} - incomplete download`,
                )
              }
            },
            {
              version: LIEF_VERSION,
              libPath: path.relative(buildDir, liefLibPathNew),
              libSize: stats.size,
              libSizeMB: sizeMB,
              buildDir: path.relative(packageRoot, liefBuildDir),
              artifactPath: liefBuildDir,
            },
          )
          return
        }
      }

      // Prebuilt download failed - cannot continue.
      throw new Error(
        'Failed to download prebuilt LIEF. Run: git submodule update --init --recursive packages/bin-infra/upstream/lief',
      )
    }

    logger.info(
      `Building LIEF on ${process.platform} for cross-platform binary injection support`,
    )

    // Create build directory.
    await safeMkdir(buildDir)

    // Check if LIEF upstream exists.
    if (!existsSync(liefUpstream)) {
      throw new Error(
        `LIEF upstream not found at ${liefUpstream}. Run 'git submodule update --init --recursive' first.`,
      )
    }
    logger.info('LIEF upstream found')

    // Create build directory.
    await safeMkdir(liefBuildDir)

    // Configure LIEF with CMake.
    logger.info('Configuring LIEF with CMake...')
    const cmakeArgs = [
      liefUpstream,
      '-DCMAKE_BUILD_TYPE=Release',
      '-DLIEF_PYTHON_API=OFF',
      '-DLIEF_C_API=OFF',
      '-DLIEF_EXAMPLES=OFF',
      '-DLIEF_TESTS=OFF',
      '-DLIEF_DOC=OFF',
      '-DLIEF_LOGGING=OFF',
      '-DLIEF_LOGGING_DEBUG=OFF',
      '-DLIEF_ENABLE_JSON=OFF',
    ]

    // On Windows, use gcc/MinGW for consistent ABI (CI and binsuite)
    // LIEF must use the same compiler/ABI as binject to avoid linker errors
    if (WIN32) {
      // Always use gcc/g++ on Windows for MinGW ABI compatibility
      // Even if CC/CXX env vars are set to clang, override for LIEF build
      const cc = 'gcc'
      const cxx = 'g++'

      cmakeArgs.push(`-DCMAKE_C_COMPILER=${cc}`, `-DCMAKE_CXX_COMPILER=${cxx}`)

      // Use MinGW Makefiles generator for MinGW toolchain
      cmakeArgs.push('-G', 'MinGW Makefiles')

      logger.info('Building LIEF with gcc/g++ using MinGW Makefiles')
    }

    // On musl, disable fortify source to avoid glibc-specific fortify functions.
    // musl libc does not provide __*_chk functions (e.g., __snprintf_chk, __memcpy_chk).
    // This prevents linking errors when binject (built on musl) tries to link LIEF.
    // Use -U to undefine first in case it's set elsewhere, then define as 0.
    // The -Wp,-U_FORTIFY_SOURCE passes -U directly to the preprocessor (more reliable).
    if (isMusl()) {
      // Use multiple approaches to ensure _FORTIFY_SOURCE is disabled:
      // 1. -Wp,-U passes to preprocessor directly (bypasses compiler default flags)
      // 2. -U_FORTIFY_SOURCE undefines at compiler level
      // 3. -D_FORTIFY_SOURCE=0 explicitly sets to 0
      const fortifyDisableFlags =
        '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
      // Set flags for both base and Release configurations.
      // CMAKE_C_FLAGS is the base, CMAKE_C_FLAGS_RELEASE is appended for Release builds.
      // We put fortify flags in both to ensure they're always present.
      cmakeArgs.push(
        `-DCMAKE_C_FLAGS=${fortifyDisableFlags}`,
        `-DCMAKE_CXX_FLAGS=${fortifyDisableFlags}`,
        `-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG ${fortifyDisableFlags}`,
        `-DCMAKE_CXX_FLAGS_RELEASE=-O3 -DNDEBUG ${fortifyDisableFlags}`,
      )
      logger.info('Disabling fortify source for musl libc compatibility')
    }

    // Use ccache if available.
    try {
      await runCommand('which', ['ccache'], liefBuildDir)
      cmakeArgs.push('-DCMAKE_CXX_COMPILER_LAUNCHER=ccache')
      logger.info('Using ccache for faster compilation')
    } catch {
      logger.info('ccache not available, building without cache')
    }

    // Clear compiler flags that may have been set for the main binject build.
    // LIEF build uses its own compiler settings and shouldn't inherit these.
    // Exception: For musl, we must set CFLAGS/CXXFLAGS as environment variables
    // to ensure subdependencies (like mbedtls) also disable fortify source.
    // Use multiple approaches for reliability (see cmake flags comment above).
    const muslFortifyFlags = isMusl()
      ? '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
      : undefined
    const cleanEnv = {
      // Set LIEF version explicitly for CMake (LIEF's CMakeLists.txt reads this).
      // Required because shallow git clones can't determine version from git tags.
      LIEF_VERSION_ENV: LIEF_VERSION,
      CFLAGS: muslFortifyFlags,
      CXXFLAGS: muslFortifyFlags,
      // CPPFLAGS is specifically for the C PreProcessor - belt and suspenders approach.
      CPPFLAGS: isMusl() ? '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0' : undefined,
      LDFLAGS: undefined,
    }
    await runCommand('cmake', cmakeArgs, liefBuildDir, cleanEnv)
    logger.info('')

    // Build LIEF.
    logger.info('Building LIEF (this may take 10-20 minutes)...')
    const buildStart = Date.now()
    // Use the same cleanEnv to ensure subdependencies get the flags.
    await runCommand(
      'cmake',
      ['--build', '.', '--config', 'Release', '-j1'],
      liefBuildDir,
      cleanEnv,
    )
    const buildDuration = Math.round((Date.now() - buildStart) / 1000)
    logger.info(
      `LIEF build completed in ${buildDuration}s (${Math.floor(buildDuration / 60)}m ${buildDuration % 60}s)`,
    )
    logger.info('')

    logger.success('LIEF build completed successfully!')

    // Verify library exists (platform-specific naming).
    // When using clang on Windows with Ninja/Unix Makefiles, it produces LIEF.lib (MSVC-style)
    // When using gcc/MinGW on Windows, it produces libLIEF.a (Unix-style)
    // On Unix platforms: libLIEF.a
    let libPath = path.join(liefBuildDir, 'libLIEF.a')
    if (!existsSync(libPath)) {
      // Try Windows MSVC-style naming
      libPath = path.join(liefBuildDir, 'LIEF.lib')
      if (!existsSync(libPath)) {
        throw new Error(
          `LIEF library not found (checked libLIEF.a and LIEF.lib in ${liefBuildDir})`,
        )
      }
    }

    const stats = await fs.stat(libPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.info(`LIEF library size: ${sizeMB} MB`)

    // Verify musl compatibility immediately after build (fail fast).
    const compatibility = await verifyMuslCompatibility(libPath)
    if (!compatibility.compatible) {
      throw new Error(
        `LIEF build produced musl-incompatible library: ${compatibility.reason}. ` +
          'This indicates _FORTIFY_SOURCE was not properly disabled during compilation.',
      )
    }
    if (isMusl()) {
      logger.success(
        'LIEF library verified musl-compatible (no glibc fortify symbols)',
      )
    }

    // Copy upstream headers to build directory for standalone distribution.
    // The checkpoint tarball needs to include all headers required for compilation,
    // not just the generated config.h and version.h from the CMake build.
    logger.info('Copying upstream headers for standalone distribution...')
    const upstreamIncludeDir = path.join(liefUpstream, 'include', 'LIEF')
    const buildIncludeDir = path.join(liefBuildDir, 'include', 'LIEF')

    // Ensure target directory exists.
    await safeMkdir(buildIncludeDir)

    // Recursively copy all header files from upstream to build directory.
    const copyUpstreamHeaders = async (src, dest) => {
      const entries = await fs.readdir(src, { withFileTypes: true })

      for (const entry of entries) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)

        if (entry.isDirectory()) {
          await safeMkdir(destPath)
          await copyUpstreamHeaders(srcPath, destPath)
        } else if (
          entry.name.endsWith('.hpp') ||
          entry.name.endsWith('.h') ||
          entry.name.endsWith('.def')
        ) {
          await fs.copyFile(srcPath, destPath)
        }
      }
    }

    await copyUpstreamHeaders(upstreamIncludeDir, buildIncludeDir)
    logger.success('Upstream headers copied to build directory')
    logger.info('')

    // Create checkpoint.
    await createCheckpoint(
      buildDir,
      'lief-built',
      async () => {
        // Verify library exists and has reasonable size.
        const libStats = await fs.stat(libPath)
        if (libStats.size < 1_000_000) {
          throw new Error(
            `LIEF library too small: ${libStats.size} bytes (expected >1MB)`,
          )
        }

        // Verify config.h was generated (required for compilation).
        const configHeader = path.join(
          liefBuildDir,
          'include',
          'LIEF',
          'config.h',
        )
        if (!existsSync(configHeader)) {
          throw new Error(
            `LIEF config.h not found at ${configHeader} - incomplete build`,
          )
        }
      },
      {
        version: LIEF_VERSION,
        libPath: path.relative(buildDir, libPath),
        libSize: stats.size,
        libSizeMB: sizeMB,
        buildDir: path.relative(packageRoot, liefBuildDir),
        artifactPath: liefBuildDir,
      },
    )
  } catch (error) {
    logger.info('')
    logger.fail(`LIEF build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
