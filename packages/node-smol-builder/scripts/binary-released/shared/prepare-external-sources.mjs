/**
 * Prepare external sources for Node.js build.
 * Copies binject-core sources from monorepo packages to additions/ directory.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { ADDITIONS_SOURCE_PATCHED_DIR } from './paths.mjs'
import { BINJECT_DIR, BIN_INFRA_DIR, BUILD_INFRA_DIR } from '../../paths.mjs'

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
 * Prepare external sources by copying them to additions directory.
 * Copies whole directory trees using fs.cp() with recursive flag.
 *
 * This is called before copyBuildAdditions() to ensure external sources
 * are available in the additions/ directory tree.
 */
export async function prepareExternalSources() {
  logger.step('Preparing External Sources')

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
}
