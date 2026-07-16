#!/usr/bin/env node

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { errorMessage } from 'build-infra/lib/error-utils'

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const logger = getDefaultLogger()

async function main(): Promise<void> {
  await safeDelete(path.join(packageRoot, 'build'))
  await safeDelete(path.join(packageRoot, 'out'))
}

void main().catch((error: unknown) => {
  logger.error(errorMessage(error))
  process.exitCode = 1
})
