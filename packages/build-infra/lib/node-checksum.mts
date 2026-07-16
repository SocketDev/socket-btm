/**
 * Node.js tarball checksum fetch and verification.
 *
 * Fetches SHASUMS256.txt from nodejs.org and cross-checks the hash stored in
 * .gitmodules. Used at build time to ensure the submodule points to an
 * authentic Node.js release.
 */

import { fetchChecksumFile } from '@socketsecurity/lib-stable/http-request/checksum-file'

import { errorMessage } from './error-utils.mts'
import { getSubmoduleChecksum } from './submodule-version.mts'
import { getNodeVersion } from './tool-version-reader.mts'

/**
 * Fetch the SHA-256 checksum for a Node.js source tarball from nodejs.org.
 *
 * Downloads SHASUMS256.txt from the official Node.js distribution and extracts
 * the checksum for `node-vX.Y.Z.tar.gz`. Used by the update-node skill to
 * store the checksum in .gitmodules during version updates.
 *
 * @example
 *   const result = await fetchNodeChecksum('1.2.3')
 *   if ('hash' in result) {
 *     // Write to .gitmodules: # node-1.2.3 sha256:<result.hash>
 *   }
 *
 * @param {string} version - Node.js version without 'v' prefix (e.g., '1.2.3')
 * @param {object} [options]
 * @param {number} [options.timeout=10_000] - Fetch timeout in milliseconds.
 *
 * @returns {Promise<
 *   { hash: string; version: string } | { error: string; version: string }
 * >}
 */
export async function fetchNodeChecksum(
  version: string,
  options?: { timeout?: number | undefined },
): Promise<
  { hash: string; version: string } | { error: string; version: string }
> {
  options = { __proto__: null, ...options } as typeof options
  const versionTag = `v${version}`
  const timeout = options?.timeout ?? 10_000
  const url = `https://nodejs.org/dist/${versionTag}/SHASUMS256.txt`
  const tarballName = `node-${versionTag}.tar.gz`

  let checksums
  try {
    // Force an uncompressed response. nodejs.org serves SHASUMS256.txt with
    // zstd content-encoding, which httpText/fetchChecksumFile does not decode —
    // the parser then sees binary garbage and returns zero entries, so the
    // real `node-vX.Y.Z.tar.gz` line is reported "not found". Requesting
    // `identity` makes the body plain text the GNU-style parser can read.
    checksums = await fetchChecksumFile(url, {
      headers: { 'accept-encoding': 'identity' },
      timeout,
    })
  } catch (e) {
    return {
      __proto__: null,
      version,
      error: `Failed to fetch ${url}: ${errorMessage(e)}`,
    } as unknown as { error: string; version: string }
  }

  const sri = checksums[tarballName]
  if (!sri) {
    return {
      __proto__: null,
      version,
      error: `${tarballName} not found in SHASUMS256.txt`,
    } as unknown as { error: string; version: string }
  }

  // fetchChecksumFile returns SRI ("sha256-<base64>"), but .gitmodules and this
  // helper's documented contract use lowercase hex (`# node-X.Y.Z sha256:<hex>`).
  // Decode to hex so both callers — verifyNodeChecksum's hex compare and the
  // update-node skill's `sha256:<hex>` write — receive the format they expect.
  // Same 32 bytes either way, so the integrity check is unchanged.
  const hash = sri.startsWith('sha256-')
    ? Buffer.from(sri.slice('sha256-'.length), 'base64').toString('hex')
    : sri

  return { __proto__: null, hash, version } as unknown as {
    hash: string
    version: string
  }
}

/**
 * Verify Node.js submodule checksum against nodejs.org SHASUMS256.txt.
 *
 * Fetches the official checksum for the Node.js source tarball and compares
 * it against the checksum stored in .gitmodules. This ensures the submodule
 * points to an authentic Node.js release.
 *
 * @example
 *   const result = await verifyNodeChecksum()
 *   if (!result.valid)
 *     throw new Error(
 *       `Checksum mismatch: ${result.expected} !== ${result.actual}`,
 *     )
 *
 * @param {object} [options]
 * @param {string} [options.version] - Node.js version to verify (default: from
 *   .node-version)
 * @param {number} [options.timeout=10_000] - Fetch timeout in milliseconds.
 *
 * @returns {Promise<{
 *   valid: boolean
 *   expected?: string
 *   actual?: string
 *   version: string
 *   error?: string
 * }>}
 */
export async function verifyNodeChecksum(options?: {
  version?: string | undefined
  timeout?: number | undefined
}): Promise<{
  valid: boolean
  expected?: string | undefined
  actual?: string | undefined
  version: string
  error?: string | undefined
}> {
  options = { __proto__: null, ...options } as typeof options
  type VerifyResult = {
    valid: boolean
    expected?: string | undefined
    actual?: string | undefined
    version: string
    error?: string | undefined
  }
  const version = options?.version ?? getNodeVersion()

  const stored = getSubmoduleChecksum(
    'packages/node-smol-builder/upstream/node',
    'node',
  )

  if (!stored) {
    return {
      __proto__: null,
      valid: false,
      version,
      error: 'No checksum found in .gitmodules for node submodule',
    } as unknown as VerifyResult
  }

  const result = await fetchNodeChecksum(version, options)
  if ('error' in result) {
    return {
      __proto__: null,
      valid: false,
      version,
      error: result.error,
    } as unknown as VerifyResult
  }

  return {
    __proto__: null,
    valid: stored.hash === result.hash,
    expected: result.hash,
    actual: stored.hash,
    version,
  } as unknown as VerifyResult
}
