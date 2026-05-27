#!/usr/bin/env node
/**
 * Verify LIEF release artifacts before archiving.
 * Called by CI workflow to ensure all required files are present.
 *
 * Usage: node scripts/verify-release.mts <directory>
 *
 * Intentionally self-contained — no imports from workspace packages.
 * The CI step (`- name: Verify release artifacts`) invokes
 * `node packages/lief-builder/scripts/verify-release.mts <dir>`
 * directly at the repo root, so Node's ESM resolver walks up from
 * this file looking for `node_modules/build-infra`. That symlink has
 * been observed missing on darwin-x64 runs, and diagnosing the
 * symlink failure isn't worth it for a script that only does four
 * existsSync checks. Keeping this file standalone removes an entire
 * class of environment-dependency failure.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// Relative import into ../lib keeps this script standalone — the
// file has zero imports of its own, so pulling it in does not drag
// in the workspace-resolution graph that build.mts requires.
import { LIEF_REQUIRED_FILES } from '../lib/required-files.mts'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

function main() {
  const dir = process.argv[2]
  if (!dir) {
    logger.error('Usage: node scripts/verify-release.mts <directory>')
    process.exitCode = 1
    return
  }

  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- dir is a user-supplied CLI arg resolved against the caller's invocation cwd, by design
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
  logger.info(`Verifying LIEF release at: ${absoluteDir}`)

  const missing = []
  for (let i = 0, { length } = LIEF_REQUIRED_FILES; i < length; i += 1) {
    const requirement = LIEF_REQUIRED_FILES[i]
    if (Array.isArray(requirement)) {
      const present = requirement.some(alt =>
        existsSync(path.join(absoluteDir, alt)),
      )
      if (!present) {
        missing.push(`{${requirement.join(',')}}`)
      }
    } else if (!existsSync(path.join(absoluteDir, requirement))) {
      missing.push(requirement)
    }
  }

  if (missing.length === 0) {
    logger.info('All required LIEF files verified')
    return
  }

  logger.error('Missing required files:')
  for (let i = 0, { length } = missing; i < length; i += 1) {
    const file = missing[i]
    logger.error(`  - ${file}`)
  }
  logger.error('LIEF release verification failed')
  process.exitCode = 1
}

main()
