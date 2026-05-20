#!/usr/bin/env node
/**
 * Build script for binflate C package
 * Wraps the Makefile build target for pnpm integration
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { errorMessage } from 'build-infra/lib/error-utils'
import { ensureZstd } from 'build-infra/lib/zstd-init'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

export async function ensureDependencies({ packageDir }) {
  await ensureZstd({ packageDir })
}

buildBinSuitePackage({
  beforeBuild: ensureDependencies,
  packageDir: packageRoot,
  packageName: 'binflate',
}).catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
