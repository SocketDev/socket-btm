#!/usr/bin/env node
/**
 * Verify BoringSSL release artifacts before archiving. Called by CI workflow
 * to ensure all required files are present.
 *
 * Usage: node scripts/verify-release.mts <directory>
 *
 * Intentionally self-contained — no imports from workspace packages. Mirrors
 * lief-builder/scripts/verify-release.mts to dodge the same symlink-resolution
 * class of failure on isolated CI runners.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { BORINGSSL_REQUIRED_FILES } from '../lib/required-files.mts'

const logger = getDefaultLogger()

function main(): void {
  const dir = process.argv[2]
  if (!dir) {
    logger.error('Usage: node scripts/verify-release.mts <directory>')
    process.exitCode = 1
    return
  }

  // oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- dir is a user-supplied CLI arg resolved against the caller's invocation cwd, by design
  const absoluteDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir)
  logger.info(`Verifying BoringSSL release at: ${absoluteDir}`)

  const missing: string[] = []
  for (let i = 0, { length } = BORINGSSL_REQUIRED_FILES; i < length; i += 1) {
    const requirement = BORINGSSL_REQUIRED_FILES[i]
    if (Array.isArray(requirement)) {
      const present = requirement.some(alt =>
        existsSync(path.join(absoluteDir, alt)),
      )
      if (!present) {
        missing.push(`{${requirement.join(',')}}`)
      }
    } else if (!existsSync(path.join(absoluteDir, requirement!))) {
      missing.push(requirement!)
    }
  }

  if (missing.length === 0) {
    logger.info('All required BoringSSL files verified')
    return
  }

  logger.error('Missing required files:')
  for (let i = 0, { length } = missing; i < length; i += 1) {
    const file = missing[i]
    logger.error(`  - ${file}`)
  }
  logger.error('BoringSSL release verification failed')
  process.exitCode = 1
}

main()
