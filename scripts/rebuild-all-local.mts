#!/usr/bin/env node
/**
 * Local Rebuild Script - Build everything from source without downloads.
 *
 * This script clears all caches and rebuilds:
 * - LIEF library from source
 * - Binsuite tools (binject, binflate, binpress) from source
 * - Node-smol binaries from source
 *
 * Usage:
 *   node scripts/rebuild-all-local.mts [options]
 *
 * Options:
 *   --skip-clean     Skip cache/checkpoint cleaning
 *   --lief-only      Only rebuild LIEF
 *   --binsuite-only  Only rebuild binsuite tools
 *   --node-only      Only rebuild node-smol
 *   --help           Show this help message
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.join(__dirname, '..')

type RebuildOptions = {
  binsuiteOnly: boolean
  help: boolean
  liefOnly: boolean
  nodeOnly: boolean
  skipClean: boolean
}

/**
 * Parse command line arguments.
 */
function parseArgs(): RebuildOptions {
  const argv: string[] = process.argv
  const args = new Set(argv.slice(2))
  return {
    binsuiteOnly: args.has('--binsuite-only'),
    help: args.has('--help') || args.has('-h'),
    liefOnly: args.has('--lief-only'),
    nodeOnly: args.has('--node-only'),
    skipClean: args.has('--skip-clean'),
  }
}

/**
 * Show help message.
 */
function showHelp(): void {
  logger.log('')
  logger.log('Local Rebuild Script - Build everything from source')
  logger.log('='.repeat(60))
  logger.log('')
  logger.log('Usage:')
  logger.log('  node scripts/rebuild-all-local.mts [options]')
  logger.log('')
  logger.log('Options:')
  logger.log('  --skip-clean     Skip cache/checkpoint cleaning')
  logger.log('  --lief-only      Only rebuild LIEF')
  logger.log('  --binsuite-only  Only rebuild binsuite tools')
  logger.log('  --node-only      Only rebuild node-smol')
  logger.log('  --help, -h       Show this help message')
  logger.log('')
  logger.log('What this script does:')
  logger.log('  1. Clears all build caches and checkpoints')
  logger.log('  2. Rebuilds LIEF library from source')
  logger.log('  3. Rebuilds binsuite tools (binject, binflate, binpress)')
  logger.log('  4. Rebuilds node-smol binaries from source')
  logger.log('')
  logger.log('Environment variables set:')
  logger.log('  SOCKET_BUILD_FORCE_REBUILD=1    - Force rebuild from source')
  logger.log('  SOCKET_SKIP_PREBUILT=1          - Skip prebuilt downloads')
  logger.log(
    '  PREBUILT_NODE_DOWNLOAD_URL=""   - Disable node binary downloads',
  )
  logger.log('')
}

/**
 * Clean build caches and checkpoints.
 */
async function cleanCaches(): Promise<void> {
  logger.log('')
  logger.log('Cleaning Caches')
  logger.log('='.repeat(60))
  logger.log('')

  const cacheDirs = [
    // Build directories.
    path.join(rootDir, 'packages/bin-infra/build'),
    path.join(rootDir, 'packages/binject/build'),
    path.join(rootDir, 'packages/binflate/build'),
    path.join(rootDir, 'packages/binpress/build'),
    path.join(rootDir, 'packages/node-smol-builder/build'),

    // Checkpoint directories.
    path.join(rootDir, 'packages/bin-infra/build/dev/checkpoints'),
    path.join(rootDir, 'packages/bin-infra/build/int4/checkpoints'),
    path.join(rootDir, 'packages/binject/build/dev/checkpoints'),
    path.join(rootDir, 'packages/binflate/build/dev/checkpoints'),
    path.join(rootDir, 'packages/binpress/build/dev/checkpoints'),
    path.join(rootDir, 'packages/node-smol-builder/build/dev/checkpoints'),
    path.join(rootDir, 'packages/node-smol-builder/build/release/checkpoints'),
  ]

  for (const dir of cacheDirs) {
    if (existsSync(dir)) {
      logger.info(`Removing: ${path.relative(rootDir, dir)}`)
      await safeDelete(dir)
    }
  }

  logger.success('Cache cleaning complete')
  logger.log('')
}

/**
 * Rebuild LIEF from source.
 */
