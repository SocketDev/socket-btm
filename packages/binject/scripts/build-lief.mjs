#!/usr/bin/env node
/**
 * Build script for LIEF library.
 * Downloads and builds LIEF C++ library for binject.
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
const buildDir = path.join(packageRoot, 'build')
const liefUpstream = path.join(packageRoot, 'upstream/lief')
const liefBuildDir = path.join(packageRoot, 'build/lief')

const WIN32 = process.platform === 'win32'
const DARWIN = process.platform === 'darwin'

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
    // Check if LIEF is already built.
    const forceRebuild = process.argv.includes('--force')
    if (!(await shouldRun(buildDir, '', 'lief-built', forceRebuild))) {
      logger.success('LIEF already built (checkpoint exists)')
      return
    }

    logger.info('🔨 Building LIEF library...\n')

    // Only build LIEF on macOS (where it's needed for unlimited segment sizes).
    if (!DARWIN) {
      logger.info('Skipping LIEF build (not on macOS)')
      await createCheckpoint(buildDir, 'lief-built', async () => {}, {
        skipped: true,
        platform: process.platform,
      })
      return
    }

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

    // Use ccache if available.
    try {
      await runCommand('which', ['ccache'], liefBuildDir)
      cmakeArgs.push('-DCMAKE_CXX_COMPILER_LAUNCHER=ccache')
      logger.info('Using ccache for faster compilation')
    } catch {
      logger.info('ccache not available, building without cache')
    }

    await runCommand('cmake', cmakeArgs, liefBuildDir)
    logger.info('')

    // Build LIEF.
    logger.info('Building LIEF (this may take 10-20 minutes)...')
    const buildStart = Date.now()
    await runCommand(
      'cmake',
      ['--build', '.', '--config', 'Release', '-j2'],
      liefBuildDir,
    )
    const buildDuration = Math.round((Date.now() - buildStart) / 1000)
    logger.info(
      `LIEF build completed in ${buildDuration}s (${Math.floor(buildDuration / 60)}m ${buildDuration % 60}s)`,
    )
    logger.info('')

    logger.success('LIEF build completed successfully!')

    // Verify library exists.
    const libPath = path.join(liefBuildDir, 'libLIEF.a')
    if (!existsSync(libPath)) {
      throw new Error(`LIEF library not found at ${libPath}`)
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
      },
      {
        version: LIEF_VERSION,
        libPath: path.relative(buildDir, libPath),
        libSize: stats.size,
        libSizeMB: sizeMB,
        buildDir: path.relative(packageRoot, liefBuildDir),
      },
    )
  } catch (error) {
    logger.info('')
    logger.fail(`LIEF build failed: ${error.message}`)
    process.exit(1)
  }
}

main()
