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

function main() {
  const dir = process.argv[2]
  if (!dir) {
    console.error('Usage: node scripts/verify-release.mts <directory>')
    process.exitCode = 1
    return
  }

  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
  console.log(`Verifying LIEF release at: ${absoluteDir}`)

  const missing = []
  for (const requirement of LIEF_REQUIRED_FILES) {
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
    console.log('All required LIEF files verified')
    return
  }

  console.error('Missing required files:')
  for (const file of missing) {
    console.error(`  - ${file}`)
  }
  console.error('LIEF release verification failed')
  process.exitCode = 1
}

main()
