/**
 * Build script for libcurl with mbedTLS.
 * Downloads prebuilt libcurl from GitHub releases or builds from source.
 *
 * This builds a minimal static libcurl with HTTPS support only, using
 * mbedTLS as the TLS backend for embedded use in self-extracting stubs.
 */

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkBuildSourceFlag } from 'build-infra/lib/build-env'
import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'
import {
  BUILD_STAGES,
  CHECKPOINTS,
  CHECKPOINT_CHAINS,
  getBuildMode,
  getPlatformBuildDir,
  validateCheckpointChain,
} from 'build-infra/lib/constants'
import { logTransientErrorHelp } from 'build-infra/lib/github-error-utils'
import {
  getAssetPlatformArch,
  getCurrentPlatformArch,
  isMusl,
} from 'build-infra/lib/platform-mappings'
import { extractTarball } from 'build-infra/lib/tarball-utils'
import { getSubmoduleVersion } from 'build-infra/lib/version-helpers'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import {
  detectLibc,
  downloadSocketBtmRelease,
} from '@socketsecurity/lib/releases/socket-btm'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Get checkpoint chain for CI workflows.
 * @returns {string[]} Checkpoint chain in reverse dependency order
 */
export function getCheckpointChain() {
  const chain = CHECKPOINT_CHAINS.curl()
  validateCheckpointChain(chain, 'curl-builder')
  return chain
}

// curl and mbedTLS are built in curl-builder.
// The stubs-builder Makefiles reference curl-builder's build output.
const packageRoot = path.join(__dirname, '..')

const curlUpstream = path.join(packageRoot, 'upstream', 'curl')
const mbedtlsUpstream = path.join(packageRoot, 'upstream', 'mbedtls')

const CROSS_COMPILE = process.env.CROSS_COMPILE === '1'
const TARGET_ARCH = process.env.TARGET_ARCH || process.arch

/**
 * Get build directories for a given platform-arch.
 *
 * @param {string} platformArch - Platform-arch identifier.
 * @returns {{ buildDir: string, curlBuildDir: string, mbedtlsBuildDir: string }}
 */
function getBuildDirs(platformArch) {
  const buildDir = getPlatformBuildDir(packageRoot, platformArch)
  const curlBuildDir = path.join(buildDir, 'out', BUILD_STAGES.FINAL, 'curl')
  const mbedtlsBuildDir = path.join(
    buildDir,
    'out',
    BUILD_STAGES.FINAL,
    'mbedtls',
  )
  return { buildDir, curlBuildDir, mbedtlsBuildDir }
}

/**
 * Required curl library files.
 */
const CURL_REQUIRED_FILES = [
  'libcurl.a',
  'libmbedtls.a',
  'libmbedx509.a',
  'libmbedcrypto.a',
]

/**
 * Check if curl libraries exist at a given directory.
 *
 * @param {string} dir - Directory to check.
 * @returns {boolean} True if all required files exist.
 */
export function curlExistsAt(dir) {
  return CURL_REQUIRED_FILES.every(file => existsSync(path.join(dir, file)))
}

/**
 * Download curl from GitHub releases to downloaded directory.
 *
 * @param {object} [options] - Download options.
 * @param {boolean} [options.force] - Force redownload even if cached.
 * @param {string} [options.platformArch] - Override platform-arch.
 * @returns {Promise<string>} Path to downloaded curl directory.
 */
