/**
 * Prepare external sources for Node.js build.
 * Copies binject-core sources from monorepo packages to additions/ directory.
 * Syncs vendored npm packages (fast-webstreams) from npm registry.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib/fs'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mts'
import { errorMessage } from 'build-infra/lib/error-utils'
import {
  BINJECT_DIR,
  BIN_INFRA_DIR,
  BUILD_INFRA_DIR,
  LIEF_BUILDER_DIR,
  PACKAGE_ROOT,
} from '../../paths.mts'

// Upstream liburing is in node-smol-builder/upstream/liburing (sibling to upstream/node).
const LIBURING_UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'liburing')

// Upstream uSockets/uWebSockets for high-performance HTTP server (node:smol-http).
// uSockets provides direct epoll/kqueue event loop + raw socket I/O.
// uWebSockets provides HTTP parser (SWAR+bloom), cork buffer, response writer.
const USOCKETS_UPSTREAM_DIR = path.join(PACKAGE_ROOT, 'upstream', 'uSockets')
const UWEBSOCKETS_UPSTREAM_DIR = path.join(
  PACKAGE_ROOT,
  'upstream',
  'uWebSockets',
)

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
    from: path.join(BINJECT_DIR, 'upstream', 'libdeflate'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'libdeflate'),
  },
  // liburing: Linux io_uring library (upstream pinned in node-smol-builder/upstream/liburing).
  // Only the src/ directory is needed (contains sources and include/).
  // Only included on Linux where io_uring is available.
  ...(process.platform === 'linux'
    ? [
        {
          from: path.join(LIBURING_UPSTREAM_DIR, 'src'),
          to: path.join(
            ADDITIONS_SOURCE_PATCHED_DIR,
            'deps',
            'liburing',
            'src',
          ),
        },
      ]
    : []),
  // uSockets: High-performance socket library with libuv backend.
  // Provides direct event loop integration, raw socket I/O, and TCP optimizations.
  // We include the full src/ directory (C sources + internal headers).
  {
    from: path.join(USOCKETS_UPSTREAM_DIR, 'src'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'uSockets', 'src'),
  },
  // uWebSockets: High-performance HTTP/WebSocket library (header-only C++).
  // Provides custom SWAR HTTP parser, 16KB cork buffer, bloom filter headers,
  // zero-copy request parsing, and direct response writing.
  {
    from: path.join(UWEBSOCKETS_UPSTREAM_DIR, 'src'),
    to: path.join(ADDITIONS_SOURCE_PATCHED_DIR, 'deps', 'uWebSockets', 'src'),
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
        // Normalize separators so hashes match between Windows and POSIX.
        const relativePath = path
          .relative(dirPath, fullPath)
          .split(path.sep)
          .join('/')
        files.push({ content, path: relativePath })
      }
    }
  }

  await walk(dirPath)

  // Sort by path for deterministic hashing
  files.sort((a, b) => a.path.localeCompare(b.path))

  const hash = crypto.createHash('sha256')
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
        `Additions mirror does not match source after copy: ${relativeTo} drifted from ${relativeFrom}. ` +
          'This indicates a concurrent writer or an unreadable source file; ' +
          'verify the source tree is quiescent and rerun the build.',
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
    'sync.mts',
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
  } catch (e) {
    throw new Error(`Failed to sync fast-webstreams: ${errorMessage(e)}`, {
      cause: e,
    })
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

  // Re-sync targets from sources BEFORE validating. Targets under
  // additions/source-patched/src/socketsecurity/* are gitignored and
  // can be stale from a previous run; running the copy first makes
  // validateAdditionsSync() a post-condition check (did the copy land?)
  // instead of a precondition that aborts whenever the working tree is
  // out of date. Use `recursive: true` + `force: true` so existing
  // target files are overwritten; orphan files left from a prior
  // source layout are cleaned up by the explicit prune below.
  for (const { from, to } of EXTERNAL_SOURCES) {
    if (!existsSync(from)) {
      throw new Error(`External source directory not found: ${from}`)
    }

    // Only prune orphan files for socketsecurity source packages;
    // upstream submodule targets (lzfse, libdeflate) are managed by
    // their own sync scripts.
    if (from.includes('socketsecurity') && existsSync(to)) {
      await safeDelete(to)
    }

    await fs.cp(from, to, { recursive: true, force: true })

    const relativeFrom = path.relative(process.cwd(), from)
    logger.success(`Copied directory tree from ${relativeFrom}`)
  }

  logger.log('')

  // Verify the copy produced a byte-identical mirror. If this fails
  // now, something is wrong with the source tree itself (race with a
  // concurrent writer, unreadable file), not with our sync state.
  await validateAdditionsSync()

  logger.log('')

  // Sync vendored npm packages after copying external sources.
  await syncVendoredPackages()
}
