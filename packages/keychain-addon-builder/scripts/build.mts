#!/usr/bin/env node
/**
 * @file Build the keychain .node addon: clang-links the N-API shim
 *   (keychain_napi.mm) with the shared keystore-infra macOS backend into
 *   `keychain.node`. Direct-clang link mirrors napi-go-infra (no node-gyp, no
 *   new deps): `-shared -undefined dynamic_lookup -Wl,-S`, node's bundled N-API
 *   headers on the include path, frameworks linked. macOS-first — the
 *   Linux/Windows .node (the N-API shim compiled as C++ against
 *   keystore_linux.c / keystore_win.c) is a later phase.
 */

import { existsSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { exec } from 'build-infra/lib/build-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getKeychainAddonBinaryPath, getKeychainAddonOutDir } from './paths.mts'

const logger = getDefaultLogger()

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const keystoreInfraSrc = path.join(packageRoot, '..', 'keystore-infra', 'src')

async function main() {
  if (process.platform !== 'darwin') {
    throw new Error(
      `keychain-addon-builder: only darwin is implemented yet (got ` +
        `'${process.platform}'). The Linux/Windows .node lands in a later phase.`,
    )
  }

  // node ships the N-API headers under <prefix>/include/node.
  const nodeInclude = path.join(
    path.dirname(path.dirname(process.execPath)),
    'include',
    'node',
  )
  if (!existsSync(path.join(nodeInclude, 'node_api.h'))) {
    throw new Error(`node_api.h not found under ${nodeInclude}.`)
  }

  const mode = process.env['BUILD_MODE'] ?? (process.env['CI'] ? 'prod' : 'dev')
  const platformArch = `${process.platform}-${process.arch}`
  const outDir = getKeychainAddonOutDir(mode, platformArch)
  await mkdir(outDir, { recursive: true })
  const outPath = getKeychainAddonBinaryPath(mode, platformArch)

  const shim = path.join(
    packageRoot,
    'src',
    'socketsecurity',
    'keychain-addon-builder',
    'keychain_napi.mm',
  )
  const keystoreMacos = path.join(
    keystoreInfraSrc,
    'socketsecurity',
    'keystore-infra',
    'keystore_macos.mm',
  )

  logger.info(`Linking keychain.node (${mode}, ${platformArch})…`)
  // Apple's clang++, not a PATH-resolved Homebrew LLVM (which lacks the macOS
  // SDK frameworks on its default search path). Matches the proteus Makefile's
  // /usr/bin/clang. exec throws on a non-zero exit. N-API symbols resolve
  // dynamically from the host node (-undefined dynamic_lookup); -Wl,-S strips.
  await exec(
    '/usr/bin/clang++',
    [
      '-shared',
      '-fobjc-arc',
      '-undefined',
      'dynamic_lookup',
      '-Wl,-S',
      mode === 'prod' ? '-O2' : '-O0',
      '-std=c++17',
      `-I${nodeInclude}`,
      `-I${keystoreInfraSrc}`,
      shim,
      keystoreMacos,
      '-framework',
      'Foundation',
      '-framework',
      'Security',
      '-framework',
      'LocalAuthentication',
      '-o',
      outPath,
    ],
    { cwd: packageRoot },
  )

  if (!existsSync(outPath)) {
    throw new Error(`Expected ${outPath} after link.`)
  }
  const stats = await stat(outPath)
  logger.success(`Built keychain.node: ${outPath} (${stats.size} bytes)`)
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
