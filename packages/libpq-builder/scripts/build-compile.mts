/**
 * Build script for libpq — compile and package functions.
 *
 * Runs PostgreSQL configure, compiles libpq static library, and copies
 * distribution headers/libs. Split from build.mts to keep each file
 * under the 500-line soft cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { appendCCRemapFlags } from 'build-infra/lib/path-remap-flags'
import { isMusl } from 'build-infra/lib/platform-mappings'
import { errorMessage } from 'build-infra/lib/error-utils'

import { safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  CROSS_COMPILE,
  logger,
  packageRoot,
  postgresUpstream,
  TARGET_ARCH,
} from './build-download.mts'

/**
 * Run a shell command and throw on non-zero exit.
 *
 * @param {string} command - Command to run.
 * @param {string[]} args - Arguments.
 * @param {string} cwd - Working directory.
 * @param {object} env - Extra environment variables.
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export async function runCommand(command, args, cwd, env = {}) {
  logger.info(`Running: ${command} ${args.join(' ')}`)

  // Merge env properly, filtering out undefined values.
  const mergedEnv = { ...process.env }
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
    throw new Error(`Command failed to spawn: ${errorMessage(result.error)}`)
  }

  if (result.signal) {
    throw new Error(`Command terminated by signal: ${result.signal}`)
  }

  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}`)
  }
}

/**
 * Get OpenSSL paths from node-smol-builder upstream.
 * Node.js bundles OpenSSL in deps/openssl.
 *
 * @returns {{ includeDir: string; libDir: string }} OpenSSL paths
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export function getNodeOpenSSLPaths() {
  // Node.js OpenSSL is in node-smol-builder's upstream
  const nodeUpstream = path.join(
    packageRoot,
    '..',
    'node-smol-builder',
    'upstream',
    'node',
  )
  const opensslInclude = path.join(
    nodeUpstream,
    'deps',
    'openssl',
    'openssl',
    'include',
  )
  const opensslLib = path.join(nodeUpstream, 'deps', 'openssl', 'openssl')

  return {
    includeDir: opensslInclude,
    libDir: opensslLib,
  }
}

/**
 * Resolve OpenSSL paths for linking libpq. Configure needs a directory
 * that has BOTH `libcrypto.a|dylib|so` AND headers — node-smol's bundled
 * OpenSSL only has built libs after node-smol itself has been built, so
 * we fall back to system OpenSSL (homebrew / apt) when the node-smol
 * tree doesn't carry built libs yet. Returns undefined when nothing
 * works so configure can auto-probe.
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export function getOpenSSLPaths() {
  const candidates = []
  candidates.push(getNodeOpenSSLPaths())
  if (process.platform === 'darwin') {
    candidates.push(
      {
        includeDir: '/opt/homebrew/opt/openssl@3/include',
        libDir: '/opt/homebrew/opt/openssl@3/lib',
      },
      {
        includeDir: '/usr/local/opt/openssl@3/include',
        libDir: '/usr/local/opt/openssl@3/lib',
      },
    )
  } else if (process.platform === 'linux') {
    candidates.push(
      {
        includeDir: '/usr/include/openssl',
        libDir: '/usr/lib/x86_64-linux-gnu',
      },
      {
        includeDir: '/usr/include/openssl',
        libDir: '/usr/lib/aarch64-linux-gnu',
      },
      { includeDir: '/usr/include/openssl', libDir: '/usr/lib' },
    )
  }
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const cand = candidates[i]
    if (!existsSync(cand.includeDir)) {
      continue
    }
    const hasBuiltCrypto =
      existsSync(path.join(cand.libDir, 'libcrypto.a')) ||
      existsSync(path.join(cand.libDir, 'libcrypto.dylib')) ||
      existsSync(path.join(cand.libDir, 'libcrypto.so'))
    if (hasBuiltCrypto) {
      return cand
    }
  }
  return undefined
}

/**
 * Build libpq static library from PostgreSQL source.
 *
 * @param {string} libpqBuildDir - Directory to build libpq in.
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export async function buildLibpq(libpqBuildDir) {
  logger.info('Building libpq from PostgreSQL source…')

  // Check if PostgreSQL upstream exists.
  if (!existsSync(postgresUpstream)) {
    throw new Error(
      `PostgreSQL upstream not found at ${postgresUpstream}. Run 'git submodule update --init --recursive' first.`,
    )
  }

  // Create build directory.
  await safeMkdir(libpqBuildDir)

  // Prefer node-smol-builder's bundled OpenSSL (matches the version
  // node-smol itself builds against), but fall back to system OpenSSL
  // when node-smol hasn't built libcrypto.* yet — configure needs
  // BUILT libs, not just headers.
  const opensslPaths = getOpenSSLPaths()
  if (!opensslPaths) {
    logger.warn(
      'No built OpenSSL found under node-smol-builder upstream or system ' +
        '(homebrew/apt); letting PostgreSQL configure auto-detect. ' +
        'Install with: brew install openssl@3 (macOS) or ' +
        'sudo apt install libssl-dev (Linux).',
    )
  }

  // Configure PostgreSQL for client-only build.
  // PostgreSQL uses autotools (configure), not CMake.
  logger.info('Configuring PostgreSQL for libpq-only build…')

  const configureArgs = [
    // Only build client libraries (libpq)
    '--without-server',
    // Disable readline for minimal build
    '--without-readline',
    // Disable ICU — libpq client has no ICU dependency, and PG 17
    // defaults to USE_ICU=1 which requires icu-uc/icu-i18n via
    // pkg-config on the host. node-smol builds with small-icu bundled,
    // so matching "no external ICU" intent keeps libpq client portable.
    '--without-icu',
    // Use OpenSSL for TLS
    '--with-openssl',
    // Install prefix
    `--prefix=${libpqBuildDir}/dist`,
  ]

  if (opensslPaths) {
    configureArgs.push(`--with-includes=${opensslPaths.includeDir}`)
    configureArgs.push(`--with-libraries=${opensslPaths.libDir}`)
  }

  // Handle cross-compilation
  if (process.platform === 'darwin' && CROSS_COMPILE) {
    const targetTriple =
      TARGET_ARCH === 'x64' ? 'x86_64-apple-darwin' : 'aarch64-apple-darwin'
    configureArgs.push(`--host=${targetTriple}`)
    logger.info(`Cross-compiling libpq for ${targetTriple}`)
  }

  // On musl, disable fortify source.
  const cleanEnv = {}
  if (await isMusl()) {
    const fortifyDisableFlags =
      '-Wp,-U_FORTIFY_SOURCE -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    cleanEnv.CFLAGS = fortifyDisableFlags
    cleanEnv.CPPFLAGS = '-U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=0'
    logger.info('Disabling fortify source for musl libc compatibility')
  }
  // Anonymize absolute build-host paths (DWARF + __FILE__) so libpq.a doesn't
  // leak the dev's home dir or the dev's home dir strings into node-smol's
  // node:smol-sql linkage. PostgreSQL is __FILE__-heavy in its assertion and
  // ereport machinery.
  cleanEnv.CFLAGS = appendCCRemapFlags(cleanEnv.CFLAGS)
  cleanEnv.CXXFLAGS = appendCCRemapFlags(cleanEnv.CXXFLAGS)

  // Run configure from the upstream directory
  await runCommand(
    path.join(postgresUpstream, 'configure'),
    configureArgs,
    libpqBuildDir,
    cleanEnv,
  )

  // Build only the interfaces/libpq directory
  // PostgreSQL Makefile supports building specific subdirectories
  const cpuCount = os.cpus().length
  const jobCount = Math.max(1, Math.floor(cpuCount * 0.9))
  logger.info(`Building libpq with ${jobCount} parallel jobs…`)

  const buildStart = Date.now()

  // PostgreSQL's subtree Makefiles reference headers generated by perl
  // scripts under src/backend (e.g. utils/errcodes.h produced from
  // errcodes.txt). When we jump straight into `src/common` with -j12
  // the race against the unrun codegen fails with
  //   fatal error: 'utils/errcodes.h' file not found
  // So we pre-run the generated-headers target serially, THEN let the
  // subtree builds fan out in parallel. This is a build-driver ordering
  // change and does not touch upstream sources.
  await runCommand(
    'make',
    ['-C', 'src/backend', 'generated-headers'],
    libpqBuildDir,
    cleanEnv,
  )

  // First build common dependencies
  await runCommand(
    'make',
    [`-j${jobCount}`, '-C', 'src/common'],
    libpqBuildDir,
    cleanEnv,
  )

  // Build port utilities
  await runCommand(
    'make',
    [`-j${jobCount}`, '-C', 'src/port'],
    libpqBuildDir,
    cleanEnv,
  )

  // Build libpq
  await runCommand(
    'make',
    [`-j${jobCount}`, '-C', 'src/interfaces/libpq'],
    libpqBuildDir,
    cleanEnv,
  )

  const buildDuration = Math.round((Date.now() - buildStart) / 1000)
  logger.info(`libpq build completed in ${buildDuration}s`)

  logger.success('libpq build completed successfully!')
}

/**
 * Copy headers and libraries for distribution.
 *
 * @param {string} libpqBuildDir - Directory containing libpq build.
 */
