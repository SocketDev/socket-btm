#!/usr/bin/env node
/**
 * Build script for binpress C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildCPackage } from 'build-infra/lib/c-package-builder'
import { ensureLief } from 'build-infra/lib/lief-downloader'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure LIEF library exists (required for cross-platform compression).
// LIEF enables compressing different binary formats from any platform:
// - macOS: compress ELF/PE (Mach-O is native)
// - Linux: compress Mach-O/PE (ELF is native)
// - Windows: compress Mach-O/ELF (PE is native)
// LIEF is downloaded from releases if needed.
async function ensureLiefForBinpress({ BUILD_MODE, packageDir }) {
  await ensureLief({ BUILD_MODE, packageDir })
}

buildCPackage({
  packageName: 'binpress',
  packageDir: packageRoot,
  beforeBuild: ensureLiefForBinpress,
})