export async function downloadCurl(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? (await getCurrentPlatformArch())

  // Check if download is blocked by BUILD_DEPS_FROM_SOURCE environment flag.
  checkBuildSourceFlag('curl', 'DEPS', {
    buildCommand: 'node scripts/build.mjs',
  })

  // downloadSocketBtmRelease extracts to downloadDir, add /curl/ subdirectory
  const targetDir = path.join(
    packageRoot,
    'build',
    'downloaded',
    'curl',
    resolvedPlatformArch,
    'curl',
  )
  const versionFile = path.join(targetDir, '.version')
  const assetName = `curl-${resolvedPlatformArch}.tar.gz`

  // Check if already downloaded (unless force).
  if (!force && existsSync(versionFile) && curlExistsAt(targetDir)) {
    const cachedVersion = (await fs.readFile(versionFile, 'utf8')).trim()
    logger.info(
      `Using cached curl ${cachedVersion} for ${resolvedPlatformArch}`,
    )
    return targetDir
  }

  logger.info(`Downloading curl for ${resolvedPlatformArch}...`)

  // Create target directory.
  await safeMkdir(targetDir)

  // Download archive using socket-btm release helper.
  // Note: httpDownload in @socketsecurity/lib now deletes existing files before
  // downloading to prevent partial/corrupted file issues from CI caching.
  const downloadedArchive = await downloadSocketBtmRelease('curl', {
    asset: assetName,
    downloadDir: targetDir,
  })

  // Extract archive to the same directory as the downloaded archive
  const extractDir = path.dirname(downloadedArchive)
  logger.info('Extracting curl archive...')

  // Verify archive exists before extraction.
  if (!existsSync(downloadedArchive)) {
    throw new Error(
      `Downloaded archive not found at expected path: ${downloadedArchive}`,
    )
  }

  // Verify tarball integrity before extraction (detect corrupted/truncated downloads).
  const archiveStats = await fs.stat(downloadedArchive)
  logger.info(
    `Archive size: ${(archiveStats.size / 1024 / 1024).toFixed(2)} MB`,
  )

  // Check gzip magic bytes (0x1f 0x8b) to verify it's a valid gzip file.
  const gzipMagic = Buffer.alloc(2)
  const fd = await fs.open(downloadedArchive, 'r')
  try {
    await fd.read(gzipMagic, 0, 2, 0)
  } finally {
    await fd.close()
  }

  if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
    // Delete corrupted archive and version file so next run will re-download.
    await safeDelete(downloadedArchive)
    if (existsSync(versionFile)) {
      await safeDelete(versionFile)
    }
    throw new Error(
      'Downloaded archive is not a valid gzip file (missing magic bytes). ' +
        `File may be corrupted or truncated. Deleted ${downloadedArchive} to force re-download.`,
    )
  }

  // Clean extraction directory to prevent "File exists" errors from cached layers.
  // This handles cases where Docker cached a partial extraction before failure.
  const curlIncludeDir = path.join(extractDir, 'include')
  const curlLibDir = path.join(extractDir, 'lib')
  const curlBinDir = path.join(extractDir, 'bin')
  if (existsSync(curlIncludeDir)) {
    await safeDelete(curlIncludeDir)
  }
  if (existsSync(curlLibDir)) {
    await safeDelete(curlLibDir)
  }
  if (existsSync(curlBinDir)) {
    await safeDelete(curlBinDir)
  }

  // Extract using cross-platform tarball utility (handles Windows path conversion).
  // Files are at root level in tarball (no dist/ directory).
  try {
    await extractTarball(downloadedArchive, extractDir, {
      createDir: false,
      stdio: 'inherit',
      stripComponents: 0,
      validate: true,
    })
  } catch (error) {
    // On extraction failure, delete the corrupted archive to allow re-download.
    await safeDelete(downloadedArchive)
    if (existsSync(versionFile)) {
      await safeDelete(versionFile)
    }
    throw new Error(
      `Failed to extract curl archive from ${downloadedArchive}: ${error.message}. ` +
        'Deleted corrupted archive to allow re-download on next run.',
      { cause: error },
    )
  }

  // Verify expected files exist after extraction.
  for (const file of CURL_REQUIRED_FILES) {
    if (!existsSync(path.join(extractDir, file))) {
      throw new Error(`Expected file not found after extraction: ${file}`)
    }
  }

  // Write version file after cleanup to ensure curl exists check passes.
  await fs.writeFile(versionFile, CURL_VERSION, 'utf8')

  const stats = await fs.stat(path.join(extractDir, 'libcurl.a'))
  const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
  logger.success(`Downloaded curl (${sizeMB} MB) to ${extractDir}`)

  return extractDir
}

