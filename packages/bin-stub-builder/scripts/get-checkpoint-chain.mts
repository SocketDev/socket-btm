#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 * Delegates to shared build-infra script.
 */

import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

const logger = getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export async function main() {
  const sharedScript = path.join(
    __dirname,
    '../../build-infra/scripts/get-checkpoint-chain.mts',
  )

  const result = await spawn(
    process.execPath,
    [sharedScript, ...process.argv.slice(2)],
    {
      stdio: 'inherit',
    },
  )

  process.exitCode = result.code ?? 0
}

main().catch(err => {
  logger.error(errorMessage(err))
  process.exitCode = 1
})
