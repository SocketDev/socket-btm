/**
 * Build Helper Utilities.
 *
 * General-purpose build helpers (exec, sizing, durations, executable bits),
 * plus the aggregation point for the split helper domains: host environment
 * checks, build logs, smoke-test strategy/execution, and binary verification.
 */

import { promises as fs } from 'node:fs'

import spawnPkg from '@socketsecurity/lib-stable/process/spawn/child'

import { BYTES } from './constants.mts'

import type { FileHandle } from 'node:fs/promises'
import type { SpawnOptions } from '@socketsecurity/lib-stable/process/spawn/types'

const { spawn } = spawnPkg

export * from './binary-smoke-test.mts'
export * from './binary-verify.mts'
export * from './build-log.mts'
export * from './host-env-checks.mts'
export * from './smoke-test-strategy.mts'

// Re-export workflow checkpoint functions from checkpoint-manager
// These provide GitHub Actions workflow checkpoint support with metadata
export {
  cleanCheckpoint,
  createCheckpoint,
  getCacheHash,
  getCacheHashFile,
  needsCacheRebuild,
  restoreCheckpoint,
  writeCacheHash,
} from './checkpoint-manager.mts'

/**
 * Options for {@link exec}. Extends spawn options with the legacy `encoding`
 * flag — when set, output is captured instead of inherited.
 */
export type ExecOptions = SpawnOptions & {
  encoding?: BufferEncoding | undefined
}

/**
 * Estimate build time based on CPU cores.
 */
export function estimateBuildTime(baseMinutes: number, cores: number): number {
  // Amdahl's law approximation: not all build steps parallelize perfectly.
  const parallelFraction = 0.8
  const serialFraction = 1 - parallelFraction

  return Math.ceil(baseMinutes * (serialFraction + parallelFraction / cores))
}

/**
 * Execute command using spawn.
 */
export async function exec(
  command: string,
  args: string[] | string = [],
  options: ExecOptions = {},
) {
  const spawnOptions: ExecOptions = {
    ...options,
  }
  // Only set stdio to 'inherit' if encoding is not specified (which requires capturing output)
  if (!spawnOptions.encoding) {
    spawnOptions.stdio = 'inherit'
  }
  const result = await spawn(
    Array.isArray(args) ? command : `${command} ${args}`,
    Array.isArray(args) ? args : [],
    spawnOptions,
  )
  if (result.code !== 0) {
    throw new Error(`Command failed with exit code ${result.code}: ${command}`)
  }
  return result
}

/**
 * Format duration in human-readable format.
 */
export function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }

  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }

  return `${seconds}s`
}

/**
 * Get file size in human-readable format.
 */
export async function getFileSize(filePath: string): Promise<string> {
  // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size for human-readable byte formatter.
  const stats = await fs.stat(filePath)
  const bytes = stats.size

  if (bytes < BYTES.KB) {
    return `${bytes} B`
  }

  if (bytes < BYTES.MB) {
    return `${(bytes / BYTES.KB).toFixed(2)} KB`
  }

  if (bytes < BYTES.GB) {
    return `${(bytes / BYTES.MB).toFixed(2)} MB`
  }

  return `${(bytes / BYTES.GB).toFixed(2)} GB`
}

/**
 * Make a file executable and sync to disk. Prevents ETXTBSY ("Text file busy")
 * errors in Docker/QEMU where the kernel may not have fully flushed writes
 * before execve(). Always use this instead of raw fs.chmod(path, 0o755) when
 * the file will be executed immediately after.
 */
export async function makeExecutable(filePath: string): Promise<void> {
  await fs.chmod(filePath, 0o755)
  let fd: FileHandle | undefined
  try {
    fd = await fs.open(filePath, 'r')
    await fd.sync()
  } catch {
    // fsync may fail on Windows (EPERM) — only needed on Linux/Docker.
  } finally {
    await fd?.close()
  }
}