/**
 * Ensure curl libraries are available.
 * Checks local build first, then downloaded, then downloads if needed.
 *
 * @param {object} [options] - Options.
 * @param {boolean} [options.force] - Force redownload even if cached.
 * @param {string} [options.platformArch] - Override platform-arch.
 * @returns {Promise<string>} Path to directory containing curl libraries.
 */
export async function ensureCurl(options = {}) {
  const { force = false, platformArch } = options
  const resolvedPlatformArch = platformArch ?? (await getCurrentPlatformArch())

  // 1. Check local build first (platform-specific directory).
  const { curlBuildDir } = getBuildDirs(resolvedPlatformArch)
  const localDir = path.join(curlBuildDir, 'dist')
  if (!force && curlExistsAt(localDir)) {
    logger.info(`Using local curl build at ${localDir}`)
    return localDir
  }

  // 2. Check downloaded version.
  // downloadSocketBtmRelease extracts to {downloadDir}/{platformArch}/curl/ subdirectory
  const downloadedDir = path.join(
    packageRoot,
    'build',
    'downloaded',
    'curl',
    resolvedPlatformArch,
    'curl',
  )
  if (!force && curlExistsAt(downloadedDir)) {
    logger.info(`Using downloaded curl at ${downloadedDir}`)
    return downloadedDir
  }

  // 3. Download curl.
  logger.info('curl not found locally, downloading...')
  return await downloadCurl({ force, platformArch: resolvedPlatformArch })
}

// Curl version (extracted from .gitmodules comment).
const CURL_VERSION = getCurlVersion()

// mbedTLS version (extracted from .gitmodules comment).
const MBEDTLS_VERSION = getMbedTLSVersion()

/**
 * Extract curl version from .gitmodules comment.
 * @returns {string} Curl version (e.g., "8.18.0")
 */
function getCurlVersion() {
  const version = getSubmoduleVersion(
    'packages/curl-builder/upstream/curl',
    'curl',
  )
  logger.info(`Detected curl version from .gitmodules: ${version}`)
  return version
}

/**
 * Extract mbedTLS version from .gitmodules comment.
 * @returns {string} mbedTLS version (e.g., "3.6.5")
 */
