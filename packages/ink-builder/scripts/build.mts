/**
 * Build script for prepatched ink — zero-dep ESM bundle.
 *
 * Pipeline:
 *   1. Download the upstream ink tarball from npm (pre-built JS, no TS step).
 *   2. Extract.
 *   3. Apply our patches (signal-exit import fix, devtools top-level-await
 *      removal — see patches/).
 *   4. Bundle with esbuild from build/index.js → dist/index.js.
 *      - Externals: react family + react-devtools-core (peer deps; must
 *        come from the consumer's tree to avoid React-singleton breakage).
 *      - Everything else inlined: signal-exit, chalk, cli-cursor, etc.
 *      - yoga-layout is resolved via plugin alias to yoga-layout-builder's
 *        synchronous yoga-sync.mjs (no separate copy/rewire step).
 *   5. Copy ink's published .d.ts files to dist/build/ verbatim — types
 *      track upstream's multi-file structure, runtime is a single bundle.
 *
 * sources.ink in package.json tracks the GitHub ref for traceability;
 * the build downloads from npm to skip the TS compile step.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { build as esbuild } from 'esbuild'

import { applyPatchDirectory } from 'build-infra/lib/patch-validator'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getBuildPaths as getYogaBuildPaths } from 'yoga-layout-builder/scripts/paths'

import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { createNodeProtocolPlugin } from '../.config/esbuild/node-protocol.mts'
import { createPathShorteningPlugin } from '../.config/esbuild/shorten-paths.mts'
import { BUILD_DIR, DIST_DIR, PACKAGE_ROOT, PATCHES_DIR } from './paths.mts'

const logger = getDefaultLogger()

// React + react-reconciler + scheduler + react-devtools-core must stay
// external. They're peer deps that consumers control; bundling them in
// would create two React copies in the consumer's process and break
// hooks. react-devtools-core is opt-in (peerDependenciesMeta optional),
// so it's external too — bundling it would force devtools into every
// consumer.
const EXTERNAL_PEERS = [
  'react',
  'react-reconciler',
  'scheduler',
  'react-devtools-core',
]

/**
 * esbuild plugin: alias `yoga-layout` → yoga-layout-builder's synchronous
 * yoga-sync.mjs. Replaces the old per-file string-rewriting loop with one
 * resolver hook. yoga-sync is built per-platform-arch; the resolver picks
 * the prod build first, falls back to dev.
 */
function createYogaResolverPlugin() {
  return {
    name: 'yoga-resolver',
    async setup(build: import('esbuild').PluginBuild) {
      const platformArch = await getCurrentPlatformArch()
      let yogaSyncSource =
        getYogaBuildPaths('prod', platformArch).outputSyncMjsFile
      if (!existsSync(yogaSyncSource)) {
        yogaSyncSource = getYogaBuildPaths('dev', platformArch).outputSyncMjsFile
      }
      if (!existsSync(yogaSyncSource)) {
        throw new Error(
          `yoga-sync.mjs not found at ${yogaSyncSource}. ` +
            `Run yoga-layout-builder's build first.`,
        )
      }
      logger.log(`Resolving yoga-layout → ${yogaSyncSource}`)
      build.onResolve({ filter: /^yoga-layout$/ }, () => ({
        path: yogaSyncSource,
      }))
    },
  }
}

