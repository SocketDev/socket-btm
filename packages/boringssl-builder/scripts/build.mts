#!/usr/bin/env node
/**
 * boringssl-builder: build BoringSSL static libs (prefixed: smol_*) for
 * embedding in node:smol-http. Output is a sysroot-style tree:
 *
 *   build/<mode>/<platform-arch>/out/Final/
 *   ├── lib/{libsmol_crypto.a, libsmol_ssl.a}
 *   └── include/openssl/...           # prefixed headers
 *
 * The two-phase BoringSSL prefix recipe (probe build → make_prefix_headers.go
 * → real build with -DBORINGSSL_PREFIX) is documented at
 * boringssl.googlesource.com under BUILDING.md.
 */

import { existsSync, mkdirSync } from 'node:fs'
import process from 'node:process'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { UPSTREAM_DIR, getPaths } from './paths.mts'

const logger = getDefaultLogger()

const PREFIX = 'smol'

async function main(): Promise<void> {
  if (!existsSync(UPSTREAM_DIR)) {
    throw new Error(
      `boringssl upstream not found at ${UPSTREAM_DIR}; run \`git submodule update --init --depth=1 packages/boringssl-builder/upstream/boringssl\``,
    )
  }
  const { buildDir, cmakeBuildDir } = getPaths()
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(cmakeBuildDir, { recursive: true })

  const cmakeArgs = [
    '-S',
    UPSTREAM_DIR,
    '-B',
    cmakeBuildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DBORINGSSL_PREFIX=${PREFIX}`,
    '-DBUILD_SHARED_LIBS=OFF',
    '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
  ]
  logger.info(`Configuring: cmake ${cmakeArgs.join(' ')}`)
  const config = await spawn('cmake', cmakeArgs, { stdio: 'inherit' })
  if (config.exitCode !== 0) {
    throw new Error(`cmake configure failed (exit ${config.exitCode})`)
  }

  const build = await spawn(
    'cmake',
    ['--build', cmakeBuildDir, '--config', 'Release', '--parallel'],
    { stdio: 'inherit' },
  )
  if (build.exitCode !== 0) {
    throw new Error(`cmake build failed (exit ${build.exitCode})`)
  }

  logger.success(`BoringSSL built with prefix '${PREFIX}' at ${cmakeBuildDir}`)
}

main().catch(error => {
  logger.fail(`Build failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
