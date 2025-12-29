/**
 * Clean script for node-smol-builder
 *
 * Usage:
 *   pnpm clean              - Clean build directory
 *   pnpm clean:build        - Clean build directory only
 *   pnpm clean:dist         - Clean dist directory only
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BINJECTED_DIR, getBuildPaths } from './paths.mjs'

const logger = getDefaultLogger()

const { values } = parseArgs({
  options: {
    build: { type: 'boolean' },
    dist: { type: 'boolean' },
  },
  strict: false,
})

const cleanBuild = values.build || (!values.dist && !values.build)
const cleanDist = values.dist || (!values.dist && !values.build)

async function clean() {
  logger.log('🧹 Cleaning node-smol-builder...')
  logger.log('')

  if (cleanBuild) {
    logger.group('Cleaning build directories...')

    // Clean dev build.
    const devPaths = getBuildPaths('dev')
    if (existsSync(devPaths.buildDir)) {
      await safeDelete(devPaths.buildDir)
      logger.success('Cleaned build/dev/')
    }

    // Clean prod build.
    const prodPaths = getBuildPaths('prod')
    if (existsSync(prodPaths.buildDir)) {
      await safeDelete(prodPaths.buildDir)
      logger.success('Cleaned build/prod/')
    }

    // Clean shared build.
    const { getSharedBuildPaths } = await import('./paths.mjs')
    const sharedPaths = getSharedBuildPaths()
    if (existsSync(sharedPaths.buildDir)) {
      await safeDelete(sharedPaths.buildDir)
      logger.success('Cleaned build/shared/')
    }

    // Clean binjected build outputs.
    const binjectedOutDir = path.join(BINJECTED_DIR, 'out')
    if (existsSync(binjectedOutDir)) {
      await safeDelete(binjectedOutDir)
      logger.success('Cleaned binjected/out/')
    }

    // Clean binsuite tool builds (binflate, binpress, binject).
    const binpressDir = path.join('..', 'binpress', 'build')
    if (existsSync(binpressDir)) {
      await safeDelete(binpressDir)
      logger.success('Cleaned ../binpress/build/')
    }

    const binpressOutDir = path.join('..', 'binpress', 'out')
    if (existsSync(binpressOutDir)) {
      await safeDelete(binpressOutDir)
      logger.success('Cleaned ../binpress/out/')
    }

    const binflateDir = path.join('..', 'binflate', 'build')
    if (existsSync(binflateDir)) {
      await safeDelete(binflateDir)
      logger.success('Cleaned ../binflate/build/')
    }

    const binflateOutDir = path.join('..', 'binflate', 'out')
    if (existsSync(binflateOutDir)) {
      await safeDelete(binflateOutDir)
      logger.success('Cleaned ../binflate/out/')
    }

    const binjectDir = path.join('..', 'binject', 'build')
    if (existsSync(binjectDir)) {
      await safeDelete(binjectDir)
      logger.success('Cleaned ../binject/build/')
    }

    const binjectOutDir = path.join('..', 'binject', 'out')
    if (existsSync(binjectOutDir)) {
      await safeDelete(binjectOutDir)
      logger.success('Cleaned ../binject/out/')
    }

    // Clean yoga-layout-builder wasm outputs.
    const yogaLayoutDir = path.join('..', 'yoga-layout-builder', 'dist')
    if (existsSync(yogaLayoutDir)) {
      await safeDelete(yogaLayoutDir)
      logger.success('Cleaned ../yoga-layout-builder/dist/')
    }

    // Clean user cache (~/.socket).
    const { homedir } = await import('node:os')
    const socketCacheDir = path.join(homedir(), '.socket')
    if (existsSync(socketCacheDir)) {
      await safeDelete(socketCacheDir)
      logger.success('Cleaned ~/.socket/')
    }

    logger.groupEnd()
    logger.log('')
  }

  if (cleanDist) {
    logger.group('Cleaning dist directory...')
    const distDir = 'dist'
    if (existsSync(distDir)) {
      await safeDelete(distDir)
      logger.success('Cleaned dist/')
    } else {
      logger.info('dist/ does not exist')
    }
    logger.groupEnd()
    logger.log('')
  }

  logger.success('Cleanup complete!')
}

clean().catch(err => {
  logger.error('Cleanup failed:', err)
  process.exit(1)
})
