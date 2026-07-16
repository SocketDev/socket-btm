/**
 * @file Shared build/cache/signature helpers for the binject E2E
 *   signature-cache test suite. Split out of e2e-signature-cache.test.mts —
 *   the describe/test scenarios kept there stay under the file-size soft cap
 *   with the setup helpers living alongside the other test/helpers modules.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { getSocketDlxDir } from '@socketsecurity/lib-stable/paths/socket'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { getPlatformArch } from 'build-infra/lib/platform-mappings'

import { REPO_ROOT } from '../../../../scripts/fleet/paths.mts'
import { getBinjectPath } from './paths.mts'

const PROJECT_ROOT = path.join(REPO_ROOT, 'packages', 'binject')
export const BINJECT = getBinjectPath()
const PLATFORM_ARCH = getPlatformArch(process.platform, process.arch, undefined)

/**
 * Find any available node-smol binary for testing (compressed/final stub).
 * Tries multiple locations and build variants.
 *
 * @returns {string | null} Path to binary or null if none found
 */
export function findTestStub() {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'

  // Try various build output locations.
  // Note: The build system creates output as either:
  // - Final/<binaryName> (flat file structure)
  // - Final/node/<binaryName> (directory structure for macOS bundles)
  const candidates = [
    // Final builds - directory structure (macOS app bundle layout).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Final/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Final/node',
      binaryName,
    ),
    // Final builds - flat structure (production-ready).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Final',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Final',
      binaryName,
    ),
    // Compressed builds - directory structure.
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Compressed/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Compressed/node',
      binaryName,
    ),
    // Compressed builds - flat structure (for testing decompression).
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Compressed',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Compressed',
      binaryName,
    ),
  ]

  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]
    if (!candidate) {
      continue
    }
    // Only return if it's a file (not a directory)
    if (existsSync(candidate)) {
      try {
        const stats = statSync(candidate)
        if (stats.isFile()) {
          // Return absolute path to avoid path traversal issues with binject
          return path.resolve(candidate)
        }
      } catch {
        // Skip if we can't stat
      }
    }
  }

  return undefined
}

/**
 * Find uncompressed node-smol binary for SEA blob generation. Uses Stripped or
 * Release binary from build output (same Node.js version as stub). This is more
 * reliable than extracting from cache which can be inconsistent.
 *
 * @returns {string | null} Path to uncompressed binary or null if none found
 */
// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export function findNodeSmolBinary() {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'

  // Prefer Stripped (smaller) over Release, dev over prod
  const candidates = [
    // Stripped builds (smaller, suitable for SEA generation)
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Stripped/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Stripped/node',
      binaryName,
    ),
    // Release builds (full symbols, fallback)
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/dev',
      PLATFORM_ARCH,
      'out/Release/node',
      binaryName,
    ),
    path.join(
      PROJECT_ROOT,
      '../node-smol-builder/build/prod',
      PLATFORM_ARCH,
      'out/Release/node',
      binaryName,
    ),
  ]

  for (let i = 0, { length } = candidates; i < length; i += 1) {
    const candidate = candidates[i]
    if (!candidate) {
      continue
    }
    if (existsSync(candidate)) {
      try {
        const stats = statSync(candidate)
        if (stats.isFile()) {
          return path.resolve(candidate)
        }
      } catch {
        // Skip if we can't stat
      }
    }
  }

  return undefined
}

export interface ExecCommandResult {
  code: number | null
  output: string
  stderr: string
  stdout: string
}

// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export async function execCommand(
  command: string,
  args: string[] = [],
  options: Record<string, unknown> = {},
) {
  return new Promise<ExecCommandResult>(resolve => {
    const spawnPromise = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    })

    // @socketsecurity/lib-stable/process/spawn/child returns a Promise with .process property
    // Prevent unhandled rejection — we handle exit via proc.on('close')
    spawnPromise.catch(() => {})

    const proc = spawnPromise.process

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', data => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', data => {
      stderr += data.toString()
    })

    proc.on('close', code => {
      resolve({
        code,
        output: stdout + stderr,
        stderr,
        stdout,
      })
    })
  })
}

