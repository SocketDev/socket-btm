#!/usr/bin/env node
/**
 * Build script for binject C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCPackage } from 'build-infra/lib/c-package-builder'
import { ensureLief } from 'build-infra/lib/lief-downloader'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure LIEF library exists (required for cross-platform binary injection).
// LIEF enables injecting into non-native binary formats:
// - macOS: inject into PE/ELF (Mach-O is native).
// - Linux: inject into PE/Mach-O (ELF is native).
// - Windows: inject into ELF/Mach-O (PE is native).
// LIEF is downloaded from releases if needed.
async function ensureLiefForBinject({ BUILD_MODE, packageDir }) {
  await ensureLief({ BUILD_MODE, packageDir })
}

buildCPackage({
  packageName: 'binject',
  packageDir: packageRoot,
  beforeBuild: ensureLiefForBinject,
  skipClean: true,
  validateCheckpointWithBinary: true,
})
