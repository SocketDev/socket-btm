#!/usr/bin/env node
/**
 * Build script for binpress C package
 * Wraps the Makefile build target for pnpm integration
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { ensureLzfse } from 'build-infra/lib/lzfse-init'
import { ensureZstd } from 'build-infra/lib/zstd-init'
import { ensureLief } from 'lief-builder/lib/ensure-lief'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure LIEF library exists (required for cross-platform compression).
// LIEF enables compressing different binary formats from any platform:
// - macOS: compress ELF/PE (Mach-O is native)
// - Linux: compress Mach-O/PE (ELF is native)
// - Windows: compress Mach-O/ELF (PE is native)
// LIEF is downloaded from releases if needed.
//
// Ensure lzfse submodule is initialized (build dependency).
async function ensureDependencies({ buildMode, packageDir }) {
  await ensureLief({ buildMode })
  await ensureLzfse({ packageDir })
  await ensureZstd({ packageDir })
}

// Custom smoke test for Windows: only verify file exists and size.
// Skip --version test to avoid DLL dependency issues and cross-architecture execution problems.
async function windowsSmokeTest(binaryPath) {
  const stats = await fs.stat(binaryPath)
  if (stats.size < 1000) {
    throw new Error(`Binary too small: ${stats.size} bytes (expected >1KB)`)
  }
}

buildBinSuitePackage({
  beforeBuild: ensureDependencies,
  packageDir: packageRoot,
  packageName: 'binpress',
  smokeTest: os.platform() === 'win32' ? windowsSmokeTest : undefined,
}).catch(e => {
  getDefaultLogger().error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
