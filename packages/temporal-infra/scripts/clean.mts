/* oxlint-disable socket/no-status-emoji -- intentional emoji output. */

#!/usr/bin/env node
/**
 * @fileoverview Clean temporal-infra build artifacts.
 *
 * Source-only package — almost nothing to clean except node_modules
 * and any local test output dirs. Mirrors the bin-infra/clean.mts
 * shape so the workspace `clean` script is uniform across packages.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.resolve(__dirname, '..')

const CLEAN_TARGETS = ['node_modules', 'coverage', 'dist']

for (const target of CLEAN_TARGETS) {
  const fullPath = path.join(packageRoot, target)
  await safeDelete(fullPath, { force: true })
  logger.log(`✓ removed ${target}/`)
}
