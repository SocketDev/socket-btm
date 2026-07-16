#!/usr/bin/env node
/**
 * @file Validate and name one Keychain addon release asset. The workflow calls
 *   this after each native build so an asset cannot be published under the
 *   wrong platform/CPU name. This script performs no network or release work.
 */

import crypto from 'node:crypto'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import {
  validateNativeBinary,
  validateNativeTarget,
  validatePlainVersion,
} from 'build-infra/lib/native-release-binary'

export function assetName(version: string, target: string): string {
  validateVersion(version)
  validateNativeTarget(target, 'Keychain addon')
  return `keychain-addon-${version}-${target}.node`
}

export function validateVersion(version: string): void {
  validatePlainVersion(version)
}

export function validateBinary(bytes: Buffer, target: string): void {
  validateNativeBinary(bytes, target, 'Keychain addon')
}

async function main(): Promise<void> {
  const [version, target, input, outputDir] = process.argv.slice(2)
  if (!version || !target || !input || !outputDir) {
    throw new Error(
      'Usage: stage-release.mts <version> <target> <input.node> <output-dir>',
    )
  }
  const bytes = await readFile(input)
  validateBinary(bytes, target)
  const name = assetName(version, target)
  await mkdir(outputDir, { recursive: true })
  const output = path.join(outputDir, name)
  await copyFile(input, output)
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex')
  await writeFile(`${output}.sha256`, `${checksum}  ${name}\n`)
  process.stdout.write(`${output}\n`)
}

if (process.argv[1]?.endsWith('stage-release.mts')) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  })
}
