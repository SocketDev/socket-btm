#!/usr/bin/env node
/**
 * Build script for binflate C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { ensureLzfse } from 'build-infra/lib/lzfse-init'
import { ensureZstd } from 'build-infra/lib/zstd-init'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

// Ensure lzfse submodule is initialized (build dependency).
async function ensureDependencies({ packageDir }) {
  await ensureLzfse({ packageDir })
  await ensureZstd({ packageDir })
}

buildBinSuitePackage({
  beforeBuild: ensureDependencies,
  packageDir: packageRoot,
  packageName: 'binflate',
}).catch(e => {
  getDefaultLogger().error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