async function main() {
  logger.step('Building prepatched ink')

  // Read package.json for source version.
  const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (e) {
    throw new Error(
      `Failed to parse package.json at ${packageJsonPath}: ${errorMessage(e)}`,
      { cause: e },
    )
  }
  const inkVersion = packageJson.sources.ink.version

  logger.log(`Target version: ink@${inkVersion}`)

  await safeMkdir(BUILD_DIR)

  // Download ink tarball from npm (pre-built JavaScript).
  logger.step(`Downloading ink@${inkVersion} from npm`)
  const tarballName = `ink-${inkVersion}.tgz`
  const tarballPath = path.join(BUILD_DIR, tarballName)

  if (!existsSync(tarballPath)) {
    const packResult = await spawn(
      'npm',
      ['pack', `ink@${inkVersion}`, '--pack-destination', BUILD_DIR],
      {
        cwd: PACKAGE_ROOT,
        shell: WIN32,
        stdio: 'pipe',
      },
    )
    if (packResult.exitCode !== 0) {
      throw new Error(`Failed to download ink: ${packResult.stderr}`)
    }
    logger.success('Downloaded ink tarball from npm')
  } else {
    logger.log('Using cached tarball')
  }

  // Extract tarball.
  logger.step('Extracting ink')
  const extractDir = path.join(BUILD_DIR, 'extracted')
  await safeDelete(extractDir)
  await safeMkdir(extractDir)

  const tarResult = await spawn(
    'tar',
    ['-xzf', tarballPath, '-C', extractDir],
    {
      cwd: BUILD_DIR,
      stdio: 'pipe',
    },
  )
  if (tarResult.exitCode !== 0) {
    throw new Error(`Failed to extract ink: ${tarResult.stderr}`)
  }
  logger.success('Extracted ink')

  const packageDir = path.join(extractDir, 'package')

  // Apply patches (ordered numeric-prefix series, applied in filename order).
  logger.step('Applying patches')
  if (existsSync(PATCHES_DIR)) {
    await applyPatchDirectory(PATCHES_DIR, packageDir, { validate: true })
    logger.success('Applied patches')
  } else {
    logger.warn(`No patches directory found for ink@${inkVersion}`)
  }

  // Install ink's runtime deps into the extracted package so esbuild can
  // resolve them. We DON'T install dev/peer deps — react and friends stay
  // external; ink's actual runtime deps (chalk, cli-cursor, signal-exit,
  // stack-utils, etc.) get inlined into our bundle.
  logger.step("Installing ink's runtime dependencies")
  const installResult = await spawn(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--omit=dev',
      '--omit=optional',
      '--omit=peer',
    ],
    {
      cwd: packageDir,
      shell: WIN32,
      stdio: 'pipe',
    },
  )
  if (installResult.exitCode !== 0) {
    throw new Error(
      `Failed to install ink's runtime deps: ${installResult.stderr}`,
    )
  }
  logger.success("Installed ink's runtime dependencies")

  // Bundle ink's patched JS into a single ESM file.
  logger.step('Bundling with esbuild')
  await safeDelete(DIST_DIR)
  await safeMkdir(DIST_DIR)

  const inkEntry = path.join(packageDir, 'build', 'index.js')
  if (!existsSync(inkEntry)) {
    throw new Error(`ink entry not found at ${inkEntry}`)
  }

  const result = await esbuild({
    entryPoints: [inkEntry],
    outfile: path.join(DIST_DIR, 'index.js'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    sourcemap: false,
    minify: false,
    treeShaking: true,
    metafile: true,
    logLevel: 'warning',
    external: EXTERNAL_PEERS,
    plugins: [
      createYogaResolverPlugin(),
      createNodeProtocolPlugin(),
      createPathShorteningPlugin(),
    ],
  })

  const outBytes = result.metafile?.outputs[
    path.relative(PACKAGE_ROOT, path.join(DIST_DIR, 'index.js'))
  ]?.bytes
  if (outBytes) {
    logger.success(`Bundled (${(outBytes / 1024).toFixed(1)} KB)`)
  } else {
    logger.success('Bundled')
  }

  // Copy ink's published .d.ts files. Keep them in build/ so consumers'
  // tooling resolves the same names ink uses internally.
  logger.step('Copying type declarations')
  const srcBuild = path.join(packageDir, 'build')
  const dstBuild = path.join(DIST_DIR, 'build')
  await safeMkdir(dstBuild)
  for (const entry of await fs.readdir(srcBuild)) {
    if (entry.endsWith('.d.ts')) {
      await fs.copyFile(path.join(srcBuild, entry), path.join(dstBuild, entry))
    }
  }
  logger.success('Copied type declarations')

  logger.success('Build complete')
  logger.log(`Output: ${DIST_DIR}`)
  logger.log('Single ESM bundle, externals: react family only')
}

main().catch(error => {
  logger.error('Build failed:', errorMessage(error))
  process.exitCode = 1
})
