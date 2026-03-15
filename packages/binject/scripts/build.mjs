#!/usr/bin/env node
/**
 * Build script for binject C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { ensureLibdeflate } from 'build-infra/lib/libdeflate-init'
import { ensureLzfse } from 'build-infra/lib/lzfse-init'
import { ensureLief } from 'lief-builder/lib/ensure-lief'

import { ensureCjson } from './ensure-cjson.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure dependencies are available before building:
// - LIEF: Cross-platform binary format support (downloaded from releases).
// - lzfse: LZFSE compression (submodule in lief-builder).
// - libdeflate: High-performance gzip compression for Linux/Windows (submodule in binject).
// - cJSON: JSON parsing for smol config extraction (submodule in binject).
// Note: Git submodule inits must run sequentially (they lock .git/config).
// LIEF downloads from releases (no git), so it runs in parallel with git operations.
async function ensureDependencies({ buildMode, packageDir }) {
  const results = await Promise.allSettled([
    // LIEF downloads from GitHub releases, no git required.
    ensureLief({ buildMode }),
    // Git submodule operations must run sequentially.
    (async () => {
      await ensureLzfse({ packageDir })
      await ensureLibdeflate({ packageDir })
      await ensureCjson({ packageDir })
    })(),
  ])
  const failures = results.filter(r => r.status === 'rejected')
  if (failures.length > 0) {
    throw new Error(
      `Failed to ensure ${failures.length} dependencies: ${failures.map(r => r.reason?.message || r.reason).join(', ')}`,
    )
  }
}

buildBinSuitePackage({
  beforeBuild: ensureDependencies,
  packageDir: packageRoot,
  packageName: 'binject',
  skipClean: true,
  validateCheckpointWithBinary: true,
})
