/**
 * Build ultraviolet-node — the napi-go-powered Node binding for
 * Charmbracelet Ultraviolet.
 *
 *   node scripts/build.mts            # normal build
 *   node scripts/build.mts --force    # force rebuild
 *   node scripts/build.mts --dev      # dev mode (default)
 *   node scripts/build.mts --prod     # prod mode
 */

import path from 'node:path'
import process from 'node:process'

import { getBuildMode } from 'build-infra/lib/constants'
import { errorMessage } from 'build-infra/lib/error-utils'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { printError } from 'build-infra/lib/build-output'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { buildNapiGoAddon } from 'napi-go/cli'

import { GO_SHIM, LIB_DIR, PACKAGE_ROOT, SRC_DIR } from './paths.mts'

const logger = getDefaultLogger()

const args = new Set(process.argv.slice(2))
const BUILD_MODE = getBuildMode(args)

async function ensureGoDeps() {
  logger.substep('Resolving Go module deps (go mod tidy)')
  const result = await spawn('go', ['mod', 'tidy'], {
    cwd: SRC_DIR,
    shell: WIN32,
    stdio: 'inherit',
  })
  const exit = result.code ?? result.exitCode ?? 0
  if (exit !== 0) {
    throw new Error(
      `ultraviolet-builder: 'go mod tidy' failed (exit ${exit}). ` +
        `Verify network access for github.com/charmbracelet/ultraviolet and its transitive deps.`,
    )
  }
}

async function main() {
  const t0 = Date.now()
  logger.step('Building ultraviolet-node')
  logger.info(`Build mode: ${BUILD_MODE}`)

  const platformArch = await getCurrentPlatformArch()
  const outDir = path.join(LIB_DIR, platformArch)

  logger.info(`Platform-arch: ${platformArch}`)

  await ensureGoDeps()

  await buildNapiGoAddon({
    __proto__: null,
    packageRoot: PACKAGE_ROOT,
    bindingName: 'ultraviolet',
    goDir: SRC_DIR,
    consumerShim: GO_SHIM,
    outDir,
    platformArch,
    mode: BUILD_MODE,
  })

  const ms = Date.now() - t0
  logger.success(`Build Complete (${(ms / 1000).toFixed(2)}s)`)
}

main().catch(error => {
  printError('ultraviolet-builder build failed')
  logger.error(errorMessage(error))
  throw error
})