function getMbedTLSVersion() {
  const version = getSubmoduleVersion(
    'packages/curl-builder/upstream/mbedtls',
    'mbedtls',
  )
  logger.info(`Detected mbedTLS version from .gitmodules: ${version}`)
  return version
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
 * Build mbedTLS static library.
 *
 * @param {string} mbedtlsBuildDir - Directory to build mbedTLS in.
 */
async function buildMbedTLS(mbedtlsBuildDir) {
  logger.info('Building mbedTLS...')

  // Check if mbedTLS upstream exists.
  if (!existsSync(mbedtlsUpstream)) {
    throw new Error(
      `mbedTLS upstream not found at ${mbedtlsUpstream}. Run 'git submodule update --init --recursive' first.`,
    )
  }

  // Create build directory.
  await safeMkdir(mbedtlsBuildDir)

  // Configure mbedTLS with CMake.
  logger.info('Configuring mbedTLS with CMake...')
  const cmakeArgs = [
    mbedtlsUpstream,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DENABLE_PROGRAMS=OFF',
    '-DENABLE_TESTING=OFF',
    '-DUSE_SHARED_MBEDTLS_LIBRARY=OFF',
    '-DUSE_STATIC_MBEDTLS_LIBRARY=ON',
    // Disable features not needed for HTTPS.
    '-DMBEDTLS_FATAL_WARNINGS=OFF',
    // Enable Link-Time Optimization for 5-15% smaller binaries.
    '-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON',
  ]

  // Handle cross-compilation for different platforms.
  if (process.platform === 'darwin' && CROSS_COMPILE) {
    // macOS cross-compilation (e.g., building x64 on ARM64 runner).
    const osxArch = TARGET_ARCH === 'x64' ? 'x86_64' : 'arm64'
    cmakeArgs.push(`-DCMAKE_OSX_ARCHITECTURES=${osxArch}`)
    logger.info(`Cross-compiling mbedTLS for macOS ${osxArch}`)
  } else if (WIN32) {
    // On Windows, use MinGW for consistent ABI.
    if (CROSS_COMPILE && TARGET_ARCH === 'arm64') {
      // Windows ARM64 cross-compilation using llvm-mingw.
      cmakeArgs.push(
        '-DCMAKE_SYSTEM_NAME=Windows',
        '-DCMAKE_SYSTEM_PROCESSOR=aarch64',
        '-DCMAKE_C_COMPILER=aarch64-w64-mingw32-gcc',
        '-DCMAKE_CXX_COMPILER=aarch64-w64-mingw32-g++',
        '-DCMAKE_RC_COMPILER=aarch64-w64-mingw32-windres',
        '-G',
        'MinGW Makefiles',
      )
      logger.info(
        'Cross-compiling mbedTLS for ARM64 with llvm-mingw using MinGW Makefiles',
      )
    } else {
      cmakeArgs.push(
        '-DCMAKE_C_COMPILER=gcc',
        '-DCMAKE_CXX_COMPILER=g++',
        '-G',
        'MinGW Makefiles',
      )
      logger.info('Building mbedTLS with gcc/g++ using MinGW Makefiles')
    }
  }

  // On musl, disable fortify source.
  const cleanEnv = {}
  if (await isMusl()) {
    const fortifyDisableFlags =
      '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    cmakeArgs.push(
      `-DCMAKE_C_FLAGS=${fortifyDisableFlags}`,
      `-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG ${fortifyDisableFlags}`,
    )
    cleanEnv.CFLAGS = fortifyDisableFlags
    cleanEnv.CPPFLAGS = '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    logger.info('Disabling fortify source for musl libc compatibility')
  }

  await runCommand('cmake', cmakeArgs, mbedtlsBuildDir, cleanEnv)

  // Build mbedTLS with parallel compilation.
  // Use 90% of available CPUs for faster builds (CI environments can use full resources).
  const cpuCount = os.cpus().length
  const jobCount = Math.max(1, Math.floor(cpuCount * 0.9))
  logger.info(`Building mbedTLS with ${jobCount} parallel jobs...`)
  const buildStart = Date.now()
  await runCommand(
    'cmake',
    ['--build', '.', '--config', 'Release', `-j${jobCount}`],
    mbedtlsBuildDir,
    cleanEnv,
  )
  const buildDuration = Math.round((Date.now() - buildStart) / 1000)
  logger.info(`mbedTLS build completed in ${buildDuration}s`)

  // Verify libraries exist.
  const libDir = path.join(mbedtlsBuildDir, 'library')
  const libs = ['libmbedtls.a', 'libmbedx509.a', 'libmbedcrypto.a']
  for (const lib of libs) {
    const libPath = path.join(libDir, lib)
    if (!existsSync(libPath)) {
      throw new Error(`mbedTLS library not found: ${libPath}`)
    }
  }

  logger.success('mbedTLS build completed successfully!')
  return mbedtlsBuildDir
}

/**
 * Build curl static library with mbedTLS.
 *
 * @param {string} mbedtlsDir - Directory containing mbedTLS build.
 * @param {string} curlBuildDir - Directory to build curl in.
 */
