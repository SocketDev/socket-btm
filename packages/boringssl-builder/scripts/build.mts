#!/usr/bin/env node
/**
 * boringssl-builder native build orchestrator. Used on macOS / Windows
 * AND Linux-native runs (where the container path is not taken).
 *
 * Linux-container builds run docker/build.sh inside manylinux2014 — that
 * script is generated from build-step-defs.mts, so the two paths share
 * the same build commands. See emit-docker-build.mts.
 *
 * Output:
 *   build/<mode>/<platform-arch>/out/Final/
 *   ├── lib/{libsmol_crypto.a, libsmol_ssl.a}  (or smol_*.lib on MSVC)
 *   └── include/openssl/...
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
import { PREFIX, UPSTREAM_DIR, getPaths } from './paths.mts'

const logger = getDefaultLogger()

// MSVC-specific cmake flags. BoringSSL builds with /WX (warnings-as-
// errors); upstream's pqcrypto code (mldsa.cc.inc) uses `#pragma GCC`
// directives which MSVC flags as C4068 (unknown pragma). Suppress the
// warning so we don't fork BoringSSL just for a noisy MSVC quirk.
const MSVC_EXTRA_CMAKE_FLAGS = [
  '-DCMAKE_C_FLAGS=/wd4068',
  '-DCMAKE_CXX_FLAGS=/wd4068',
]

async function runSteps(placeholders: Record<string, string>): Promise<void> {
  for (const step of BUILD_STEPS) {
    const resolved = substituteStep(step, placeholders)
    const isCmakeConfigure =
      resolved.cmd === 'cmake' && resolved.args.includes('-S')
    const extraFlags =
      process.platform === 'win32' && isCmakeConfigure
        ? MSVC_EXTRA_CMAKE_FLAGS
        : []
    logger.info(`→ ${resolved.label}`)
    const result = await spawn(
      resolved.cmd,
      [...resolved.args, ...extraFlags],
      { stdio: 'inherit' },
    )
    if (result.exitCode !== 0) {
      throw new Error(`${resolved.label} failed (exit ${result.exitCode})`)
    }
  }
}

async function publishArtifacts(
  placeholders: Record<string, string>,
  outLibDir: string,
  outIncludeDir: string,
): Promise<void> {
  mkdirSync(outLibDir, { recursive: true })
  mkdirSync(outIncludeDir, { recursive: true })

  // PUBLISH_ARTIFACTS lists libcrypto.a → libsmol_crypto.a (Unix names).
  // On MSVC the names become smol_crypto.lib — handle that swap before
  // resolving placeholders so the rest of the logic stays uniform.
  const platLibSuffix = process.platform === 'win32' ? '.lib' : '.a'
  const platLibPrefix = process.platform === 'win32' ? '' : 'lib'
  for (const art of PUBLISH_ARTIFACTS) {
    const resolved = substituteArtifact(art, placeholders)
    // Swap .a → .lib + drop "lib" prefix on Windows.
    const from = resolved.from
      .replace(/lib(crypto|ssl)\.a$/, `${platLibPrefix}$1${platLibSuffix}`)
    const to = resolved.to
      .replace(
        new RegExp(`lib${PREFIX}_(crypto|ssl)\\.a$`),
        `${platLibPrefix}${PREFIX}_$1${platLibSuffix}`,
      )
    if (!existsSync(from)) {
      throw new Error(`Expected build artifact not found: ${from}`)
    }
    await fs.copyFile(from, to)
    logger.substep(`copied ${path.basename(from)} → ${path.basename(to)}`)
  }

  // Header tree copy. PUBLISH_HEADERS.fromSubdir is relative to upstream.
  const headerSrc = path.join(UPSTREAM_DIR, PUBLISH_HEADERS.fromSubdir)
  const headerDest =
    PUBLISH_HEADERS.toSubdir === '.'
      ? outIncludeDir
      : path.join(outIncludeDir, PUBLISH_HEADERS.toSubdir)
  await fs.mkdir(path.dirname(headerDest), { recursive: true })
  await fs.cp(headerSrc, headerDest, { recursive: true, force: true })
  logger.substep(`copied include/ tree → ${headerDest}`)
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