export async function verifySignature(binaryPath: string) {
  const result = await execCommand('codesign', [
    '--verify',
    '--strict',
    '--deep',
    binaryPath,
  ])
  return result.code === 0
}

// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export async function getSignatureInfo(binaryPath: string) {
  // codesign outputs to stderr
  const result = await execCommand('codesign', ['-dvvv', binaryPath])
  return result.stderr
}

// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export function getCacheDir() {
  return getSocketDlxDir()
}

// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export async function getCacheEntries() {
  const cacheDir = getCacheDir()
  try {
    const entries = await fs.readdir(cacheDir)
    // Filter for 16-char hex directories
    return entries.filter(e => /^[0-9a-f]{16}$/.test(e))
  } catch {
    return []
  }
}

// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export async function getCachedBinaryPath(cacheKey: string) {
  const platform = os.platform()
  const binaryName = platform === 'win32' ? 'node.exe' : 'node'
  return path.join(getCacheDir(), cacheKey, binaryName)
}

/**
 * Clean ALL cache entries before test to ensure fresh state. This is necessary
 * because the repack workflow modifies the cache state in ways that break
 * subsequent injections.
 */
// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export async function cleanCacheBeforeTest() {
  const cacheDir = getCacheDir()
  try {
    const entries = await fs.readdir(cacheDir)
    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]
      if (!entry || !/^[0-9a-f]{16}$/.test(entry)) {
        continue
      }
      const entryPath = path.join(cacheDir, entry)
      // Clean ALL cache entries - the repack workflow corrupts them
      // eslint-disable-next-line no-await-in-loop
      await safeDelete(entryPath)
    }
  } catch {
    // Cache dir might not exist yet
  }
}

/**
 * Generate a valid SEA blob using binject blob command. Creates a unique JS
 * file and sea-config.json, then generates the blob.
 *
 * @param baseDir - Directory to create files in.
 * @param prefix - Unique prefix for file names.
 * @param nodeBinaryPath - Optional path to Node.js binary for SEA generation
 *   (for version matching)
 *
 * @returns Path to the generated .blob file
 */
// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export async function generateValidSEABlob(
  baseDir: string,
  prefix: string,
  nodeBinaryPath?: string,
) {
  const uuid = crypto.randomUUID()

  // Create a unique JS file
  const jsFile = path.join(baseDir, `${prefix}-${uuid}.js`)
  await fs.writeFile(jsFile, `console.log('SEA ${prefix} ${uuid}');\n`)

  // Create sea-config.json
  const configFile = path.join(baseDir, `${prefix}-${uuid}-config.json`)
  const blobFile = `${prefix}-${uuid}.blob`
  await fs.writeFile(
    configFile,
    JSON.stringify({
      main: path.basename(jsFile),
      output: blobFile,
    }),
  )

  // Generate blob using binject blob command
  // If nodeBinaryPath provided, use it for SEA generation to ensure version match
  const env = nodeBinaryPath
    ? { ...process.env, BINJECT_NODE_PATH: nodeBinaryPath }
    : process.env
  const result = await execCommand(BINJECT, ['blob', configFile], {
    cwd: baseDir,
    env,
  })

  if (result.code !== 0) {
    throw new Error(`Failed to generate SEA blob: ${result.output}`)
  }

  return path.join(baseDir, blobFile)
}

/**
 * Create unique VFS content using UUID to ensure each test creates a unique
 * cache entry.
 */
// oxlint-disable-next-line socket/sort-source-methods -- test helpers ordered by signature-cache flow (build → sign → cache → verify → invalidate); alphabetizing would scatter the flow.
export function createUniqueVFSContent(description: string) {
  const uuid = crypto.randomUUID()
  return `${description}\nUnique ID: ${uuid}\n`
}
