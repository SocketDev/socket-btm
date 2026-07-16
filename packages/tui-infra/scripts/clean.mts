#!/usr/bin/env node

/**
 * @file Clean tui-infra build artifacts.
 *   Source-only package — almost nothing to clean except node_modules
 *   and any local test output dirs. Mirrors temporal-infra/scripts/clean.mts
 *   for fleet uniformity.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

const CLEAN_TARGETS = ['coverage', 'dist', 'node_modules']

void (async () => {
  for (let i = 0, { length } = CLEAN_TARGETS; i < length; i += 1) {
    const target = CLEAN_TARGETS[i]!
    const fullPath = path.join(packageRoot, target)
    await safeDelete(fullPath, { force: true })
    logger.success(`removed ${target}/`)
  }
})()
