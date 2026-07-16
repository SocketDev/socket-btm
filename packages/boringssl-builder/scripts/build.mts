#!/usr/bin/env node
/**
 * Boringssl-builder native build orchestrator. Used on macOS / Windows
 * AND Linux-native runs (where the container path is not taken).
 *
 * Linux-container builds run docker/build.sh inside manylinux2014 — that
 * script is generated from build-step-defs.mts, so the two paths share
 * the same build commands. See emit-docker-build.mts.
 *
 * Output:
 * build/<mode>/<platform-arch>/out/Final/
 * ├── lib/{libsmol_crypto.a, libsmol_ssl.a}  (or smol_*.lib on MSVC)
 * └── include/openssl/...
 */

import { existsSync, mkdirSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import {
  BUILD_STEPS,
  PUBLISH_ARTIFACTS,
  PUBLISH_HEADERS,
  resolvePlaceholders,
  substituteArtifact,
  substituteStep,
} from './build-step-defs.mts'
import { getPaths, PREFIX, UPSTREAM_DIR } from './paths.mts'

const logger = getDefaultLogger()

export async function publishArtifacts(
  placeholders: Record<string, string>,
  outLibDir: string,
  outIncludeDir: string,
): Promise<void> {
  mkdirSync(outLibDir, { recursive: true })
  mkdirSync(outIncludeDir, { recursive: true })

  // PUBLISH_ARTIFACTS lists `$CMAKE_BUILD_DIR/libcrypto.a` (Unix names).
  // MSVC quirks absorbed here so PUBLISH_ARTIFACTS stays portable:
  //   - Names: `libcrypto.a` → `crypto.lib` (drop `lib`, swap suffix).
  //   - Path:  Visual Studio's multi-config generator emits to
  //            `$CMAKE_BUILD_DIR/Release/crypto.lib`. Ninja/Make use
  //            single-config and emit to the cmake dir root.
  const isWin = process.platform === 'win32'
  const libPrefix = isWin ? '' : 'lib'
  const libSuffix = isWin ? '.lib' : '.a'
  const winReleaseDir = isWin ? `Release${path.sep}` : ''
  for (const art of PUBLISH_ARTIFACTS) {
    const resolved = substituteArtifact(art, placeholders)
    // Match any `lib<name>.a` (crypto/ssl/decrepit and any future lib) so a
    // newly published artifact can't silently miss the MSVC rename the way
    // libdecrepit.a did when it was added after crypto/ssl.
    const from = resolved.from.replace(
      /([\\/])lib([a-z0-9_]+)\.a$/,
      `$1${winReleaseDir}${libPrefix}$2${libSuffix}`,
    )
    const to = resolved.to.replace(
      new RegExp(`lib(${PREFIX}_[a-z0-9_]+)\\.a$`),
      `${libPrefix}$1${libSuffix}`,
    )
    if (!existsSync(from)) {
      throw new Error(`Expected build artifact not found: ${from}`)
    }
    await fs.copyFile(from, to)
    logger.substep(`copied ${path.basename(from)} → ${path.basename(to)}`)
  }

  // Header tree copy. PUBLISH_HEADERS.fromSubdir is relative to upstream;
  // `fs.cp` creates intermediate dirs so no explicit mkdir.
  const headerSrc = path.join(UPSTREAM_DIR, PUBLISH_HEADERS.fromSubdir)
  const headerDest = path.join(outIncludeDir, PUBLISH_HEADERS.toSubdir)
  await fs.cp(headerSrc, headerDest, { recursive: true, force: true })
  logger.substep(`copied include/ tree → ${headerDest}`)
}

export async function runSteps(
  placeholders: Record<string, string>,
): Promise<void> {
  for (const step of BUILD_STEPS) {
    const resolved = substituteStep(step, placeholders)
    // BoringSSL builds with /WX on Windows; upstream's pqcrypto code uses
    // `#pragma GCC` which MSVC flags as C4068. Suppress so we don't fork.
    const extraFlags =
      process.platform === 'win32' && resolved.label === 'cmake configure'
        ? ['-DCMAKE_C_FLAGS=/wd4068', '-DCMAKE_CXX_FLAGS=/wd4068']
        : []
    logger.info(`→ ${resolved.label}`)
    const result = await spawn(
      resolved.cmd,
      [...resolved.args, ...extraFlags],
      { stdio: 'inherit' },
    )
    if (result.code !== 0) {
      throw new Error(`${resolved.label} failed (exit ${result.code})`)
    }
  }
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

  const placeholders = resolvePlaceholders({
    upstreamDir: UPSTREAM_DIR,
    cmakeBuildDir,
    outLibDir,
    outIncludeDir,
  })

  await runSteps(placeholders)
  await publishArtifacts(placeholders, outLibDir, outIncludeDir)

  logger.success(
    `BoringSSL built with prefix '${PREFIX}' → ${path.dirname(outLibDir)}`,
  )
}

main().catch(error => {
  logger.fail(`Build failed: ${errorMessage(error)}`)
  process.exitCode = 1
})
