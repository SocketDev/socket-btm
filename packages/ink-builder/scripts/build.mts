/**
 * Build script for prepatched ink — zero-dep ESM bundle.
 *
 * Pipeline:
 *   1. Install upstream ink + its runtime deps into a local
 *      build/_dlx/ tree via @socketsecurity/lib/dlx/package's
 *      ensurePackageInstalled (Arborist programmatic, not npm/pnpm
 *      subprocess — includes Socket Firewall checks against ink's
 *      transitive deps). The installRoot option keeps the install
 *      colocated with our build outputs (gitignored under build/)
 *      instead of in ~/.socket/_dlx so esbuild's resolver can walk
 *      the node_modules tree directly.
 *   2. Apply our patches in-place (signal-exit import fix, devtools
 *      top-level-await removal — see patches/).
 *   3. Bundle with esbuild from build/index.js → dist/index.js.
 *      - Externals: react family + react-devtools-core (peer deps; must
 *        come from the consumer's tree to avoid React-singleton breakage).
 *      - Everything else inlined: signal-exit, chalk, cli-cursor, etc.
 *      - yoga-layout is resolved via plugin alias to yoga-layout-builder's
 *        synchronous yoga-sync.mjs (no separate copy/rewire step).
 *   4. Copy ink's published .d.ts files to dist/build/ verbatim — types
 *      track upstream's multi-file structure, runtime is a single bundle.
 *
 * sources.ink in package.json tracks the GitHub ref for traceability;
 * the install pulls from npm to skip the TS compile step.
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { build as esbuild } from 'esbuild'

import { applyPatchDirectory } from 'build-infra/lib/patch-validator'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getBuildPaths as getYogaBuildPaths } from 'yoga-layout-builder/scripts/paths'

import { ensurePackageInstalled } from '@socketsecurity/lib/dlx/package'
import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { createNodeProtocolPlugin } from '../.config/esbuild/node-protocol.mts'
import { createPathShorteningPlugin } from '../.config/esbuild/shorten-paths.mts'
import { BUILD_DIR, DIST_DIR, PACKAGE_ROOT } from './paths.mts'

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

  // Install ink + its runtime deps into build/_dlx via Arborist
  // (programmatic, no npm/pnpm subprocess). force: true ensures a
  // clean install each run — patches are applied in place and we
  // don't want to inherit a previously-patched cache. installRoot
  // points Arborist at our local build/ tree (gitignored) instead
  // of ~/.socket/_dlx, so esbuild's resolver can walk the resulting
  // node_modules directly.
  logger.step(`Installing ink@${inkVersion}`)
  const installRoot = path.join(BUILD_DIR, '_dlx')
  await safeMkdir(installRoot)
  const { packageDir } = await ensurePackageInstalled(
    'ink',
    `ink@${inkVersion}`,
    true,
    { installRoot },
  )
  // Arborist installs at <installRoot>/node_modules/<packageName>/.
  // packageDir === installRoot per the option's contract, so the
  // actual ink package lives one segment deeper.
  const inkPackageDir = path.join(packageDir, 'node_modules', 'ink')
  logger.success(`Installed ink to ${inkPackageDir}`)

  // Apply patches (ordered numeric-prefix series, applied in filename order).
  logger.step('Applying patches')
  const patchesDir = path.join(PACKAGE_ROOT, 'patches')
  if (existsSync(patchesDir)) {
    await applyPatchDirectory(patchesDir, inkPackageDir, { validate: true })
    logger.success('Applied patches')
  } else {
    logger.warn(`No patches directory found for ink@${inkVersion}`)
  }

  // Bundle ink's patched JS into a single ESM file.
  logger.step('Bundling with esbuild')
  await safeDelete(DIST_DIR)
  await safeMkdir(DIST_DIR)

  const inkEntry = path.join(inkPackageDir, 'build', 'index.js')
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
  const srcBuild = path.join(inkPackageDir, 'build')
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
