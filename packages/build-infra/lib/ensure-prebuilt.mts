/**
 * Shared factory for builder `ensureX` helpers.
 *
 * Each *-builder package (lief, curl, libpq, dawn, opentui, onnxruntime,
 * yoga-layout, codet5-models, minilm) exposes the same
 * shape of public API:
 *
 * EnsureX(options?)        — local-build → downloaded → fetch-prebuilt
 * existsAt(dir)            — required-files validation
 * verifyAt(dir)            — same, with the missing-files list
 * getDownloadedDir(arch)   — where downloads land
 * downloadPrebuiltX(opts?) — pulls the latest gh release tarball.
 *
 * Without this factory each builder reimplements ~200 LOC of
 * download/verify/extract logic. The factory centralizes the
 * common path; each builder only declares its name, required-files
 * manifest, and per-platform build-dir resolution.
 *
 * Builder-specific extensions (e.g. LIEF's musl-compatibility check
 * on the extracted lib) are handled via the `onExtracted` hook —
 * factory does NOT bake them in.
 */

import { existsSync, promises as fs, readdirSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from './error-utils.mts'
// `logTransientErrorHelp` is loaded lazily from inside the catch block
// in downloadPrebuilt() — its transitive `@socketsecurity/lib-stable/
// http-request/convenience` import has an ESM/CJS interop issue that
// fires at module-load time. Lazy-loading defers the resolution to
// the actual error-handling path, where a failure to load it
// degrades gracefully (the transient-error hint is omitted).
import { getDownloadedDir } from './paths.mts'
import { verifyReleaseChecksum } from './release-checksums/core.mts'
import {
  detectLibc,
  downloadSocketBtmRelease,
} from '@socketsecurity/lib-stable/releases/socket-btm'
import { extractTarball } from './tarball-utils.mts'

import { safeDelete, safeMkdir } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

export interface PrebuiltConfig {
  /**
   * Builder name as it appears in the gh release tag prefix
   * (e.g. 'lief' → releases tagged `lief-<version-hash>`).
   * Also drives the asset filename: `<name>-<platformArch>.tar.gz`.
   */
  name: string
  /**
   * Path to the builder package's root. The downloaded extract dir
   * lives under `<packageRoot>/build/downloaded/<name>/<platformArch>/`.
   */
  packageRoot: string
  /**
   * Files that must exist (relative to the install dir) for the
   * builder's artifact to be considered complete. Array elements may
   * be strings (single required path) or string arrays (alternatives,
   * any one of which must exist — used for MSVC `.lib` vs Unix `.a`
   * naming variants).
   */
  requiredFiles: Array<string | string[]>
  /**
   * Resolve the current platform-arch identifier (e.g. `darwin-arm64`,
   * `linux-x64-musl`). Per-builder so each can honor its own
   * libc-detection / Windows naming conventions.
   */
  getCurrentPlatformArch(): string
  /**
   * Resolve the local build directory for a given platform-arch.
   * This is the "if the user already built locally" path checked
   * before falling through to the download cache. Returns the
   * directory that should contain `requiredFiles`.
   */
  getLocalBuildDir(platformArch: string): string
  /**
   * Optional hook fired after a downloaded tarball is extracted but
   * before the success-return. Lets a builder add platform-specific
   * post-checks (LIEF: verify musl compatibility on linux-*-musl).
   * Return `false` to reject the download (factory will delete the
   * extract dir and return `undefined`, falling through to source
   * build).
   */
  onExtracted?(extractDir: string, platformArch: string): Promise<boolean>
}

export interface PrebuiltApi {
  /**
   * Validates that every entry in `requiredFiles` resolves under `dir`.
   */
  verifyAt(dir: string): { valid: boolean; missing: string[] }
  /**
   * Boolean wrapper around `verifyAt`.
   */
  existsAt(dir: string): boolean
  /**
   * `existsAt` over the current platform's local build dir.
   */
  exists(platformArch?: string): boolean
  /**
   * `<packageRoot>/build/downloaded/<name>/<platformArch>/` —
   * where the gh-release download lands after extraction.
   */
  getDownloadedDir(platformArch: string): string
  /**
   * Fetch the latest published release tarball for the given platform.
   * Returns the extract directory on success, `undefined` on failure
   * (network error, checksum mismatch, missing release, onExtracted
   * rejection). Callers fall through to a from-source build.
   */
  downloadPrebuilt(options?: {
    platformArch?: string | undefined
  }): Promise<string | undefined>
  /**
   * Orchestrates the lookup chain:
   *
   * 1. Local build — `<getLocalBuildDir(arch)>`
   * 2. Downloaded — `<getDownloadedDir(arch)>`
   * 3. Fetch prebuilt — `downloadPrebuilt({ platformArch: arch })` Returns the
   *    resolved install dir, or throws if none of the three branches produced a
   *    valid install.
   */
  ensure(options?: {
    force?: boolean | undefined
    platformArch?: string | undefined
  }): Promise<string>
}

/**
 * Factory entry-point. Each builder calls this once with its config
 * and re-exports the returned API surface from `lib/ensure-X.mts`.
 */
export function createPrebuiltApi(config: PrebuiltConfig): PrebuiltApi {
  const {
    getCurrentPlatformArch,
    getLocalBuildDir,
    name,
    onExtracted,
    packageRoot,
    requiredFiles,
  } = config

  function verifyAt(dir: string): { valid: boolean; missing: string[] } {
    const missing = requiredFiles
      .filter(requirement => {
        if (Array.isArray(requirement)) {
          return !requirement.some(alt => existsSync(path.join(dir, alt)))
        }
        return !existsSync(path.join(dir, requirement))
      })
      .map(req => (Array.isArray(req) ? `{${req.join(',')}}` : req))
    return { valid: missing.length === 0, missing }
  }

  function existsAt(dir: string): boolean {
    return verifyAt(dir).valid
  }

  function getDownloadedDirForArch(platformArch: string): string {
    return path.join(getDownloadedDir(packageRoot), name, platformArch)
  }

  function exists(platformArch?: string): boolean {
    const resolvedPlatformArch = platformArch ?? getCurrentPlatformArch()
    return existsAt(getLocalBuildDir(resolvedPlatformArch))
  }

  async function downloadPrebuilt(
    options: { platformArch?: string | undefined } = {},
  ): Promise<string | undefined> {
    const { platformArch } = options
    const resolvedPlatformArch = platformArch ?? getCurrentPlatformArch()
    const assetName = `${name}-${resolvedPlatformArch}.tar.gz`
    const targetDir = getDownloadedDirForArch(resolvedPlatformArch)

    try {
      logger.info(`Checking for prebuilt ${name} releases…`)
      await safeMkdir(targetDir)
      logger.info(`Downloading ${assetName}...`)
      const downloadedArchive = await downloadSocketBtmRelease(name, {
        asset: assetName,
        downloadDir: targetDir,
      })
      const extractDir = path.dirname(downloadedArchive)
      if (!existsSync(downloadedArchive)) {
        throw new Error(
          `Downloaded archive not found at expected path: ${downloadedArchive}`,
        )
      }

      // Verify tarball integrity via gzip magic bytes — catches
      // truncated downloads before the checksum stage.
      const fd = await fs.open(downloadedArchive, 'r')
      const gzipMagic = Buffer.alloc(2)
      try {
        await fd.read(gzipMagic, 0, 2, 0)
      } finally {
        await fd.close()
      }
      if (gzipMagic[0] !== 0x1f || gzipMagic[1] !== 0x8b) {
        const versionFile = path.join(extractDir, '.version')
        await safeDelete(downloadedArchive)
        if (existsSync(versionFile)) {
          await safeDelete(versionFile)
        }
        throw new Error(
          'Downloaded archive is not a valid gzip file (missing magic bytes). ' +
            `File may be corrupted or truncated. Deleted ${downloadedArchive} to force re-download.`,
        )
      }

      // Verify SHA256 checksum — catches corrupted-but-magic-byte-valid
      // downloads.
      logger.info('Verifying archive checksum…')
      const checksumResult = await verifyReleaseChecksum({
        assetName,
        filePath: downloadedArchive,
        tempDir: path.join(packageRoot, 'build', 'temp'),
        tool: name,
      })
      if (!checksumResult.valid) {
        const versionFile = path.join(extractDir, '.version')
        await safeDelete(downloadedArchive)
        if (existsSync(versionFile)) {
          await safeDelete(versionFile)
        }
        throw new Error(
          'Archive checksum mismatch - file is corrupted.\n' +
            `  Expected: ${checksumResult.expected}\n` +
            `  Actual:   ${checksumResult.actual}\n` +
            `Deleted ${downloadedArchive} to force re-download.`,
        )
      }
      if (checksumResult.actual) {
        logger.info(
          `Checksum verified: ${checksumResult.actual.slice(0, 16)}...${checksumResult.actual.slice(-8)}`,
        )
      }

      // Clean stale extraction (cached Docker layers / partial extracts).
      const extractDirContents = readdirSync(extractDir)
      const archiveBasename = path.basename(downloadedArchive)
      for (let i = 0, { length } = extractDirContents; i < length; i += 1) {
        const item = extractDirContents[i]
        if (item !== archiveBasename && item !== '.version') {
          const itemPath = path.join(extractDir, item)
          await safeDelete(itemPath, { maxRetries: 3, retryDelay: 100 })
        }
      }

      try {
        await extractTarball(downloadedArchive, extractDir, {
          createDir: false,
          stdio: 'inherit',
          validate: true,
        })
      } catch (e) {
        const versionFile = path.join(extractDir, '.version')
        await safeDelete(downloadedArchive)
        if (existsSync(versionFile)) {
          await safeDelete(versionFile)
        }
        throw new Error(
          `Failed to extract ${name} archive from ${downloadedArchive}: ${errorMessage(e)}. ` +
            'Deleted corrupted archive to allow re-download on next run.',
          { cause: e },
        )
      }

      // Validate required-files after extraction. A successful extract
      // that's missing required files = corrupted release; force a
      // re-download next run.
      const verifyResult = verifyAt(extractDir)
      if (!verifyResult.valid) {
        const versionFile = path.join(extractDir, '.version')
        await safeDelete(downloadedArchive)
        if (existsSync(versionFile)) {
          await safeDelete(versionFile)
        }
        throw new Error(
          `${name} required files missing after extraction in ${extractDir}: ${verifyResult.missing.join(', ')}. ` +
            'Deleted cached files to allow re-download on retry.',
        )
      }

      // Builder-specific post-check (e.g. LIEF's musl-compat probe).
      if (onExtracted) {
        const accepted = await onExtracted(extractDir, resolvedPlatformArch)
        if (!accepted) {
          await safeDelete(targetDir)
          return undefined
        }
      }

      logger.success(`Successfully downloaded and extracted prebuilt ${name}`)
      return extractDir
    } catch (e) {
      logger.info(`Failed to download prebuilt ${name}: ${errorMessage(e)}`)
      // Lazy-load the transient-error hint so the eager module-load
      // path doesn't depend on @socketsecurity/lib-stable's
      // http-request/convenience (CJS export with ESM-only consumers).
      // If lazy-load fails (e.g. the interop bug bites here too), we
      // skip the hint rather than mask the original error.
      try {
        const { logTransientErrorHelp } =
          await import('./github-error-utils.mts')
        await logTransientErrorHelp(e)
      } catch {
        // Hint module failed to load — original error already logged.
      }
      return undefined
    }
  }

  // Per-platform locks deduplicate concurrent ensure() calls from
  // parallel workers (e.g. multi-arch matrix runs racing on the same
  // downloaded cache). Without this two callers can both miss the
  // local check, both miss the downloaded check, both fetch the
  // prebuilt, and the second's extraction can stomp the first's.
  const locks = new Map<string, Promise<string>>()

  async function ensureImpl(
    resolvedPlatformArch: string,
    // oxlint-disable-next-line socket/no-boolean-trap-param -- private closure, not a public API; options-bag is on the outer `ensure` function
    force: boolean,
  ): Promise<string> {
    // 1. Local build first.
    const localDir = getLocalBuildDir(resolvedPlatformArch)
    if (!force && existsAt(localDir)) {
      logger.info(`Using local ${name} at ${localDir}`)
      return localDir
    }

    // 2. Already-downloaded version.
    const downloadedDir = getDownloadedDirForArch(resolvedPlatformArch)
    if (!force && existsAt(downloadedDir)) {
      logger.info(`Using downloaded ${name} at ${downloadedDir}`)
      return downloadedDir
    }

    // 3. Fetch prebuilt from gh releases.
    logger.info(`${name} not found locally, downloading prebuilt…`)
    const extracted = await downloadPrebuilt({
      platformArch: resolvedPlatformArch,
    })
    if (extracted && existsAt(extracted)) {
      return extracted
    }

    throw new Error(
      `Failed to ensure ${name}. Run \`pnpm --filter ${name}-builder build\` to build from source.`,
    )
  }

  async function ensure(
    options: {
      force?: boolean | undefined
      platformArch?: string | undefined
    } = {},
  ): Promise<string> {
    const { force = false, platformArch } = options
    const resolvedPlatformArch = platformArch ?? getCurrentPlatformArch()

    const existing = locks.get(resolvedPlatformArch)
    if (existing) {
      return existing
    }
    const lockPromise = ensureImpl(resolvedPlatformArch, force)
    locks.set(resolvedPlatformArch, lockPromise)
    try {
      return await lockPromise
    } finally {
      locks.delete(resolvedPlatformArch)
    }
  }

  return {
    downloadPrebuilt,
    ensure,
    exists,
    existsAt,
    getDownloadedDir: getDownloadedDirForArch,
    verifyAt,
  }
}

// Re-export shared utility so consumers can keep one import line.
export { detectLibc }