async function buildCurl(mbedtlsDir, curlBuildDir) {
  logger.info('Building curl with mbedTLS...')

  // Check if curl upstream exists.
  if (!existsSync(curlUpstream)) {
    throw new Error(
      `curl upstream not found at ${curlUpstream}. Run 'git submodule update --init --recursive' first.`,
    )
  }

  // Create build directory.
  await safeMkdir(curlBuildDir)

  // Configure curl with CMake.
  logger.info('Configuring curl with CMake...')
  const mbedtlsIncludeDir = path.join(mbedtlsUpstream, 'include')
  const mbedtlsLibDir = path.join(mbedtlsDir, 'library')

  const cmakeArgs = [
    curlUpstream,
    '-DCMAKE_BUILD_TYPE=Release',
    // Build static library only.
    '-DBUILD_SHARED_LIBS=OFF',
    '-DBUILD_STATIC_LIBS=ON',
    '-DBUILD_CURL_EXE=OFF',
    // Use mbedTLS for TLS.
    '-DCURL_ENABLE_SSL=ON',
    '-DCURL_USE_MBEDTLS=ON',
    `-DMBEDTLS_INCLUDE_DIR=${mbedtlsIncludeDir}`,
    `-DMBEDTLS_LIBRARY=${path.join(mbedtlsLibDir, 'libmbedtls.a')}`,
    `-DMBEDX509_LIBRARY=${path.join(mbedtlsLibDir, 'libmbedx509.a')}`,
    `-DMBEDCRYPTO_LIBRARY=${path.join(mbedtlsLibDir, 'libmbedcrypto.a')}`,
    // Disable all other TLS backends.
    '-DCURL_USE_OPENSSL=OFF',
    '-DCURL_USE_GNUTLS=OFF',
    '-DCURL_USE_WOLFSSL=OFF',
    '-DCURL_USE_RUSTLS=OFF',
    // Disable optional compression and HTTP/2 features.
    '-DCURL_ZLIB=OFF',
    '-DCURL_BROTLI=OFF',
    '-DCURL_ZSTD=OFF',
    '-DUSE_NGHTTP2=OFF',
    '-DUSE_LIBIDN2=OFF',
    '-DCURL_USE_LIBPSL=OFF',
    '-DCURL_USE_LIBSSH2=OFF',
    '-DENABLE_IPV6=OFF',
    // Disable features not needed for simple HTTPS requests.
    '-DCURL_DISABLE_ALTSVC=ON',
    '-DCURL_DISABLE_COOKIES=ON',
    '-DCURL_DISABLE_DICT=ON',
    '-DCURL_DISABLE_DOH=ON',
    '-DCURL_DISABLE_FILE=ON',
    '-DCURL_DISABLE_FTP=ON',
    '-DCURL_DISABLE_GOPHER=ON',
    '-DCURL_DISABLE_HSTS=ON',
    '-DCURL_DISABLE_IMAP=ON',
    '-DCURL_DISABLE_LDAP=ON',
    '-DCURL_DISABLE_LDAPS=ON',
    '-DCURL_DISABLE_MQTT=ON',
    '-DCURL_DISABLE_NETRC=ON',
    '-DCURL_DISABLE_NTLM=ON',
    '-DCURL_DISABLE_POP3=ON',
    '-DCURL_DISABLE_PROXY=ON',
    '-DCURL_DISABLE_RTSP=ON',
    '-DCURL_DISABLE_SMB=ON',
    '-DCURL_DISABLE_SMTP=ON',
    '-DCURL_DISABLE_TELNET=ON',
    '-DCURL_DISABLE_TFTP=ON',
    '-DENABLE_ARES=OFF',
    '-DCURL_DISABLE_IPFS=ON',
    '-DCURL_DISABLE_WEBSOCKETS=ON',
    // Keep these enabled.
    '-DCURL_DISABLE_HTTP=OFF',
    // Disable installation targets.
    '-DCURL_DISABLE_INSTALL=ON',
    // Enable Link-Time Optimization for 5-15% smaller binaries.
    '-DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON',
  ]

  // Handle cross-compilation for different platforms.
  if (process.platform === 'darwin' && CROSS_COMPILE) {
    // macOS cross-compilation (e.g., building x64 on ARM64 runner).
    const osxArch = TARGET_ARCH === 'x64' ? 'x86_64' : 'arm64'
    cmakeArgs.push(`-DCMAKE_OSX_ARCHITECTURES=${osxArch}`)
    logger.info(`Cross-compiling curl for macOS ${osxArch}`)
  } else if (WIN32) {
    // On Windows, use MinGW for consistent ABI.
    if (CROSS_COMPILE && TARGET_ARCH === 'arm64') {
      // Windows ARM64 cross-compilation using llvm-mingw.
      cmakeArgs.push(
        '-DCMAKE_SYSTEM_NAME=Windows',
        '-DCMAKE_SYSTEM_PROCESSOR=aarch64',
        '-DCMAKE_C_COMPILER=aarch64-w64-mingw32-gcc',
        '-DCMAKE_CXX_COMPILER=aarch64-w64-mingw32-g++',
        '-DCMAKE_RC_COMPILER=aarch64-w64-mingw32-windres',
        '-G',
        'MinGW Makefiles',
      )
      logger.info(
        'Cross-compiling curl for ARM64 with llvm-mingw using MinGW Makefiles',
      )
    } else {
      cmakeArgs.push(
        '-DCMAKE_C_COMPILER=gcc',
        '-DCMAKE_CXX_COMPILER=g++',
        '-G',
        'MinGW Makefiles',
      )
      logger.info('Building curl with gcc/g++ using MinGW Makefiles')
    }
  }

  // On musl, disable fortify source.
  const cleanEnv = {}
  if (await isMusl()) {
    const fortifyDisableFlags =
      '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    cmakeArgs.push(
      `-DCMAKE_C_FLAGS=${fortifyDisableFlags}`,
      `-DCMAKE_C_FLAGS_RELEASE=-O3 -DNDEBUG ${fortifyDisableFlags}`,
    )
    cleanEnv.CFLAGS = fortifyDisableFlags
    cleanEnv.CPPFLAGS = '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    logger.info('Disabling fortify source for musl libc compatibility')
  }

  await runCommand('cmake', cmakeArgs, curlBuildDir, cleanEnv)

  // Build curl with parallel compilation.
  // Use 90% of available CPUs for faster builds (CI environments can use full resources).
  const cpuCount = os.cpus().length
  const jobCount = Math.max(1, Math.floor(cpuCount * 0.9))
  logger.info(`Building curl with ${jobCount} parallel jobs...`)
  const buildStart = Date.now()
  await runCommand(
    'cmake',
    ['--build', '.', '--config', 'Release', `-j${jobCount}`],
    curlBuildDir,
    cleanEnv,
  )
  const buildDuration = Math.round((Date.now() - buildStart) / 1000)
  logger.info(`curl build completed in ${buildDuration}s`)

  logger.success('curl build completed successfully!')
}

