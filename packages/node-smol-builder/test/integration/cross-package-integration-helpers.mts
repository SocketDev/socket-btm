/**
 * @file Binary resolution and process helpers for cross-package integration.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getBuildMode } from 'build-infra/lib/constants'
import { getCurrentPlatformArch } from 'build-infra/lib/platform-mappings'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

import { REPO_ROOT } from '../../scripts/paths.mts'

const BUILD_MODE = getBuildMode()

export async function execCommand(
  command: string,
  args: string[] = [],
  options: SpawnOptions = {},
): Promise<{ code: number; stderr: string; stdout: string }> {
  const result = await spawn(command, args, {
    ...options,
    stdio: 'pipe',
  })
  return {
    code: result.code ?? 0,
    stderr: result.stderr?.toString() ?? '',
    stdout: result.stdout?.toString() ?? '',
  }
}

export async function getBinaryPath(
  packageName: string,
  binaryName: string,
): Promise<string> {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const platformArch = await getCurrentPlatformArch()
  const withPlatform = path.join(
    REPO_ROOT,
    'packages',
    packageName,
    'build',
    BUILD_MODE,
    platformArch,
    'out',
    'Final',
    binaryName + ext,
  )
  if (existsSync(withPlatform)) {
    return withPlatform
  }
  return path.join(
    REPO_ROOT,
    'packages',
    packageName,
    'build',
    BUILD_MODE,
    'out',
    'Final',
    binaryName + ext,
  )
}
