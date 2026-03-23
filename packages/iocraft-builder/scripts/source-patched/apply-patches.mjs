/**
 * Apply patches to iocraft source.
 * Creates SOURCE_PATCHED checkpoint.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { applyPatchDirectory } from 'build-infra/lib/patch-validator'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { safeMkdir } from '@socketsecurity/lib/fs'

import { PACKAGE_ROOT, getBuildPaths, getSharedBuildPaths } from '../paths.mjs'

const logger = getDefaultLogger()

/**
 * Apply patches to iocraft source.
 * @param {string} platformArch - Platform-arch identifier
 * @param {string} buildMode - Build mode ('dev' or 'prod')
 * @returns {Promise<void>}
 */
export async function applyPatches(platformArch, buildMode) {
  if (!buildMode) {
    throw new Error('applyPatches requires buildMode parameter')
  }
  const { sourceCopiedDir } = getSharedBuildPaths()
  const { buildDir, sourcePatchedDir } = getBuildPaths(buildMode, platformArch)
  const patchesDir = path.join(PACKAGE_ROOT, 'patches')

  logger.info('Applying iocraft patches...')

  await safeMkdir(sourcePatchedDir, { recursive: true })

  await fs.cp(sourceCopiedDir, sourcePatchedDir, {
    force: true,
    recursive: true,
  })

  if (existsSync(patchesDir)) {
    logger.info(`Applying patches from ${patchesDir}...`)
    await applyPatchDirectory(patchesDir, sourcePatchedDir, { validate: true })
    logger.success('All iocraft patches applied')
  } else {
    logger.info('No patches directory found, skipping')
  }

  logger.info('Copying build files to patched source...')
  const packageRoot = PACKAGE_ROOT
  await fs.cp(path.join(packageRoot, 'src'), path.join(sourcePatchedDir, 'src'), {
    force: true,
    recursive: true,
  })

  const wrapperCargoToml = `[package]
name = "iocraft-node"
version = "0.1.0"
edition = "2021"
description = "Node.js bindings for iocraft TUI library"
license = "MIT"
publish = false

[lib]
crate-type = ["cdylib"]

[dependencies]
crossterm = "0.29"
iocraft = { path = "packages/iocraft" }
itoa = "1"
mimalloc = "0.1"
napi = { version = "3", default-features = false, features = ["napi9", "tokio_rt", "serde-json"] }
napi-derive = "3"
parking_lot = "0.12"
phf = { version = "0.11", features = ["macros"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
smallvec = { version = "1", features = ["union", "const_generics"] }
thiserror = "2"
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }

[build-dependencies]
napi-build = "2"

[profile.release]
lto = "fat"
codegen-units = 1
opt-level = 3
panic = "abort"
strip = true
overflow-checks = false

[profile.dev.package."*"]
opt-level = 2
`

  await fs.writeFile(path.join(sourcePatchedDir, 'Cargo.toml'), wrapperCargoToml)

  await fs.copyFile(
    path.join(packageRoot, 'build.rs'),
    path.join(sourcePatchedDir, 'build.rs'),
  )

  logger.success('Build files copied')

  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_PATCHED,
    async () => {
      const cargoToml = await fs.readFile(
        path.join(sourcePatchedDir, 'Cargo.toml'),
        'utf8',
      )
      if (!cargoToml.includes('[package]')) {
        throw new Error('Invalid patched source: missing Cargo.toml [package]')
      }
    },
    { artifactPath: sourcePatchedDir },
  )
}
