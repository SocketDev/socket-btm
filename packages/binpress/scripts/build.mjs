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

// Ensure LIEF library exists on macOS (required for segment embedding).
// LIEF is downloaded from releases if needed.
async function ensureLiefOnMacOS({ BUILD_MODE, packageDir }) {
  if (process.platform !== 'darwin') {
    return
  }
  await ensureLief({ BUILD_MODE, packageDir })
}

buildCPackage({
  packageName: 'binpress',
  packageDir: packageRoot,
  beforeBuild: ensureLiefOnMacOS,
})
