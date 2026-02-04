#!/usr/bin/env node
/**
 * Build script for binflate C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { ensureLzfse } from 'build-infra/lib/lzfse-init'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure lzfse submodule is initialized (required for lzfse compression).
async function ensureDependencies({ packageDir }) {
  await ensureLzfse({ packageDir })
}

buildBinSuitePackage({
  packageName: 'binflate',
  packageDir: packageRoot,
  beforeBuild: ensureDependencies,
})
