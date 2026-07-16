/**
 * Build log file helpers.
 *
 * Append-only build.log management inside a build directory, plus the legacy
 * flat-file build checkpoint reader.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

/**
 * Clear the build log file (truncate to empty).
 * Call this at the start of each build to prevent log accumulation.
 */
export async function clearBuildLog(buildDir: string): Promise<void> {
  const logPath = getBuildLogPath(buildDir)
  try {
    await fs.writeFile(logPath, '')
  } catch {
    // Don't fail build if logging fails.
  }
}

/**
 * Get build log path.
 */
export function getBuildLogPath(buildDir: string): string {
  return path.join(buildDir, 'build.log')
}

/**
 * Get last N lines from build log.
 */
export async function getLastLogLines(
  buildDir: string,
  lines = 50,
): Promise<string | undefined> {
  const logPath = getBuildLogPath(buildDir)
  try {
    const content = await fs.readFile(logPath, 'utf8')
    const allLines = content.split('\n')
    return allLines.slice(-lines).join('\n')
  } catch {
    return undefined
  }
}

/**
 * Read checkpoint.
 */
export async function readCheckpoint(
  buildDir: string,
): Promise<Record<string, unknown> | undefined> {
  const checkpointFile = path.join(buildDir, 'build-checkpoint')
  try {
    const content = await fs.readFile(checkpointFile, 'utf8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Save build output to log file.
 */
export async function saveBuildLog(
  buildDir: string,
  content: string,
): Promise<void> {
  const logPath = getBuildLogPath(buildDir)
  try {
    await fs.appendFile(logPath, `${content}\n`)
  } catch {
    // Don't fail build if logging fails.
  }
}