// oxlint-disable-next-line socket/sort-source-methods -- build script is ordered as a top-down pipeline (download → extract → configure → build → install → smoke test); alphabetizing across pipeline phases would scatter the flow and break the checkpoint reading order.
export async function copyDistributionFiles(libpqBuildDir) {
  const distDir = path.join(libpqBuildDir, 'dist')
  await safeMkdir(distDir)
  await safeMkdir(path.join(distDir, 'include'))

  // Copy libpq static library
  const libpqSrc = path.join(
    libpqBuildDir,
    'src',
    'interfaces',
    'libpq',
    'libpq.a',
  )
  if (!existsSync(libpqSrc)) {
    throw new Error(`libpq library not found: ${libpqSrc}`)
  }
  await fs.copyFile(libpqSrc, path.join(distDir, 'libpq.a'))

  // Copy common library (needed for linking)
  const commonLibSrc = path.join(
    libpqBuildDir,
    'src',
    'common',
    'libpgcommon.a',
  )
  if (existsSync(commonLibSrc)) {
    await fs.copyFile(commonLibSrc, path.join(distDir, 'libpgcommon.a'))
  }

  // Copy port library (needed for linking)
  const portLibSrc = path.join(libpqBuildDir, 'src', 'port', 'libpgport.a')
  if (existsSync(portLibSrc)) {
    await fs.copyFile(portLibSrc, path.join(distDir, 'libpgport.a'))
  }

  // Copy libpq headers from upstream
  const headersSrc = path.join(postgresUpstream, 'src', 'interfaces', 'libpq')
  const headersDst = path.join(distDir, 'include')

  // Copy libpq-fe.h (main header)
  const libpqFeHeader = path.join(headersSrc, 'libpq-fe.h')
  if (existsSync(libpqFeHeader)) {
    await fs.copyFile(libpqFeHeader, path.join(headersDst, 'libpq-fe.h'))
  }

  // Copy postgres_ext.h from include directory
  const postgresExtHeader = path.join(
    postgresUpstream,
    'src',
    'include',
    'postgres_ext.h',
  )
  if (existsSync(postgresExtHeader)) {
    await fs.copyFile(
      postgresExtHeader,
      path.join(headersDst, 'postgres_ext.h'),
    )
  }

  // Copy pg_config.h from build directory (generated by configure)
  const pgConfigHeader = path.join(
    libpqBuildDir,
    'src',
    'include',
    'pg_config.h',
  )
  if (existsSync(pgConfigHeader)) {
    await fs.copyFile(pgConfigHeader, path.join(headersDst, 'pg_config.h'))
  }

  // Copy pg_config_ext.h
  const pgConfigExtHeader = path.join(
    libpqBuildDir,
    'src',
    'include',
    'pg_config_ext.h',
  )
  if (existsSync(pgConfigExtHeader)) {
    await fs.copyFile(
      pgConfigExtHeader,
      path.join(headersDst, 'pg_config_ext.h'),
    )
  }

  logger.success(`Distribution files copied to ${distDir}`)
  return distDir
}
