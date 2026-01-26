/**
 * Build script for LIEF library.
 * Downloads prebuilt LIEF from GitHub releases or builds from source.
 */

import { existsSync, promises as fs, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  getBuildMode,
} from 'build-infra/lib/constants'
import { isMusl } from 'build-infra/lib/platform-mappings'
import { extractTarball } from 'build-infra/lib/tarball-utils'

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
const liefPatchedDir = path.join(
  packageRoot,
  'build',
  'shared',
  'source',
  'lief',
)
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
 * Get the local LIEF library directory path.
 *
 * @param {string} [buildMode] - Build mode (prod/dev). Defaults to current BUILD_MODE.
 * @returns {string} Path to local LIEF build directory.
 */
export function getLocalLiefDir(buildMode) {
  const mode = buildMode ?? BUILD_MODE
  return path.join(
    packageRoot,
    'build',
    mode,
    'out',
    BUILD_STAGES.FINAL,
    'lief',
  )
}

/**
 * Get the downloaded LIEF directory for a platform-arch.
 *
 * @param {string} platformArch - Platform-arch identifier (e.g., 'linux-x64-musl').
 * @returns {string} Path to downloaded LIEF directory.
 */
export function getDownloadedLiefDir(platformArch) {
  return path.join(packageRoot, 'build', 'downloaded', 'lief', platformArch)
}

/**
 * Get current platform-arch for LIEF.
 * LIEF releases use 'win' not 'win32' for Windows platforms.
 *
 * @returns {string} Platform-arch identifier.
 */
function getCurrentLiefPlatformArch() {
  const libc = detectLibc()
  // Respect TARGET_ARCH for cross-compilation (set by workflows/Makefiles)
  const arch = process.env.TARGET_ARCH || process.arch
  // LIEF releases use 'win' not 'win32'
  const platform = process.platform === 'win32' ? 'win' : process.platform
  return getPlatformArch(platform, arch, libc).replace('win32', 'win')
}

/**
 * Check if LIEF library exists at a given directory.
 *
 * @param {string} dir - Directory to check.
 * @returns {boolean} True if LIEF library exists at the directory.
 */
export function liefExistsAt(dir) {
  const unixPath = path.join(dir, 'libLIEF.a')
  const msvcPath = path.join(dir, 'LIEF.lib')
  return existsSync(unixPath) || existsSync(msvcPath)
}

/**
 * Get the LIEF library path at a specific directory (platform-specific).
 *
 * @param {string} dir - Directory to check.
 * @returns {string|null} Path to LIEF library if exists, null otherwise.
 */
function getLiefLibPathAt(dir) {
  const unixPath = path.join(dir, 'libLIEF.a')
  const msvcPath = path.join(dir, 'LIEF.lib')

  if (existsSync(unixPath)) {
    return unixPath
  }
  if (existsSync(msvcPath)) {
    return msvcPath
  }
  return null
}

/**
 * Get the LIEF library path (platform-specific).
 *
 * @param {string} [buildMode] - Build mode (prod/dev). Defaults to current BUILD_MODE.
 * @returns {string|null} Path to LIEF library if exists, null otherwise.
 */
export function getLiefLibPath(buildMode) {
  return getLiefLibPathAt(getLocalLiefDir(buildMode))
}

/**
 * Check if LIEF library exists.
 *
 * @param {string} [buildMode] - Build mode (prod/dev). Defaults to current BUILD_MODE.
 * @returns {boolean} True if LIEF library exists.
 */