async function rebuildLief(): Promise<void> {
  logger.log('')
  logger.log('Rebuilding LIEF')
  logger.log('='.repeat(60))
  logger.log('')

  const liefScript = path.join(
    rootDir,
    'packages/lief-builder/scripts/build.mts',
  )

  if (!existsSync(liefScript)) {
    logger.fail('LIEF build script not found')
    throw new Error(`Script not found: ${liefScript}`)
  }

  logger.info('Building LIEF from source...')
  logger.log('')

  const result = await spawn('node', [liefScript], {
    cwd: path.join(rootDir, 'packages/lief-builder'),
    env: {
      ...process.env,
      // Disable prebuilt downloads.
      PREBUILT_NODE_DOWNLOAD_URL: '',
      SOCKET_BUILD_FORCE_REBUILD: '1',
      SOCKET_SKIP_PREBUILT: '1',
    },
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.fail('LIEF build failed')
    throw new Error(`LIEF build failed with exit code ${result.code}`)
  }

  logger.success('LIEF build complete')
  logger.log('')
}

/**
 * Rebuild binsuite tools from source.
 */
async function rebuildBinsuite(): Promise<void> {
  logger.log('')
  logger.log('Rebuilding Binsuite Tools')
  logger.log('='.repeat(60))
  logger.log('')

  const tools: string[] = ['binject', 'binflate', 'binpress']

  for (const tool of tools) {
    logger.info(`Building ${tool} from source...`)
    logger.log('')

    const result = await spawn('pnpm', ['--filter', tool, 'run', 'build'], {
      cwd: rootDir,
      env: {
        ...process.env,
        // Disable prebuilt downloads.
        PREBUILT_NODE_DOWNLOAD_URL: '',
        SOCKET_BUILD_FORCE_REBUILD: '1',
        SOCKET_SKIP_PREBUILT: '1',
      },
      shell: WIN32,
      stdio: 'inherit',
    })

    if (result.code !== 0) {
      logger.fail(`${tool} build failed`)
      throw new Error(`${tool} build failed with exit code ${result.code}`)
    }

    logger.success(`${tool} build complete`)
    logger.log('')
  }
}

/**
 * Rebuild node-smol binaries from source.
 */
async function rebuildNodeSmol(): Promise<void> {
  logger.log('')
  logger.log('Rebuilding Node-Smol')
  logger.log('='.repeat(60))
  logger.log('')

  logger.info('Building node-smol from source...')
  logger.log('')

  const result = await spawn(
    'pnpm',
    ['--filter', 'node-smol-builder', 'run', 'build'],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        // Disable prebuilt downloads.
        PREBUILT_NODE_DOWNLOAD_URL: '',
        SOCKET_BUILD_FORCE_REBUILD: '1',
        SOCKET_SKIP_PREBUILT: '1',
      },
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.fail('node-smol build failed')
    throw new Error(`node-smol build failed with exit code ${result.code}`)
  }

  logger.success('node-smol build complete')
  logger.log('')
}

/**
 * Main execution.
 */
async function main(): Promise<void> {
  const options = parseArgs()

  if (options.help) {
    showHelp()
    return
  }

  logger.log('')
  logger.log('Socket Binary Toolchain - Local Rebuild')
  logger.log('='.repeat(60))
  logger.log('')
  logger.log('This will rebuild everything from source without downloads.')
  logger.log('Build mode: Local development')
  logger.log('')

  const buildAll =
    !options.liefOnly && !options.binsuiteOnly && !options.nodeOnly

  try {
    // Step 1: Clean caches.
    if (!options.skipClean) {
      await cleanCaches()
    } else {
      logger.info('Skipping cache cleaning (--skip-clean)')
      logger.log('')
    }

    // Step 2: Rebuild LIEF.
    if (buildAll || options.liefOnly) {
      await rebuildLief()
    }

    // Step 3: Rebuild binsuite tools.
    if (buildAll || options.binsuiteOnly) {
      await rebuildBinsuite()
    }

    // Step 4: Rebuild node-smol.
    if (buildAll || options.nodeOnly) {
      await rebuildNodeSmol()
    }

    logger.log('')
    logger.log('='.repeat(60))
    logger.success('All builds completed successfully!')
    logger.log('')
    logger.log('Next steps:')
    logger.log('  - Test the built binaries in packages/*/build/dev/out/Final/')
    logger.log('  - Run tests: pnpm test')
    logger.log('')
  } catch (e) {
    logger.log('')
    logger.log('='.repeat(60))
    logger.fail('Build failed!')
    logger.error((e as Error).message)
    logger.log('')
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error('Unexpected error:', e)
  process.exitCode = 1
})
