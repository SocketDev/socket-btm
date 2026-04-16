#!/usr/bin/env node
/**
 * Build script for stubs-builder package.
 * Wraps the Makefile build target for pnpm integration.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildBinSuitePackage } from 'bin-infra/lib/builder'
import { ensureZstd } from 'build-infra/lib/zstd-init'
import { ensureCurl } from 'curl-builder/lib/ensure-curl'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const packageRoot = path.join(__dirname, '..')

buildBinSuitePackage({
  beforeBuild: async ({ packageDir }) => {
    // Ensure zstd submodule is initialized (required for compression).
    await ensureZstd({ packageDir })
    // Ensure curl libraries are available (required for stub builds).
    // Uses curl-builder package to download/build curl with mbedTLS.
    const curlLibPath = await ensureCurl()
    const curlDir = path.dirname(curlLibPath)
    logger.success(`curl libraries ready at ${curlDir}`)
  },
  packageDir: packageRoot,
  packageName: 'smol_stub',
  smokeTest: async binaryPath => {
    // Custom smoke test for smol_stub (doesn't have --version flag).
    // Just verify binary exists and has reasonable size.
    const stats = await fs.stat(binaryPath)
    if (stats.size < 1000) {
      throw new Error(`Binary too small: ${stats.size} bytes (expected >1KB)`)
    }
    logger.success(`Stub binary validated: ${stats.size} bytes`)
  },
}).catch(e => {
  logger.error(e instanceof Error ? e.message : String(e))
  process.exitCode = 1
})
