#!/usr/bin/env node
/**
 * Build script for LIEF library.
 * Downloads and builds LIEF C++ library for binary manipulation tools (binject, binpress).
 */

import { spawn as spawnSync } from 'node:child_process'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createCheckpoint, shouldRun } from 'build-infra/lib/checkpoint-manager'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Determine build mode from environment or default to dev (following node-smol pattern)
const BUILD_MODE = process.env.BUILD_MODE || (process.env.CI ? 'prod' : 'dev')
const buildDir = path.join(packageRoot, 'build', BUILD_MODE)

const liefUpstream = path.join(packageRoot, 'upstream/lief')
const liefBuildDir = path.join(packageRoot, 'build', BUILD_MODE, 'lief')

const WIN32 = process.platform === 'win32'

// LIEF version (tracked in upstream).
const LIEF_VERSION = '0.17.1'

function runCommand(command, args, cwd, env = {}) {
  return new Promise((resolve, reject) => {
    logger.info(`Running: ${command} ${args.join(' ')}`)

    const proc = spawnSync(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: 'inherit',
      shell: WIN32,
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command failed with exit code ${code}`))
      }
    })

    proc.on('error', err => {
      reject(err)
    })
  })
}

async function main() {
  try {
    // Determine which LIEF library file to check for (platform-specific naming)
    const liefLibUnix = path.join(buildDir, 'lief', 'libLIEF.a')
    const liefLibMSVC = path.join(buildDir, 'lief', 'LIEF.lib')
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

    // Skip LIEF build only if submodule not initialized
    const liefSourceDir = path.join(packageRoot, 'upstream', 'lief')
    const liefCMakeLists = path.join(liefSourceDir, 'CMakeLists.txt')

    if (!existsSync(liefCMakeLists)) {
      logger.info('Skipping LIEF build (submodule not initialized)')
      logger.info(
        '  Run: git submodule update --init --recursive packages/binject/upstream/lief',
      )
      await createCheckpoint(buildDir, 'lief-built', async () => {}, {
        skipped: true,
        platform: process.platform,
        reason: 'submodule-not-initialized',
        artifactPath: liefBuildDir,
      })
      return
    }

    logger.info(
      `Building LIEF on ${process.platform} for cross-platform binary injection support`,
    )

    // Create build directory.
    await fs.mkdir(buildDir, { recursive: true })

    // Check if LIEF upstream exists.
    if (!existsSync(liefUpstream)) {
      throw new Error(
        `LIEF upstream not found at ${liefUpstream}. Run 'git submodule update --init --recursive' first.`,
      )
    }
    logger.info('LIEF upstream found')

    // Create build directory.
    await fs.mkdir(liefBuildDir, { recursive: true })

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
      cmakeArgs.push('-G', '"MinGW Makefiles"')

      logger.info('Building LIEF with gcc/g++ using MinGW Makefiles')
    }

    // Use ccache if available.
    try {
      await runCommand('which', ['ccache'], liefBuildDir)
      cmakeArgs.push('-DCMAKE_CXX_COMPILER_LAUNCHER=ccache')
      logger.info('Using ccache for faster compilation')
    } catch {
      logger.info('ccache not available, building without cache')
    }

    // Clear compiler flags that may have been set for the main binject build
    // LIEF build uses its own compiler settings and shouldn't inherit these
    const cleanEnv = {
      CFLAGS: undefined,
      CXXFLAGS: undefined,
      LDFLAGS: undefined,
    }
    await runCommand('cmake', cmakeArgs, liefBuildDir, cleanEnv)
    logger.info('')

    // Build LIEF.
    logger.info('Building LIEF (this may take 10-20 minutes)...')
    const buildStart = Date.now()
    await runCommand(
      'cmake',
      ['--build', '.', '--config', 'Release', '-j2'],
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
