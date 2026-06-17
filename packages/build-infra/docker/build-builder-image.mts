#!/usr/bin/env node
/**
 * Build the btm-builder-glibc base image locally for inspection.
 *
 * Resolves NODE_VERSION + PNPM_VERSION + per-arch PNPM_ASSET + PNPM_SHA256
 * from .node-version + .build-context/registry-tools.json (the same sources
 * the CI publish workflow reads), then runs `docker build` with all build
 * args set.
 *
 * Use:
 * pnpm --filter build-infra run docker:builder-glibc.
 *
 * The published image is `ghcr.io/socketdev/btm-builder-glibc:<tag>` — tag
 * format `YYYY-MM-DD-<sha8>`. Local builds tag as `btm-builder-glibc:local`.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..')
const DOCKERFILE = path.join(__dirname, 'btm-builder-glibc.Dockerfile')

const args = process.argv.slice(2)
const tag = readArg('--tag') ?? 'btm-builder-glibc:local'
const platform = readArg('--platform') ?? 'linux/amd64'
const skipBuild = args.includes('--inspect-only')

main().catch(error => {
  logger.error(`build-builder-image: ${errorMessage(error)}`)
  process.exitCode = 1
})

async function main() {
  const nodeVersion = readNodeVersion()
  const { pnpmVersion, pnpmAsset, pnpmSha256 } = readPnpmTriple(platform)

  logger.info(`btm-builder-glibc build args:`)
  logger.info(`  NODE_VERSION:  ${nodeVersion}`)
  logger.info(`  PNPM_VERSION:  ${pnpmVersion}`)
  logger.info(`  PNPM_ASSET:    ${pnpmAsset}`)
  logger.info(`  PNPM_SHA256:   ${pnpmSha256}`)
  logger.info(`  TAG:           ${tag}`)
  logger.info(`  PLATFORM:      ${platform}`)

  if (skipBuild) {
    return
  }

  const result = await spawn(
    'docker',
    [
      'build',
      '--platform',
      platform,
      '--tag',
      tag,
      '--file',
      DOCKERFILE,
      '--build-arg',
      `NODE_VERSION=${nodeVersion}`,
      '--build-arg',
      `PNPM_VERSION=${pnpmVersion}`,
      '--build-arg',
      `PNPM_ASSET=${pnpmAsset}`,
      '--build-arg',
      `PNPM_SHA256=${pnpmSha256}`,
      '--build-arg',
      `CACHE_VERSION=local-${Date.now()}`,
      REPO_ROOT,
    ],
    { stdio: 'inherit' },
  )
  if (result.exitCode !== 0) {
    throw new Error(`docker build failed (exit ${result.exitCode})`)
  }
  logger.success(`built ${tag}`)
}

export function readArg(name) {
  const idx = args.indexOf(name)
  return idx === -1 || idx === args.length - 1 ? undefined : args[idx + 1]
}

export function readNodeVersion() {
  const file = path.join(REPO_ROOT, '.node-version')
  if (!existsSync(file)) {
    throw new Error(`.node-version not found at ${file}`)
  }
  return readFileSync(file, 'utf8').trim()
}

export function readPnpmTriple(platformSpec) {
  const file = path.join(REPO_ROOT, '.build-context', 'registry-tools.json')
  if (!existsSync(file)) {
    throw new Error(
      `${file} not found — run the CI publish workflow OR stage it manually: ` +
        `cp "$SOCKET_TOOL_CHECKSUMS_FILE" .build-context/registry-tools.json`,
    )
  }
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const arch = platformSpec.endsWith('/arm64') ? 'arm64' : 'x64'
  const platKey = `linux-${arch}`
  const entry = parsed.pnpm?.platforms?.[platKey]
  if (entry === undefined) {
    throw new Error(`registry-tools.json missing pnpm.platforms.${platKey}`)
  }
  const integrity = entry.integrity
  if (typeof integrity !== 'string' || !integrity.startsWith('sha256-')) {
    throw new Error(
      `pnpm.platforms.${platKey}.integrity malformed: ${integrity}`,
    )
  }
  const pnpmSha256 = Buffer.from(
    integrity.slice('sha256-'.length),
    'base64',
  ).toString('hex')
  return {
    pnpmVersion: parsed.pnpm.version,
    pnpmAsset: entry.asset,
    pnpmSha256,
  }
}
