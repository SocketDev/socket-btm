#!/usr/bin/env node
/**
 * Build script for binject C package
 * Wraps the Makefile build target for pnpm integration
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCPackage } from 'build-infra/lib/c-package-builder'
import { BUILD_STAGES } from 'build-infra/lib/constants'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Build LIEF library first (required for cross-platform binary injection).
// LIEF enables injecting into non-native binary formats:
// - macOS: inject into PE/ELF (Mach-O is native)
// - Linux: inject into PE/Mach-O (ELF is native)
// - Windows: inject into ELF/Mach-O (PE is native)
// LIEF is downloaded from releases (built in bin-infra, shared with binpress).
async function validateLiefExists({ BUILD_MODE, packageDir }) {
  const binInfraBuildDir = path.join(
    packageDir,
    '../bin-infra/build',
    BUILD_MODE,
  )
  const liefLibUnix = path.join(
    binInfraBuildDir,
    'out',
    BUILD_STAGES.FINAL,
    'lief',
    'libLIEF.a',
  )
  const liefLibMSVC = path.join(
    binInfraBuildDir,
    'out',
    BUILD_STAGES.FINAL,
    'lief',
    'LIEF.lib',
  )
  const liefLibPath = existsSync(liefLibUnix) ? liefLibUnix : liefLibMSVC
  const liefIncludeDir = path.join(
    binInfraBuildDir,
    'out',
    BUILD_STAGES.FINAL,
    'lief',
    'include',
  )
  // LIEF must be downloaded from releases, never built from source here.
  if (!existsSync(liefLibPath) || !existsSync(liefIncludeDir)) {
    throw new Error(
      `LIEF library not found at ${liefLibPath}. ` +
        'Download prebuilt LIEF from releases using: ' +
        'node packages/bin-infra/scripts/download-binsuite-tools.mjs --tool=lief',
    )
  }
  logger.success('LIEF library found')
}

buildCPackage({
  packageName: 'binject',
  packageDir: packageRoot,
  beforeBuild: validateLiefExists,
  skipClean: true,
  validateCheckpointWithBinary: true,
})
