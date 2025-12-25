#!/usr/bin/env node
/**
 * Build script for binpress C package
 * Wraps the Makefile build target for pnpm integration
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCPackage, runCommand } from 'build-infra/lib/c-package-builder'
import { shouldRun } from 'build-infra/lib/checkpoint-manager'
import { BUILD_STAGES } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Build LIEF library on macOS (required for segment embedding).
// LIEF is built in bin-infra (shared with binject).
async function buildLiefOnMacOS({ BUILD_MODE, packageDir }) {
  if (process.platform !== 'darwin') {
    return
  }

  const binInfraBuildDir = path.join(
    packageDir,
    '../bin-infra/build',
    BUILD_MODE,
  )
  const liefLibPath = path.join(
    binInfraBuildDir,
    'out',
    BUILD_STAGES.FINAL,
    'lief',
    'libLIEF.a',
  )
  const liefIncludeDir = path.join(
    binInfraBuildDir,
    'out',
    BUILD_STAGES.FINAL,
    'lief',
    'include',
  )
  const liefCheckpointExists = !(await shouldRun(
    binInfraBuildDir,
    '',
    'lief-built',
    false,
  ))

  if (
    !liefCheckpointExists ||
    !existsSync(liefLibPath) ||
    !existsSync(liefIncludeDir)
  ) {
    logger.info('🔧 Building LIEF library for macOS...')
    await runCommand(
      'node',
      [path.join(packageDir, '../bin-infra/scripts/build-lief.mjs')],
      packageDir,
    )
  } else {
    logger.success('LIEF library already built')
  }
}

buildCPackage({
  packageName: 'binpress',
  packageDir: packageRoot,
  beforeBuild: buildLiefOnMacOS,
})
