/**
 * Submodule version and checksum readers for .gitmodules.
 *
 * Parses the `# package-X.Y.Z [sha256:<hex>]` comment convention that precedes
 * each `[submodule "..."]` block, extracting the version and optional checksum
 * for integrity verification.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PACKAGE_ROOT } from './constants.mts'

/**
 * Extract submodule checksum from .gitmodules version comment.
 *
 * Parses checksum annotations in the format `# package-X.Y.Z sha256:<hex>`
 * above submodule entries. Returns undefined if no checksum is present
 * (checksum is optional).
 *
 * @example
 *   const checksum = getSubmoduleChecksum(
 *     'packages/node-smol-builder/upstream/node',
 *     'node',
 *   )
 *   // Returns: { algorithm: 'sha256', hash: '10335f268f...' }
 *
 * @param {string} submodulePath - Submodule path (e.g.,
 *   "packages/node-smol-builder/upstream/node")
 * @param {string} packageName - Package name (e.g., "node")
 *
 * @returns {{ algorithm: string; hash: string } | undefined} Checksum object or
 *   undefined.
 */
export function getSubmoduleChecksum(
  submodulePath: string,
  packageName: string,
): { algorithm: string; hash: string } | undefined {
  if (!packageName || packageName.trim() === '') {
    throw new Error('Package name cannot be empty')
  }

  const gitmodulesPath = path.join(PACKAGE_ROOT, '..', '..', '.gitmodules')

  let content
  try {
    content = readFileSync(gitmodulesPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `.gitmodules not found at: ${gitmodulesPath}\n` +
          'This function must be called from within a monorepo package.',
        { cause: e },
      )
    }
    throw e
  }

  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  )
  const escapedPath = submodulePath
    .replace(/\[/g, String.raw`\[`)
    .replace(/\]/g, String.raw`\]`)

  // Match: # package-VERSION algorithm:hash\n[submodule "path"]
  // The version comment may be followed by other annotation comment lines
  // (e.g. `# full-checkout: …`) before the section header — tolerate any
  // contiguous comment block between it and `[submodule]`.
  const checksumPattern = `# ${escapedPackageName}-\\S+\\s+(\\w+):([0-9a-f]+)[^\\n]*\\n(?:#[^\\n]*\\n)*\\[submodule "${escapedPath}"\\]`
  const checksumRegex = new RegExp(checksumPattern)
  const checksumMatch = content.match(checksumRegex)

  if (!checksumMatch) {
    return undefined
  }

  return {
    __proto__: null,
    algorithm: checksumMatch[1]!,
    hash: checksumMatch[2]!,
  } as { algorithm: string; hash: string }
}

/**
 * Extract submodule version from .gitmodules version comment.
 *
 * Parses version comments in the format `# package-X.Y.Z` above submodule
 * entries. Expects consistent format: `# <package>-<version>` (version may be
 * semver or other formats)
 *
 * @example
 *   const version = getSubmoduleVersion(
 *     'packages/lief-builder/upstream/lief',
 *     'lief',
 *   )
 *   // Returns: '0.17.0'
 *
 * @param {string} submodulePath - Submodule path (e.g.,
 *   "packages/lief-builder/upstream/lief")
 * @param {string} packageName - Package name (e.g., "lief")
 *
 * @returns {string} Version string (e.g., "0.17.0")
 *
 * @throws {Error} If version comment not found or malformed
 */
export function getSubmoduleVersion(
  submodulePath: string,
  packageName: string,
): string {
  if (!packageName || packageName.trim() === '') {
    throw new Error('Package name cannot be empty')
  }

  const gitmodulesPath = path.join(PACKAGE_ROOT, '..', '..', '.gitmodules')

  let content
  try {
    content = readFileSync(gitmodulesPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        `.gitmodules not found at: ${gitmodulesPath}\n` +
          'This function must be called from within a monorepo package.',
        { cause: e },
      )
    }
    throw e
  }

  const escapedPackageName = packageName.replace(
    /[.*+?^${}()|[\]\\]/g,
    String.raw`\$&`,
  )

  const escapedPath = submodulePath
    .replace(/\[/g, String.raw`\[`)
    .replace(/\]/g, String.raw`\]`)

  // Match the version comment in the contiguous comment block BEFORE the
  // submodule section. Other annotation lines (e.g. `# full-checkout: …`)
  // may sit between it and the header.
  // Format: # package-VERSION [optional checksum]\n[# other comments\n]*[submodule "path"]
  const versionPattern = `# ${escapedPackageName}-(\\S+)[^\\n]*\\n(?:#[^\\n]*\\n)*\\[submodule "${escapedPath}"\\]`
  const versionRegex = new RegExp(versionPattern)
  const versionMatch = content.match(versionRegex)

  if (!versionMatch || !versionMatch[1]) {
    const sectionRegex = new RegExp(`\\[submodule "${escapedPath}"\\]`)
    const sectionExists = sectionRegex.test(content)

    if (!sectionExists) {
      throw new Error(
        `Submodule '${submodulePath}' not found in .gitmodules\n` +
          `Expected section: [submodule "${submodulePath}"]`,
      )
    }

    throw new Error(
      `Version comment not found for submodule '${submodulePath}' in .gitmodules\n` +
        `Expected format: # ${packageName}-X.Y.Z in the comment block directly above [submodule "${submodulePath}"]\n` +
        `Example:\n# ${packageName}-1.0.0\n[submodule "${submodulePath}"]`,
    )
  }

  return versionMatch[1]
}
