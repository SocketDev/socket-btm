#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { exec } from 'build-infra/lib/build-helpers'
import { errorMessage } from 'build-infra/lib/error-utils'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  getBinaryPath,
  getBuildDir,
  languageModelInfraRoot,
  packageRoot,
} from './paths.mts'

const logger = getDefaultLogger()

export interface ConfigureInputs {
  readonly buildDir: string
  readonly mode: string
  readonly nodeImportLibrary?: string | undefined
  readonly nodeIncludeDir: string
}

export function cmakeConfigureArgs(inputs: ConfigureInputs): string[] {
  const buildType = inputs.mode === 'prod' ? 'Release' : 'Debug'
  return [
    '-S',
    languageModelInfraRoot,
    '-B',
    inputs.buildDir,
    '-G',
    'Ninja',
    `-DCMAKE_BUILD_TYPE=${buildType}`,
    `-DNODE_INCLUDE_DIR=${inputs.nodeIncludeDir}`,
    ...(inputs.nodeImportLibrary
      ? [`-DNODE_IMPORT_LIBRARY=${inputs.nodeImportLibrary}`]
      : []),
  ]
}

export function nodeDevelopmentCandidates(execPath: string): {
  includeDirs: string[]
  importLibraries: string[]
} {
  const executableDir = path.dirname(execPath)
  const prefixDir = path.dirname(executableDir)
  return {
    importLibraries: [
      path.join(executableDir, 'node.lib'),
      path.join(prefixDir, 'node.lib'),
    ],
    includeDirs: [
      path.join(executableDir, 'include', 'node'),
      path.join(prefixDir, 'include', 'node'),
    ],
  }
}

function resolveExistingPath(
  explicitPath: string | undefined,
  candidates: string[],
  expectedFile: string,
): string | undefined {
  if (explicitPath) {
    return explicitPath
  }
  return candidates.find(candidate =>
    existsSync(path.join(candidate, expectedFile)),
  )
}

async function main(): Promise<void> {
  const mode = process.env['BUILD_MODE'] ?? (process.env['CI'] ? 'prod' : 'dev')
  const target = `${process.platform}-${process.arch}`
  const buildDir = getBuildDir(mode, target)
  const development = nodeDevelopmentCandidates(process.execPath)
  const includeDir = resolveExistingPath(
    process.env['SMOL_AI_NODE_INCLUDE_DIR'],
    development.includeDirs,
    'node_api.h',
  )
  if (!includeDir) {
    throw new Error(
      `node_api.h not found; checked ${development.includeDirs.join(', ')}`,
    )
  }
  await mkdir(buildDir, { recursive: true })
  const nodeImportLibrary =
    process.platform === 'win32'
      ? (process.env['SMOL_AI_NODE_IMPORT_LIBRARY'] ??
        development.importLibraries.find(candidate => existsSync(candidate)))
      : undefined
  if (process.platform === 'win32' && !nodeImportLibrary) {
    throw new Error(
      `node.lib not found; checked ${development.importLibraries.join(', ')}`,
    )
  }
  logger.info(`Configuring smol_ai.node (${mode}, ${target})…`)
  await exec(
    'cmake',
    cmakeConfigureArgs({
      buildDir,
      mode,
      nodeImportLibrary,
      nodeIncludeDir: includeDir,
    }),
    { cwd: packageRoot },
  )
  logger.info('Compiling pinned llama.cpp and the N-API adapter…')
  await exec(
    'cmake',
    ['--build', buildDir, '--target', 'smol_ai', '--parallel'],
    { cwd: packageRoot },
  )
  const built = path.join(buildDir, 'smol_ai.node')
  const output = getBinaryPath(mode, target)
  if (!existsSync(built)) {
    throw new Error(`Expected ${built} after the native build`)
  }
  if (built !== output) {
    await copyFile(built, output)
  }
  const stats = await stat(output)
  logger.success(`Built ${output} (${stats.size} bytes)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error: unknown) => {
    logger.error(errorMessage(error))
    process.exitCode = 1
  })
}
