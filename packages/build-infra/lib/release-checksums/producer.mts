/**
 * Release-checksum producer: write `checksums.txt` for a directory of
 * artifacts; update a `release-assets.json` block.
 *
 * Use this when your repo *produces* releases (e.g. socket-btm builds
 * `.node` binaries and ships them to GH Releases). The output of
 * `writeChecksumsFile()` is what consumers download and verify against
 * via `consumer.mts`.
 *
 * Repos that only consume releases don't need this file — see `consumer.mts`.
 *
 * Fleet-canonical: byte-identical across every repo that ships
 * `packages/build-infra/lib/release-checksums/`.
 */

import { promises as fs, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { computeFileHash, type EmbeddedChecksums } from './core.mts'

const logger = getDefaultLogger()

/**
 * Walk a directory and compute SHA-256 hashes for every regular file in it.
 *
 * Sub-paths are relative to `dir`. Symlinks and directories are not
 * recursed — pass a flat directory of artifacts.
 */
export async function hashDirectory(
  dir: string,
): Promise<Record<string, string>> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const out: Record<string, string> = { __proto__: null as never }
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }
    const filePath = path.join(dir, entry.name)
    out[entry.name] = await computeFileHash(filePath)
  }
  return out
}

interface WriteChecksumsOptions {
  /** Directory containing the artifacts to hash. */
  inputDir: string
  /** Path of the `checksums.txt` to write. */
  outputPath: string
  /** Optional ordering. If omitted, entries are sorted alphabetically. */
  order?: 'alphabetical' | readonly string[]
  /** Suppress info logging (errors still log). */
  quiet?: boolean
}

/**
 * Write a `checksums.txt` file from a directory of artifacts.
 *
 * Output format: `<sha256-hex>  <filename>\n`, matching the format
 * `consumer.mts:parseChecksums` expects. Filenames are sorted
 * alphabetically by default for stable diffs.
 */
export async function writeChecksumsFile(
  options: WriteChecksumsOptions,
): Promise<Record<string, string>> {
  const {
    inputDir,
    order = 'alphabetical',
    outputPath,
    quiet = false,
  } = options

  const checksums = await hashDirectory(inputDir)
  const names =
    order === 'alphabetical' ? Object.keys(checksums).sort() : [...order]

  const lines: string[] = []
  for (const name of names) {
    const hash = checksums[name]
    if (!hash) {
      if (!quiet) {
        logger.warn(`No file matched ordering entry: ${name}`)
      }
      continue
    }
    lines.push(`${hash}  ${name}`)
  }
  // POSIX-style trailing newline.
  await fs.writeFile(outputPath, lines.join('\n') + '\n', 'utf8')
  if (!quiet) {
    logger.info(`Wrote ${lines.length} checksums to ${outputPath}`)
  }
  return checksums
}

interface UpdateAssetsOptions {
  /** Path to `release-assets.json`. */
  manifestPath: string
  /** Tool key inside the manifest (e.g. `iocraft`, `lief`). */
  tool: string
  /** Release tag, e.g. `iocraft-20260424-18f0f46`. */
  tag: string
  /** Asset → SHA-256 map (typically the return value of `writeChecksumsFile`). */
  checksums: Record<string, string>
  /** Optional human-readable description for the tool block. */
  description?: string
}

/**
 * Update a tool's block in `release-assets.json` in place.
 *
 * Reads the existing manifest, replaces the block for `tool` with the
 * new `tag` + `checksums`, and writes the result back. Other tool blocks
 * are preserved untouched.
 *
 * The manifest's $schema field (if present) is preserved.
 */
export function updateReleaseAssets(options: UpdateAssetsOptions): void {
  const { checksums, description, manifestPath, tag, tool } = options

  let manifest: EmbeddedChecksums & {
    $schema?: string
    $comment?: string
  } = { __proto__: null as never } as never
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // New file — start fresh.
  }

  manifest[tool] = {
    ...(description !== undefined ? { description } : {}),
    tag,
    checksums,
  }

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
}
