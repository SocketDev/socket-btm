/**
 * Prepare external sources for Node.js build.
 * Copies binject-core sources from monorepo packages to additions/ directory.
 * Syncs vendored npm packages (fast-webstreams) from npm registry.
 */

import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mjs'
import {
  BINJECT_DIR,
  BIN_INFRA_DIR,
  BUILD_INFRA_DIR,
  PACKAGE_ROOT,
} from '../../paths.mjs'

const logger = getDefaultLogger()

/**
 * External source mappings using absolute paths.
 * Copies whole directory trees preserving structure.
 * Note: Packages now use socketsecurity/ namespace in their src/ directories.
 * Note: sea-smol and vfs C++ files are already in additions/source-patched/src/socketsecurity/.
 */
const EXTERNAL_SOURCES = [
  {
    from: path.join(BINJECT_DIR, 'src', 'socketsecurity', 'binject'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'binject',
    ),
  },
  {
    from: path.join(BIN_INFRA_DIR, 'src', 'socketsecurity', 'bin-infra'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'bin-infra',
    ),
  },
  {
    from: path.join(BUILD_INFRA_DIR, 'src', 'socketsecurity', 'build-infra'),
    to: path.join(
      ADDITIONS_SOURCE_PATCHED_DIR,
      'src',
      'socketsecurity',
      'build-infra',
    ),
  },
  {
    from: path.join(BIN_INFRA_DIR, 'upstream', 'lzfse', 'src'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'lzfse', 'src'),
  },
  {
    from: path.join(BINJECT_DIR, 'upstream', 'libdeflate'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'libdeflate'),
  },
]

/**
 * Compute hash of directory contents for sync validation.
 * @param {string} dirPath - Directory to hash
 * @returns {Promise<string|undefined>} Hash of directory contents, or undefined if directory doesn't exist
 */
async function computeDirectoryHash(dirPath) {
  if (!existsSync(dirPath)) {
    return undefined
  }

  const files = []
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else if (entry.isFile()) {
        const content = await fs.readFile(fullPath)
        const relativePath = path.relative(dirPath, fullPath)
        files.push({ path: relativePath, content })
      }
    }
  }

  await walk(dirPath)

  // Sort by path for deterministic hashing
  files.sort((a, b) => a.path.localeCompare(b.path))

  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.path)
    hash.update(file.content)
  }

  return hash.digest('hex')
}

/**
 * Validate that additions directory is in sync with source packages.
 * Only validates socketsecurity/ source packages, NOT upstream dependencies.
 * Throws error if directories are out of sync.
 */
async function validateAdditionsSync() {
  logger.substep(
    'Validating additions directory is in sync with source packages',
  )

  for (const { from, to } of EXTERNAL_SOURCES) {
    if (!existsSync(from)) {
      throw new Error(`Source directory not found: ${from}`)
    }

    // Only validate socketsecurity source packages (binject, bin-infra, build-infra).
    // Skip upstream dependencies (lzfse, libdeflate) which come from git submodules.
    if (!from.includes('socketsecurity')) {
      continue
    }

    const fromHash = await computeDirectoryHash(from)
    const toHash = await computeDirectoryHash(to)

    // Skip validation if target doesn't exist yet (will be created during copy)
    if (toHash === undefined) {
      continue
    }

    if (fromHash !== toHash) {
      const relativeFrom = path.relative(process.cwd(), from)
      const relativeTo = path.relative(process.cwd(), to)
      throw new Error(
        'Additions directory out of sync!\n' +
          `  Source: ${relativeFrom}\n` +
          `  Target: ${relativeTo}\n` +
          '  Run: pnpm --filter node-smol-builder clean && pnpm --filter node-smol-builder build',
      )
    }
  }

  logger.success('Additions directory is in sync with source packages')
}

/**
 * Sync vendored npm packages from npm registry.
 * These are external packages that need ES→CJS conversion for Node.js additions.
 */
async function syncVendoredPackages() {
  logger.step('Syncing Vendored Packages')

  // Sync fast-webstreams from npm registry.
  const syncScript = path.join(
    PACKAGE_ROOT,
    'scripts',
    'vendor-fast-webstreams',
    'sync.mjs',
  )

  if (!existsSync(syncScript)) {
    throw new Error(`Vendor sync script not found: ${syncScript}`)
  }

  try {
    await spawn('node', [syncScript], {
      cwd: PACKAGE_ROOT,
      stdio: 'inherit',
    })
    logger.success('Synced fast-webstreams from npm registry')
  } catch (error) {
    throw new Error(`Failed to sync fast-webstreams: ${error.message}`)
  }

  logger.log('')
}

/**
 * Prepare external sources by copying them to additions directory.
 * Copies whole directory trees using fs.cp() with recursive flag.
 *
 * This is called before copyBuildAdditions() to ensure external sources
 * are available in the additions/ directory tree.
 */
export async function prepareExternalSources() {
  logger.step('Preparing External Sources')

  // Validate additions directory is in sync before copying
  await validateAdditionsSync()

  logger.log('')

  for (const { from, to } of EXTERNAL_SOURCES) {
    if (!existsSync(from)) {
      throw new Error(`External source directory not found: ${from}`)
    }

    // Use fs.cp with recursive flag to copy entire directory tree.
    await fs.cp(from, to, { recursive: true })

    const relativeFrom = path.relative(process.cwd(), from)
    logger.success(`Copied directory tree from ${relativeFrom}`)
  }

  logger.log('')

  // Sync vendored npm packages after copying external sources.
  await syncVendoredPackages()
}