/**
 * Copy headers and libraries for distribution.
 *
 * @param {string} mbedtlsDir - Directory containing mbedTLS build.
 * @param {string} curlBuildDir - Directory containing curl build.
 */
async function copyDistributionFiles(mbedtlsDir, curlBuildDir) {
  const distDir = path.join(curlBuildDir, 'dist')
  await safeMkdir(distDir)

  // Copy curl library.
  const curlLibSrc = path.join(curlBuildDir, 'lib', 'libcurl.a')
  if (!existsSync(curlLibSrc)) {
    throw new Error(`curl library not found: ${curlLibSrc}`)
  }
  await fs.copyFile(curlLibSrc, path.join(distDir, 'libcurl.a'))

  // Copy mbedTLS libraries.
  const mbedtlsLibDir = path.join(mbedtlsDir, 'library')
  const mbedtlsResults = await Promise.allSettled(
    ['libmbedtls.a', 'libmbedx509.a', 'libmbedcrypto.a'].map(lib =>
      fs.copyFile(path.join(mbedtlsLibDir, lib), path.join(distDir, lib)),
    ),
  )
  const mbedtlsFailed = mbedtlsResults.filter(r => r.status === 'rejected')
  if (mbedtlsFailed.length > 0) {
    throw new Error(
      `Failed to copy ${mbedtlsFailed.length} mbedTLS libraries: ${mbedtlsFailed.map(r => r.reason?.message || r.reason).join(', ')}`,
    )
  }

  // Copy curl headers.
  const curlIncludeSrc = path.join(curlUpstream, 'include', 'curl')
  const curlIncludeDst = path.join(distDir, 'include', 'curl')
  await safeMkdir(curlIncludeDst)
  const headers = readdirSync(curlIncludeSrc).filter(f => f.endsWith('.h'))
  const headerResults = await Promise.allSettled(
    headers.map(header =>
      fs.copyFile(
        path.join(curlIncludeSrc, header),
        path.join(curlIncludeDst, header),
      ),
    ),
  )
  const headersFailed = headerResults.filter(r => r.status === 'rejected')
  if (headersFailed.length > 0) {
    throw new Error(
      `Failed to copy ${headersFailed.length} curl headers: ${headersFailed.map(r => r.reason?.message || r.reason).join(', ')}`,
    )
  }

  // Copy generated curl_config.h if it exists.
  const curlConfigSrc = path.join(curlBuildDir, 'lib', 'curl_config.h')
  if (existsSync(curlConfigSrc)) {
    await fs.copyFile(curlConfigSrc, path.join(curlIncludeDst, 'curl_config.h'))
  }

  logger.success(`Distribution files copied to ${distDir}`)
  return distDir
}

