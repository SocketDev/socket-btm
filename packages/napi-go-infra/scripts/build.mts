/**
 * Build the napi-go hello reference binding. This is a smoke test for
 * the framework, not a published artifact. It exercises the same
 * buildNapiGoAddon path that downstream builders use.
 *
 *   node scripts/build.mts            # normal build
 *   node scripts/build.mts --force    # force rebuild
 *   node scripts/build.mts --dev      # dev mode (default)
 *   node scripts/build.mts --prod     # prod mode (optimized, stripped)
 */

import path from 'node:path'
import process from 'node:process'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { errorMessage } from 'build-infra/lib/error-utils'
import { getBuildMode } from 'build-infra/lib/constants'
import { printError } from 'build-infra/lib/build-output'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { buildNapiGoAddon } from '../cli/src/build.mts'
import {
  HELLO_GO_DIR,
  HELLO_SHIM,
  LIB_DIR,
  PACKAGE_ROOT,
} from './paths.mts'

const logger = getDefaultLogger()

const args = new Set(process.argv.slice(2))
const BUILD_MODE = getBuildMode(args)

async function main() {
  const t0 = Date.now()
  logger.step('Building napi-go hello reference binding')
  logger.info(`Build mode: ${BUILD_MODE}`)

  const platformArch = await getCurrentPlatformArch()
  const outDir = path.join(LIB_DIR, platformArch)

  logger.info(`Platform-arch: ${platformArch}`)

  await buildNapiGoAddon({
    __proto__: null,
    packageRoot: PACKAGE_ROOT,
    bindingName: 'hello',
    goDir: HELLO_GO_DIR,
    consumerShim: HELLO_SHIM,
    outDir,
    platformArch,
    mode: BUILD_MODE,
  })

  const ms = Date.now() - t0
  logger.success(`Build Complete (${(ms / 1000).toFixed(2)}s)`)
}

main().catch(error => {
  printError('napi-go build failed')
  logger.error(errorMessage(error))
  throw error
})
