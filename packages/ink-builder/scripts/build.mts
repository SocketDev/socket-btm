/**
 * Build script for prepatched ink.
 *
 * Downloads ink from npm (pre-built), applies patches, rewires yoga-layout
 * imports to use socket-btm's synchronous yoga-sync, and outputs to dist/.
 *
 * Note: sources.ink in package.json tracks the GitHub ref for reference,
 * but we download from npm to get pre-built JavaScript (avoids TypeScript build).
 */

import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'
import { errorMessage } from 'build-infra/lib/error-utils'

import { safeDelete, safeMkdir } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { BUILD_DIR, DIST_DIR, PACKAGE_ROOT, PATCHES_DIR } from './paths.mts'

const logger = getDefaultLogger()

// Files in ink that import yoga-layout.
const YOGA_IMPORT_FILES = [
  'build/ink.js',
  'build/dom.js',
  'build/get-max-width.js',
  'build/styles.js',
  'build/render-node-to-output.js',
  'build/reconciler.js',
]

async function main() {
  logger.step('Building prepatched ink')

  // Read package.json for source version.
  const packageJsonPath = path.join(PACKAGE_ROOT, 'package.json')
  let packageJson
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Failed to parse package.json at ${packageJsonPath}: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  const inkVersion = packageJson.sources.ink.version

  logger.log(`Target version: ink@${inkVersion}`)

  // Create build directory.
  await safeMkdir(BUILD_DIR)

  // Download ink tarball from npm (pre-built JavaScript).
  // Note: sources.ink in package.json tracks the GitHub ref for reference,
  // but we download from npm to get pre-built JavaScript.
  logger.step(`Downloading ink@${inkVersion} from npm`)
  const tarballName = `ink-${inkVersion}.tgz`
  const tarballPath = path.join(BUILD_DIR, tarballName)

  if (!existsSync(tarballPath)) {
    const packResult = await spawn(
      'npm',
      ['pack', `ink@${inkVersion}`, '--pack-destination', BUILD_DIR],
      {
        cwd: PACKAGE_ROOT,
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

  // npm tarball extracts to 'package' directory
  logger.success('Extracted ink')

  const packageDir = path.join(extractDir, 'package')

  // Apply patches.
  logger.step('Applying patches')
  const patchFile = path.join(PATCHES_DIR, `ink@${inkVersion}.patch`)
  if (existsSync(patchFile)) {
    const patchResult = await spawn('patch', ['-p1', '-i', patchFile], {
      cwd: packageDir,
      stdio: 'pipe',
    })
    if (patchResult.exitCode !== 0) {
      throw new Error(`Failed to apply patch: ${patchResult.stderr}`)
    }
    logger.success('Applied patches')
  } else {
    logger.warn(`No patch file found for ink@${inkVersion}`)
  }

  // Rewire yoga-layout imports to use bundled yoga-sync.
  logger.step('Rewiring yoga-layout imports')

  for (const file of YOGA_IMPORT_FILES) {
    const filePath = path.join(packageDir, file)
    if (!existsSync(filePath)) {
      logger.warn(`File not found: ${file}`)
      continue
    }

    let content = await fs.readFile(filePath, 'utf8')
    // Replace yoga-layout import with relative path to bundled yoga-sync.
    // Files are in build/, yoga-sync will be in build/yoga-sync.mjs.
    content = content.replace(
      /import Yoga from ['"]yoga-layout['"];?/g,
      "import Yoga from './yoga-sync.mjs';",
    )
    await fs.writeFile(filePath, content)
  }
  logger.success('Rewired yoga-layout imports')

  // Copy yoga-sync from yoga-layout-builder.
  logger.step('Bundling yoga-sync')
  const yogaBuilderDir = path.join(PACKAGE_ROOT, '..', 'yoga-layout-builder')
  const yogaSyncDest = path.join(packageDir, 'build', 'yoga-sync.mjs')
  const platformArch = await getCurrentPlatformArch()

  // Try prod build first, fall back to dev.
  let yogaSyncSource = path.join(
    yogaBuilderDir,
    'build',
    'prod',
    platformArch,
    'out',
    'Final',
    'yoga-sync.mjs',
  )
  if (!existsSync(yogaSyncSource)) {
    yogaSyncSource = path.join(
      yogaBuilderDir,
      'build',
      'dev',
      platformArch,
      'out',
      'Final',
      'yoga-sync.mjs',
    )
  }

  if (!existsSync(yogaSyncSource)) {
    throw new Error(
      `yoga-sync.mjs not found. Run yoga-layout-builder build first.`,
    )
  }
  logger.log(`Using yoga-sync from: ${yogaSyncSource}`)

  await fs.copyFile(yogaSyncSource, yogaSyncDest)
  logger.success('Bundled yoga-sync.mjs')

  // Copy to dist.
  logger.step('Creating dist output')
  await safeDelete(DIST_DIR)
  await fs.cp(packageDir, DIST_DIR, { recursive: true })

  // Update package.json in dist.
  const distPackageJsonPath = path.join(DIST_DIR, 'package.json')
  let distPackageJson
  try {
    distPackageJson = JSON.parse(await fs.readFile(distPackageJsonPath, 'utf8'))
  } catch (error) {
    throw new Error(
      `Failed to parse package.json at ${distPackageJsonPath}: ${errorMessage(error)}`,
      { cause: error },
    )
  }
  distPackageJson._prepatched = true
  distPackageJson._patchedBy = 'socket-btm'
  // Remove yoga-layout dependency since it's now bundled.
  if (distPackageJson.dependencies) {
    delete distPackageJson.dependencies['yoga-layout']
  }
  await fs.writeFile(
    distPackageJsonPath,
    JSON.stringify(distPackageJson, null, 2) + '\n',
  )

  logger.success('Build complete')
  logger.log(`Output: ${DIST_DIR}`)
  logger.log('Includes: bundled yoga-sync.mjs (no yoga-layout dependency)')
}

main().catch(error => {
  logger.error('Build failed:', errorMessage(error))
  process.exitCode = 1
})