async function main() {
  try {
    // Use platform-specific build directory for complete isolation.
    const platformArch = await getCurrentPlatformArch()
    const { buildDir, curlBuildDir, mbedtlsBuildDir } = getBuildDirs(platformArch)

    // Determine which curl library file to check for.
    const curlLibPath = path.join(curlBuildDir, 'lib', 'libcurl.a')
    const curlDistPath = path.join(curlBuildDir, 'dist', 'libcurl.a')

    // Check if curl is already built (finalized checkpoint).
    const forceRebuild = process.argv.includes('--force')
    const finalizedExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.FINALIZED,
      forceRebuild,
    ))

    // Validate checkpoint: both checkpoint file AND library file must exist.
    if (
      finalizedExists &&
      (existsSync(curlLibPath) || existsSync(curlDistPath))
    ) {
      logger.success('curl already built (finalized checkpoint exists)')
      return
    }

    // If checkpoint exists but library is missing, invalidate and rebuild.
    if (
      finalizedExists &&
      !existsSync(curlLibPath) &&
      !existsSync(curlDistPath)
    ) {
      logger.info(
        'Checkpoint exists but curl library missing, rebuilding from scratch',
      )
    }

    logger.info('Building curl with mbedTLS for HTTPS support...\n')

    // Check if curl submodule is initialized.
    const curlCMakeLists = path.join(curlUpstream, 'CMakeLists.txt')
    const isCurlBuild = existsSync(curlCMakeLists)

    if (!isCurlBuild) {
      // Not building curl itself - ensure prebuilt is available.
      logger.info('curl submodule not initialized, using prebuilt...')
      const curlDir = await ensureCurl()
      const curlLib = path.join(curlDir, 'libcurl.a')
      const stats = await fs.stat(curlLib)
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2)

      await safeMkdir(buildDir)
      await createCheckpoint(
        buildDir,
        CHECKPOINTS.FINALIZED,
        async () => {
          // Verify library exists and has reasonable size.
          const libStats = await fs.stat(curlLib)
          if (libStats.size < 100_000) {
            throw new Error(
              `curl library too small: ${libStats.size} bytes (expected >100KB)`,
            )
          }
        },
        {
          artifactPath: curlDir,
          buildDir: path.relative(packageRoot, curlDir),
          checkpointChain: CHECKPOINT_CHAINS.curl(),
          libPath: path.relative(buildDir, curlLib),
          libSize: stats.size,
          libSizeMB: sizeMB,
          mbedtlsVersion: MBEDTLS_VERSION,
          platformArch,
          version: CURL_VERSION,
        },
      )
      return
    }

    // Check if mbedTLS submodule is initialized.
    const mbedtlsCMakeLists = path.join(mbedtlsUpstream, 'CMakeLists.txt')
    if (!existsSync(mbedtlsCMakeLists)) {
      throw new Error(
        `mbedTLS submodule not initialized at ${mbedtlsUpstream}. Run: git submodule update --init --recursive packages/curl-builder/upstream/mbedtls`,
      )
    }

    logger.info(
      `Building curl ${CURL_VERSION} with mbedTLS ${MBEDTLS_VERSION} on ${process.platform}`,
    )

    // Create build directory.
    await safeMkdir(buildDir)

    // Check if mbedtls checkpoint exists.
    const mbedtlsCheckpointExists = !(await shouldRun(
      buildDir,
      '',
      CHECKPOINTS.MBEDTLS_BUILT,
      forceRebuild,
    ))

    let mbedtlsDir
    const mbedtlsLibDir = path.join(mbedtlsBuildDir, 'library')
    const mbedtlsLibPath = path.join(mbedtlsLibDir, 'libmbedtls.a')

    if (mbedtlsCheckpointExists && existsSync(mbedtlsLibPath)) {
      logger.success('mbedTLS already built (checkpoint exists)')
      mbedtlsDir = mbedtlsBuildDir
    } else {
      // Build mbedTLS first.
      mbedtlsDir = await buildMbedTLS(mbedtlsBuildDir)

      // Create mbedtls checkpoint.
      const mbedtlsStats = await fs.stat(mbedtlsLibPath)
      await createCheckpoint(
        buildDir,
        CHECKPOINTS.MBEDTLS_BUILT,
        async () => {
          // Verify all mbedTLS libraries exist.
          const libs = ['libmbedtls.a', 'libmbedx509.a', 'libmbedcrypto.a']
          for (const lib of libs) {
            const libPath = path.join(mbedtlsLibDir, lib)
            if (!existsSync(libPath)) {
              throw new Error(`mbedTLS library not found: ${libPath}`)
            }
          }
        },
        {
          buildDir: path.relative(packageRoot, mbedtlsBuildDir),
          checkpointChain: CHECKPOINT_CHAINS.curl(),
          libPath: path.relative(buildDir, mbedtlsLibPath),
          libSize: mbedtlsStats.size,
          platformArch,
          version: MBEDTLS_VERSION,
        },
      )
    }

    // Build curl with mbedTLS.
    await buildCurl(mbedtlsDir, curlBuildDir)

    // Copy distribution files.
    const distDir = await copyDistributionFiles(mbedtlsDir, curlBuildDir)

    // Verify library exists.
    const libPath = path.join(distDir, 'libcurl.a')
    if (!existsSync(libPath)) {
      throw new Error(`curl library not found at ${libPath}`)
    }

    const stats = await fs.stat(libPath)
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2)
    logger.info(`curl library size: ${sizeMB} MB`)

    // Create finalized checkpoint.
    await createCheckpoint(
      buildDir,
      CHECKPOINTS.FINALIZED,
      async () => {
        // Verify library exists and has reasonable size.
        const libStats = await fs.stat(libPath)
        if (libStats.size < 100_000) {
          throw new Error(
            `curl library too small: ${libStats.size} bytes (expected >100KB)`,
          )
        }

        // Verify curl headers were copied.
        const curlHeader = path.join(distDir, 'include', 'curl', 'curl.h')
        if (!existsSync(curlHeader)) {
          throw new Error(`curl headers not found at ${curlHeader}`)
        }
      },
      {
        artifactPath: distDir,
        buildDir: path.relative(packageRoot, curlBuildDir),
        checkpointChain: CHECKPOINT_CHAINS.curl(),
        libPath: path.relative(buildDir, libPath),
        libSize: stats.size,
        libSizeMB: sizeMB,
        mbedtlsVersion: MBEDTLS_VERSION,
        platformArch,
        version: CURL_VERSION,
      },
    )
  } catch (error) {
    logger.log('')
    logger.fail(`curl build failed: ${error?.message || 'Unknown error'}`)
    await logTransientErrorHelp(error)
    throw error
  }
}

// Run main only when executed directly (not when imported).
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('build.mjs')

if (isMainModule) {
  main().catch(error => {
    logger.error('Error building curl:', error)
    process.exitCode = 1
  })
}
