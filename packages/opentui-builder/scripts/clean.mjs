/**
 * Clean opentui-builder build artifacts.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { BUILD_ROOT, PACKAGE_ROOT } from './paths.mjs'

const logger = getDefaultLogger()

async function main() {
  logger.step('Cleaning opentui-builder')

  // Clean build directory.
  if (existsSync(BUILD_ROOT)) {
    logger.substep('Removing build directory...')
    await safeDelete(BUILD_ROOT, { recursive: true })
    logger.success('Removed build/')
  }

  // Clean zig-cache directory if it exists at package root.
  const zigCacheDir = path.join(PACKAGE_ROOT, 'zig-cache')
  if (existsSync(zigCacheDir)) {
    logger.substep('Removing zig-cache directory...')
    await safeDelete(zigCacheDir, { recursive: true })
    logger.success('Removed zig-cache/')
  }

  // Clean .zig-cache directory if it exists at package root.
  const dotZigCacheDir = path.join(PACKAGE_ROOT, '.zig-cache')
  if (existsSync(dotZigCacheDir)) {
    logger.substep('Removing .zig-cache directory...')
    await safeDelete(dotZigCacheDir, { recursive: true })
    logger.success('Removed .zig-cache/')
  }

  logger.success('Clean complete')
}

main().catch(error => {
  logger.error('Clean failed:', error.message)
  process.exitCode = 1
})