export function liefExists(buildMode) {
  return getLiefLibPath(buildMode) !== null
}

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
  if (!(await isMusl())) {
    return { compatible: true }
  }

  logger.info('Verifying LIEF library for musl compatibility...')

  try {
    // Use nm to check for glibc-specific fortify symbols.
    // These symbols (__memcpy_chk, __printf_chk, etc.) don't exist in musl.

    // First check if nm is available.
    try {
      await spawn('which', ['nm'], { stdio: 'pipe' })
    } catch {
      logger.info('Warning: nm not found, cannot verify musl compatibility')
      return { compatible: true }
    }

    // Run nm and capture output.
    let nmOutput
    try {
      const result = await spawn('nm', [libPath], { stdio: 'pipe' })
      nmOutput = result.stdout
    } catch (nmError) {
      logger.info(
        `Warning: nm failed on ${libPath}: ${nmError?.message || 'Unknown error'}`,
      )
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

/**
 * Copy LIEF source from upstream to build directory.
 * This allows patching without modifying the git submodule.
 * @param {string} sourceDir - Destination directory for copied source
 */
async function copyLiefSource(sourceDir) {
  // Check if LIEF upstream exists
  if (!existsSync(liefUpstream)) {
    throw new Error(
      `LIEF upstream not found at ${liefUpstream}. Run 'git submodule update --init --recursive' first.`,
    )
  }

  // Remove existing source directory if it exists
  if (existsSync(sourceDir)) {
    await safeDelete(sourceDir)
  }

  // Create parent directory
  await safeMkdir(path.dirname(sourceDir))

  // Copy source (excluding .git directory)
  logger.info('Copying LIEF source to build directory...')
  if (WIN32) {
    // Windows: use robocopy
    await runCommand(
      'robocopy',
      [
        liefUpstream,
        sourceDir,
        '/E',
        '/XD',
        '.git',
        '/NFL',
        '/NDL',
        '/NJH',
        '/NJS',
      ],
      packageRoot,
    ).catch(() => {
      // robocopy returns non-zero for success with copies, ignore
    })
  } else {
    // Unix: use rsync or cp
    try {
      await runCommand(
        'rsync',
        ['-a', '--exclude=.git', `${liefUpstream}/`, sourceDir],
        packageRoot,
      )
    } catch {
      // Fallback to cp if rsync not available
      await runCommand('cp', ['-r', liefUpstream, sourceDir], packageRoot)
      // Remove .git if it was copied
      const gitDir = path.join(sourceDir, '.git')
      if (existsSync(gitDir)) {
        await safeDelete(gitDir)
      }
    }
  }

  logger.success('LIEF source copied')
}

/**
 * Apply Socket patches to LIEF source.
 * Patches are applied in order from patches/lief/*.patch
 * Uses `patch -p1` command (doesn't require git).
 * @param {string} sourceDir - Path to LIEF source directory
 */
async function applyLiefPatches(sourceDir) {
  const patchesDir = path.join(packageRoot, 'patches', 'lief')

  if (!existsSync(patchesDir)) {
    logger.info('No LIEF patches directory found, skipping patch application')
    return
  }

  const patches = readdirSync(patchesDir)
    .filter(f => f.endsWith('.patch'))
    .sort()

  if (patches.length === 0) {
    logger.info('No LIEF patches found')
    return
  }

  logger.info(`Applying ${patches.length} LIEF patch(es)...`)

  /* eslint-disable no-await-in-loop */
  for (const patchFile of patches) {
    const patchPath = path.join(patchesDir, patchFile)
    logger.info(`  Applying ${patchFile}...`)

    try {
      // Check if patch is already applied (--dry-run with -R checks reverse)
      const checkResult = await spawn(
        'patch',
        ['-p1', '--dry-run', '-R', '-i', patchPath],
        { cwd: sourceDir, stdio: 'pipe' },
      )
      if (checkResult.code === 0) {
        logger.info('    Already applied, skipping')
        continue
      }
    } catch {
      // Patch not applied, continue to apply it
    }

    try {
      // Apply the patch using patch -p1 (doesn't require git)
      await runCommand('patch', ['-p1', '-i', patchPath], sourceDir)
      logger.info('    Applied successfully')
    } catch (error) {
      throw new Error(`Failed to apply patch ${patchFile}: ${error.message}`)
    }
  }
  /* eslint-enable no-await-in-loop */

  logger.success('All LIEF patches applied')
}

/**
 * Download prebuilt LIEF from GitHub releases.
 *
 * @param {object} [options] - Download options.
 * @param {string} [options.platformArch] - Override platform-arch.
 * @returns {Promise<string|null>} Path to downloaded LIEF directory, or null on failure.
 */
async function downloadPrebuiltLIEF(options = {}) {
  // Check if download is blocked by BUILD_DEPS_FROM_SOURCE environment flag.
  checkBuildSourceFlag('LIEF', 'DEPS', {
    buildCommand: 'Install LIEF system-wide or build from source',
  })

  const { platformArch } = options
  const resolvedPlatformArch = platformArch ?? getCurrentLiefPlatformArch()

  try {
    logger.info('Checking for prebuilt LIEF releases...')

    const assetName = `lief-${resolvedPlatformArch}.tar.gz`
    const targetDir = getDownloadedLiefDir(resolvedPlatformArch)

    // Create download directory.
    await safeMkdir(targetDir)

    // Download archive using socket-btm release helper.
    logger.info(`Downloading ${assetName}...`)

    await downloadSocketBtmRelease({
      asset: assetName,
      downloadDir: targetDir,
      output: assetName,
      tool: 'lief',
    })

    // Extract archive.
    logger.info('Extracting LIEF archive...')

    // downloadSocketBtmRelease creates subdirectories (lief/assets/)
    const downloadedArchive = path.join(targetDir, 'lief', 'assets', assetName)

    // Verify archive exists before extraction.
    if (!existsSync(downloadedArchive)) {
      throw new Error(
        `Downloaded archive not found at expected path: ${downloadedArchive}`,
      )
    }

    // Extract using cross-platform tarball utility (handles Windows path conversion).
    // Release tarballs are already flat - no top-level directory to strip.
    try {
      await extractTarball(downloadedArchive, targetDir, {
        createDir: false,
        stdio: 'inherit',
        validate: true,
      })
    } catch (error) {
      throw new Error(
        `Failed to extract LIEF archive from ${downloadedArchive}: ${error.message}`,
      )
    }

    // Clean up archive subdirectory after extraction.
    await safeDelete(path.join(targetDir, 'lief'))

    // Verify library file exists after extraction.
    const extractedLibPath = getLiefLibPathAt(targetDir)
    if (!extractedLibPath) {
      const dirContents = readdirSync(targetDir)
      throw new Error(
        `LIEF library not found after extraction in ${targetDir}. ` +
          `Directory contains: ${dirContents.join(', ')}`,
      )
    }

    // Verify the downloaded library is compatible with musl if running on musl.
    if (extractedLibPath.endsWith('libLIEF.a')) {
      const compatibility = await verifyMuslCompatibility(extractedLibPath)
      if (!compatibility.compatible) {
        logger.info(
          `Prebuilt LIEF is not compatible with musl: ${compatibility.reason}`,
        )
        logger.info('Will need to build from source for musl compatibility')
        // Clean up the incompatible download.
        await safeDelete(targetDir)
        return null
      }
    }

    logger.success('Successfully downloaded and extracted prebuilt LIEF')
    return targetDir
  } catch (e) {
    logger.info(
      `Failed to download prebuilt LIEF: ${e?.message || 'Unknown error'}`,
    )
    return null
  }
}

/**
 * Ensure LIEF library is available.
 * Checks local build first, then downloaded, then downloads if needed.
 *
 * @param {object} [options] - Options.
 * @param {boolean} [options.force] - Force redownload even if LIEF exists.
 * @param {string} [options.buildMode] - Override build mode.
 * @param {string} [options.platformArch] - Override platform-arch for downloads.
 * @returns {Promise<string>} Path to LIEF library.
 */
export async function ensureLief(options = {}) {
  const { buildMode, force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? getCurrentLiefPlatformArch()

  // 1. Check local build first.
  const localDir = getLocalLiefDir(buildMode)
  const localLibPath = getLiefLibPathAt(localDir)
  if (!force && localLibPath) {
    logger.info(`Using local LIEF at ${localLibPath}`)
    return localLibPath
  }

  // 2. Check downloaded version.
  const downloadedDir = getDownloadedLiefDir(resolvedPlatformArch)
  const downloadedLibPath = getLiefLibPathAt(downloadedDir)
  if (!force && downloadedLibPath) {
    logger.info(`Using downloaded LIEF at ${downloadedLibPath}`)
    return downloadedLibPath
  }

  // 3. Download prebuilt LIEF.
  logger.info('LIEF not found locally, downloading prebuilt...')
  const downloadDir = await downloadPrebuiltLIEF({
    platformArch: resolvedPlatformArch,
  })
  if (downloadDir) {
    const newLibPath = getLiefLibPathAt(downloadDir)
    if (newLibPath) {
      return newLibPath
    }
  }

  throw new Error(
    'Failed to ensure LIEF. Run: git submodule update --init --recursive packages/bin-infra/upstream/lief',
  )
}

async function main() {
  try {
    // Check if LIEF exists in any location (local or downloaded).
    const localDir = getLocalLiefDir()
    const platformArch = getCurrentLiefPlatformArch()
    const downloadedDir = getDownloadedLiefDir(platformArch)

    const localLibPath = getLiefLibPathAt(localDir)
    const downloadedLibPath = getLiefLibPathAt(downloadedDir)
    const liefLibPath = localLibPath ?? downloadedLibPath
    const liefAvailable = liefLibPath !== null

    // Check if LIEF is already built.
    const forceRebuild = process.argv.includes('--force')
    const checkpointExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.LIEF_BUILT,
      forceRebuild,
    ))

    // Validate checkpoint: both checkpoint file AND library file must exist.
    if (checkpointExists && liefAvailable) {
      logger.success('LIEF already built (checkpoint exists)')
      return
    }

    // If checkpoint exists but library is missing, invalidate and rebuild.
    if (checkpointExists && !liefAvailable) {
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
      const downloadDir = await downloadPrebuiltLIEF({ platformArch })
      if (downloadDir) {
        // Verify library exists after download.
        const liefLibPathNew = getLiefLibPathAt(downloadDir)

        if (liefLibPathNew) {
          const stats = await fs.stat(liefLibPathNew)
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

          await createCheckpoint(
            buildDir,
            CHECKPOINTS.LIEF_BUILT,
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
                downloadDir,
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
              artifactPath: downloadDir,
              buildDir: path.relative(packageRoot, downloadDir),
              libPath: path.relative(buildDir, liefLibPathNew),
              libSize: stats.size,
              libSizeMB: sizeMB,
              version: LIEF_VERSION,
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

    // Copy LIEF source from upstream to build directory.
    // This allows patching without modifying the git submodule.
    await copyLiefSource(liefPatchedDir)
    logger.info('LIEF source ready')

    // Apply Socket patches to LIEF source (e.g., remove 1MB note size limit).
    await applyLiefPatches(liefPatchedDir)

    // Create build directory.
    await safeMkdir(liefBuildDir)

    // Configure LIEF with CMake.
    logger.info('Configuring LIEF with CMake...')
    const cmakeArgs = [
      liefPatchedDir,
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
      // Support cross-compilation via TARGET_ARCH environment variable.
      const targetArch = process.env.TARGET_ARCH
      const isCrossCompileArm64 =
        targetArch === 'arm64' || targetArch === 'aarch64'

      // Use cross-compiler for ARM64, native gcc for x64.
      const cc = isCrossCompileArm64 ? 'aarch64-w64-mingw32-gcc' : 'gcc'
      const cxx = isCrossCompileArm64 ? 'aarch64-w64-mingw32-g++' : 'g++'

      cmakeArgs.push(`-DCMAKE_C_COMPILER=${cc}`, `-DCMAKE_CXX_COMPILER=${cxx}`)

      // Use MinGW Makefiles generator for MinGW toolchain
      cmakeArgs.push('-G', 'MinGW Makefiles')

      if (isCrossCompileArm64) {
        // Set target system for CMake cross-compilation.
        cmakeArgs.push('-DCMAKE_SYSTEM_NAME=Windows')
        cmakeArgs.push('-DCMAKE_SYSTEM_PROCESSOR=aarch64')
        logger.info(
          'Building LIEF with aarch64-w64-mingw32-gcc for ARM64 cross-compilation',
        )
      } else {
        logger.info('Building LIEF with gcc/g++ using MinGW Makefiles')
      }
    }

    // On musl, disable fortify source to avoid glibc-specific fortify functions.
    // musl libc does not provide __*_chk functions (e.g., __snprintf_chk, __memcpy_chk).
    // This prevents linking errors when binject (built on musl) tries to link LIEF.
    // Use -U to undefine first in case it's set elsewhere, then define as 0.
    // The -Wp,-U_FORTIFY_SOURCE passes -U directly to the preprocessor (more reliable).
    const muslLibc = await isMusl()
    if (muslLibc) {
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
    const muslFortifyFlags = muslLibc
      ? '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
      : undefined
    const cleanEnv = {
      // Set LIEF version explicitly for CMake (LIEF's CMakeLists.txt reads this).
      // Required because shallow git clones can't determine version from git tags.
      LIEF_VERSION_ENV: LIEF_VERSION,
      CFLAGS: muslFortifyFlags,
      CXXFLAGS: muslFortifyFlags,
      // CPPFLAGS is specifically for the C PreProcessor - belt and suspenders approach.
      CPPFLAGS: muslLibc ? '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0' : undefined,
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
    if (muslLibc) {
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

      /* eslint-disable no-await-in-loop */
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
      /* eslint-enable no-await-in-loop */
    }

    await copyUpstreamHeaders(upstreamIncludeDir, buildIncludeDir)
    logger.success('Upstream headers copied to build directory')
    logger.info('')

    // Create checkpoint.
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.LIEF_BUILT,
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
  } catch (e) {
    logger.info('')
    logger.fail(`LIEF build failed: ${e?.message || 'Unknown error'}`)
    throw e
  }
}

// Run main only when executed directly (not when imported).
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('build-lief.mjs')

if (isMainModule) {
  main()
}
