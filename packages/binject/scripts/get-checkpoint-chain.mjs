#!/usr/bin/env node
/**
 * Get checkpoint chain for CI workflows.
 * Delegates to shared build-infra script.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib/spawn'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const sharedScript = path.join(
  __dirname,
  '../../build-infra/scripts/get-checkpoint-chain.mjs',
)

const result = await spawn(
  process.execPath,
  [sharedScript, ...process.argv.slice(2)],
  {
    stdio: 'inherit',
  },
)

process.exit(result.code ?? 0)
