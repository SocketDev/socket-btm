/**
 * Apply patches to OpenTUI source and inject build files.
 * Creates SOURCE_PATCHED checkpoint.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { createCheckpoint } from 'build-infra/lib/checkpoint-manager'
import { CHECKPOINTS } from 'build-infra/lib/constants'
import { applyPatchDirectory } from 'build-infra/lib/patch-validator'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { safeMkdir } from '@socketsecurity/lib/fs'

import {
  BUILD_ZIG,
  BUILD_ZIG_ZON,
  PACKAGE_ROOT,
  SRC_DIR,
  UUCODE_PATH,
  VENDOR_DIR,
  getBuildPaths,
  getSharedBuildPaths,
} from '../paths.mts'

const logger = getDefaultLogger()

/**
 * Apply patches to OpenTUI source and inject our build files.
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

  logger.info('Applying OpenTUI patches...')

  await safeMkdir(sourcePatchedDir, { recursive: true })

  // Copy pristine source to patched directory
  await fs.cp(sourceCopiedDir, sourcePatchedDir, {
    force: true,
    recursive: true,
  })

  // Apply any upstream patches
  if (existsSync(patchesDir)) {
    logger.info(`Applying patches from ${patchesDir}...`)
    await applyPatchDirectory(patchesDir, sourcePatchedDir, { validate: true })
    logger.success('All OpenTUI patches applied')
  } else {
    logger.info('No patches directory found, skipping')
  }

  // Inject our build files into the patched source
  logger.info('Copying build files to patched source...')

  // Copy our wrapper build.zig (replaces upstream build.zig)
  await fs.copyFile(BUILD_ZIG, path.join(sourcePatchedDir, 'build.zig'))

  // Copy build.zig.zon
  await fs.copyFile(BUILD_ZIG_ZON, path.join(sourcePatchedDir, 'build.zig.zon'))

  // Copy our Zig source files (node-api bindings)
  await fs.cp(SRC_DIR, path.join(sourcePatchedDir, 'src'), {
    force: true,
    recursive: true,
  })

  // Copy vendored node-api headers
  const vendorDest = path.join(sourcePatchedDir, 'vendor')
  await safeMkdir(vendorDest, { recursive: true })
  await fs.cp(VENDOR_DIR, vendorDest, {
    force: true,
    recursive: true,
  })

  // Copy vendored Zig dependencies into the patched tree so build.zig.zon
  // can resolve them via `.path = "dependencies/<name>"` — no network
  // fetch at `zig build` time. The submodule under upstream/uucode/ is
  // initialized by the opentui.yml init-submodules step.
  const uucodeDest = path.join(sourcePatchedDir, 'dependencies', 'uucode')
  await safeMkdir(uucodeDest, { recursive: true })
  await fs.cp(UUCODE_PATH, uucodeDest, {
    filter: source => !source.includes(`${path.sep}.git`),
    force: true,
    recursive: true,
  })

  // Normalize CRLF → LF on uucode's text data files. uucode's UCD
  // parser (src/build/Ucd.zig) trims only ` ` and `\t`, not `\r`, so a
  // Windows runner with core.autocrlf=true (the Git-for-Windows
  // default) would leave stray `\r` in every field and break
  // parseInt. Upstream uucode has no .gitattributes of its own, and
  // the parent .gitattributes doesn't govern submodule checkouts, so
  // we normalize on copy here — cheapest point that covers both CI
  // and local-Windows dev without patching upstream source.
  const uucodeUcdDir = path.join(uucodeDest, 'ucd')
  if (existsSync(uucodeUcdDir)) {
    const normalizeDir = async dir => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      await Promise.all(
        entries.map(async entry => {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await normalizeDir(full)
          } else if (entry.isFile() && entry.name.endsWith('.txt')) {
            const buf = await fs.readFile(full)
            if (buf.includes(13)) {
              await fs.writeFile(full, buf.toString('utf8').replace(/\r\n/g, '\n'))
            }
          }
        }),
      )
    }
    await normalizeDir(uucodeUcdDir)
  }

  logger.success('Build files copied')

  await createCheckpoint(
    buildDir,
    CHECKPOINTS.SOURCE_PATCHED,
    async () => {
      const buildZig = path.join(sourcePatchedDir, 'build.zig')
      const content = await fs.readFile(buildZig, 'utf8')
      if (!content.includes('node_api_entry')) {
        throw new Error(
          'Invalid patched source: build.zig missing node_api_entry reference',
        )
      }
    },
    { artifactPath: sourcePatchedDir },
  )
}
