#!/usr/bin/env node
/**
 * @file Build the standalone socket-keychain executable for the host platform.
 */

import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { exec } from 'build-infra/lib/build-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { getKeychainCliBinaryPath } from './paths.mts'

const logger = getDefaultLogger()
const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const makefiles: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Makefile.macos',
  linux: 'Makefile.linux',
  win32: 'Makefile.win',
}

async function main(): Promise<void> {
  const makefile = makefiles[process.platform]
  if (!makefile) {
    throw new Error(`socket-keychain does not support ${process.platform}`)
  }
  const mode = process.env['BUILD_MODE'] ?? (process.env['CI'] ? 'prod' : 'dev')
  const platformArch = `${process.platform}-${process.arch}`
  const releaseVersion = process.env['RELEASE_VERSION']
  const makeArgs = ['-f', makefile]
  if (releaseVersion) {
    makeArgs.push(`VERSION=${releaseVersion}`)
  }
  logger.info(`Building socket-keychain (${mode}, ${platformArch})…`)
  await exec('make', makeArgs, {
    cwd: packageRoot,
    env: { ...process.env, BUILD_MODE: mode, PLATFORM_ARCH: platformArch },
  })
  const binaryPath = getKeychainCliBinaryPath(mode, platformArch)
  if (!existsSync(binaryPath)) {
    throw new Error(`Expected socket-keychain binary at ${binaryPath}`)
  }
  const stats = await stat(binaryPath)
  logger.success(`Built socket-keychain: ${binaryPath} (${stats.size} bytes)`)
}

void main().catch((error: unknown) => {
  logger.error(errorMessage(error))
  process.exitCode = 1
})
