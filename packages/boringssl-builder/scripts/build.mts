#!/usr/bin/env node
/**
 * boringssl-builder: build BoringSSL static libs (prefixed: smol_*) for
 * embedding in node:smol-http. Output is a sysroot-style tree:
 *
 *   build/<mode>/<platform-arch>/out/Final/
 *   ├── lib/{libsmol_crypto.a, libsmol_ssl.a}
 *   └── include/openssl/...           # headers with prefix-rewrite macros
 *
 * BoringSSL's CMakeLists.txt handles symbol prefixing internally — pass
 * -DBORINGSSL_PREFIX=<name> and every public symbol gets that prefix.
 * Documented at boringssl.googlesource.com under BUILDING.md.
 */

import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { PREFIX, UPSTREAM_DIR, getPaths } from './paths.mts'

const logger = getDefaultLogger()

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.cp(from, to, { recursive: true, force: true })
}

async function configure(
  upstreamDir: string,
  cmakeBuildDir: string,
): Promise<void> {
  const cmakeArgs = [
    '-S',
    upstreamDir,
    '-B',
    cmakeBuildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DBORINGSSL_PREFIX=${PREFIX}`,
    '-DBUILD_SHARED_LIBS=OFF',
    '-DCMAKE_POSITION_INDEPENDENT_CODE=ON',
    '-DBUILD_TESTING=OFF',
  ]
  logger.info(`Configuring: cmake ${cmakeArgs.join(' ')}`)
  const config = await spawn('cmake', cmakeArgs, { stdio: 'inherit' })
  if (config.exitCode !== 0) {
    throw new Error(`cmake configure failed (exit ${config.exitCode})`)
  }
}

async function compile(cmakeBuildDir: string): Promise<void> {
  const build = await spawn(
    'cmake',
    [
      '--build',
      cmakeBuildDir,
      '--config',
      'Release',
      '--parallel',
      '--target',
      'crypto',
      '--target',
      'ssl',
    ],
    { stdio: 'inherit' },
  )
  if (build.exitCode !== 0) {
    throw new Error(`cmake build failed (exit ${build.exitCode})`)
  }
}

async function publishArtifacts(
  cmakeBuildDir: string,
  outLibDir: string,
  outIncludeDir: string,
): Promise<void> {
  mkdirSync(outLibDir, { recursive: true })
  mkdirSync(outIncludeDir, { recursive: true })
  // BoringSSL emits libcrypto.a + libssl.a regardless of -DBORINGSSL_PREFIX
  // (the prefix renames C symbols, not the archive filenames). Rename on
  // copy so downstream gyp can reference the unambiguous libsmol_* names.
  const platLibSuffix = process.platform === 'win32' ? '.lib' : '.a'
  const platLibPrefix = process.platform === 'win32' ? '' : 'lib'
  const libs = [
    {
      from: path.join(
        cmakeBuildDir,
        `${platLibPrefix}crypto${platLibSuffix}`,
      ),
      to: path.join(outLibDir, `${platLibPrefix}${PREFIX}_crypto${platLibSuffix}`),
    },
    {
      from: path.join(cmakeBuildDir, `${platLibPrefix}ssl${platLibSuffix}`),
      to: path.join(outLibDir, `${platLibPrefix}${PREFIX}_ssl${platLibSuffix}`),
    },
  ]
  for (const { from, to } of libs) {
    if (!existsSync(from)) {
      throw new Error(`Expected build artifact not found: ${from}`)
    }
    await fs.copyFile(from, to)
    logger.substep(`copied ${path.basename(from)} → ${path.basename(to)}`)
  }
  await copyTree(path.join(UPSTREAM_DIR, 'include'), outIncludeDir)
  logger.substep(`copied include/ tree → ${outIncludeDir}`)
}

async function main(): Promise<void> {
  if (!existsSync(UPSTREAM_DIR)) {
    throw new Error(
      `boringssl upstream not found at ${UPSTREAM_DIR}; run \`git submodule update --init --depth=1 packages/boringssl-builder/upstream/boringssl\``,
    )
  }
  const { buildDir, cmakeBuildDir, outLibDir, outIncludeDir } = getPaths()
  mkdirSync(buildDir, { recursive: true })
  mkdirSync(cmakeBuildDir, { recursive: true })

  await configure(UPSTREAM_DIR, cmakeBuildDir)
  await compile(cmakeBuildDir)
  await publishArtifacts(cmakeBuildDir, outLibDir, outIncludeDir)

  logger.success(
    `BoringSSL built with prefix '${PREFIX}' → ${path.dirname(outLibDir)}`,
  )
}

main().catch(error => {
  logger.fail(`Build failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
