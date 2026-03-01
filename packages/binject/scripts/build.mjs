#!/usr/bin/env node
/**
 * Build script for binject C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureLief } from 'bin-infra/lib/build-lief'
import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { ensureLibdeflate } from 'build-infra/lib/libdeflate-init'
import { ensureLzfse } from 'build-infra/lib/lzfse-init'

import { ensureCjson } from './ensure-cjson.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure dependencies are available before building:
// - LIEF: Cross-platform binary format support (downloaded from releases).
// - lzfse: LZFSE compression (submodule in bin-infra).
// - libdeflate: High-performance gzip compression for Linux/Windows (submodule in binject).
// - cJSON: JSON parsing for smol config extraction (submodule in binject).
// Note: Git submodule inits must run sequentially (they lock .git/config).
async function ensureDependencies({ BUILD_MODE, packageDir }) {
  await ensureLief({ buildMode: BUILD_MODE })
  await ensureLzfse({ packageDir })
  await ensureLibdeflate({ packageDir })
  await ensureCjson({ packageDir })
}

buildBinSuitePackage({
  packageName: 'binject',
  packageDir: packageRoot,
  beforeBuild: ensureDependencies,
  skipClean: true,
  validateCheckpointWithBinary: true,
})
