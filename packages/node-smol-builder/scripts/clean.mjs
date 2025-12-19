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

    // Clean dev build
    const devPaths = getBuildPaths('dev')
    if (existsSync(devPaths.buildDir)) {
      await safeDelete(devPaths.buildDir)
      logger.success('Cleaned build/dev/')
    }

    // Clean prod build
    const prodPaths = getBuildPaths('prod')
    if (existsSync(prodPaths.buildDir)) {
      await safeDelete(prodPaths.buildDir)
      logger.success('Cleaned build/prod/')
    }

    // Clean shared build
    const { getSharedBuildPaths } = await import('./paths.mjs')
    const sharedPaths = getSharedBuildPaths()
    if (existsSync(sharedPaths.buildDir)) {
      await safeDelete(sharedPaths.buildDir)
      logger.success('Cleaned build/shared/')
    }

    // Clean binjected build outputs
    const binjectedOutDir = path.join(BINJECTED_DIR, 'out')
    if (existsSync(binjectedOutDir)) {
      await safeDelete(binjectedOutDir)
      logger.success('Cleaned binjected/out/')
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
