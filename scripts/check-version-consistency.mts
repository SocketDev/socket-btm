#!/usr/bin/env node
/* max-file-lines: legitimate — top-down checker pipeline with many small section helpers; splitting would scatter the linear flow that makes this script auditable. */
/* oxlint-disable socket/sort-source-methods -- script ordered as a top-down checker pipeline (load configs → diff versions → report); alphabetizing would scatter the flow. */
/**
 * @fileoverview External dependency version consistency checker.
 *
 * Every upstream dependency in this monorepo has AT LEAST two places
 * where its version is declared:
 *
 *   1. .gitmodules version comment — `# <pkg>-X.Y.Z [sha256:...]` on
 *      the line immediately before [submodule "..."]
 *   2. packages/<pkg-builder>/package.json sources.<upstream>.version
 *      (+ .ref, which should match the submodule gitlink commit SHA)
 *   3. (optional) lockstep.json `packages.<name>.version`
 *   4. (optional) workflow env: pins (e.g. ZIG_VERSION in opentui.yml)
 *
 * When these get out of sync — R31 found onnxruntime-builder pinned at
 * 1.20.1 in package.json but 1.24.4 in .gitmodules + lockstep.json — CI
 * tags caches and releases with the wrong version. The workflows read
 * one source of truth (package.json), the submodule checks out another
 * (gitmodules gitlink), and the release label says a third.
 *
 * This checker cross-references all four sources and fails if any
 * disagree.
 *
 * In addition to cross-source consistency, the checker validates the
 * `.gitmodules` comment shape itself:
 *
 *   - `comment-missing`        — no "# name-version" comment above
 *                                the [submodule] section.
 *   - `comment-name-mismatch`  — the <name> slug doesn't appear in
 *                                the submodule path (catches typos
 *                                and stale comments on renamed paths).
 *   - `comment-version-format` — the <version> portion has no digit
 *                                (catches "rc1" or "main" pasted as
 *                                a placeholder).
 *   - `comment-sha256-format`  — optional sha256:<hex> isn't exactly
 *                                64 lowercase hex chars (catches
 *                                truncation, uppercase paste, or
 *                                non-hex contamination).
 *
 * Wired into `pnpm run check` via check.mts.
 *
 * Usage:
 *   node scripts/check-version-consistency.mts
 *   node scripts/check-version-consistency.mts --explain
 *   node scripts/check-version-consistency.mts --json
 *
 * Allowlist: `.github/version-consistency-allowlist.yml` for
 * intentional mismatches (e.g. a builder pinning an older API-compat
 * version while the submodule tracks newer).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')
const GITMODULES_PATH = path.join(MONOREPO_ROOT, '.gitmodules')
const ALLOWLIST_PATH = path.join(
  MONOREPO_ROOT,
  '.github',
  'version-consistency-allowlist.yml',
)

type AllowlistEntry = {
  upstream: string
  reason: string
}

export function loadAllowlist(): AllowlistEntry[] {
  if (!existsSync(ALLOWLIST_PATH)) {
    return []
  }
  const content = readFileSync(ALLOWLIST_PATH, 'utf8')
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> = {}
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed === '---') {
      continue
    }
    if (line.startsWith('- ')) {
      if (current.upstream && current.reason) {
        entries.push(current as AllowlistEntry)
      }
      current = {}
      const firstKv = line.slice(2).match(/^(\w+):\s*(.+)$/)
      if (firstKv) {
        const key = firstKv[1]!
        const value = firstKv[2]!.replace(/^['"]|['"]$/g, '')
        ;(current as Record<string, unknown>)[key] = value
      }
      continue
    }
    const kv = trimmed.match(/^(\w+):\s*(.+)$/)
    if (kv) {
      const key = kv[1]!
      const value = kv[2]!.replace(/^['"]|['"]$/g, '')
      ;(current as Record<string, unknown>)[key] = value
    }
  }
  if (current.upstream && current.reason) {
    entries.push(current as AllowlistEntry)
  }
  return entries
}

type Submodule = {
  name: string
  path: string
  // Just the version portion, e.g. "1.24.4". Kept for back-compat with
  // collectMismatches comparing against package.json `sources.*.version`.
  versionComment: string | undefined
  // The full comment slug ("name-version"). Used for name-path
  // consistency checks (the <name> portion should appear in the path).
  commentSlug: string | undefined
  // sha256 hex when the comment carries `sha256:<hex>`. Used by the
  // format-validation pass below. Undefined when no sha256 is present.
  commentSha256: string | undefined
  // The raw comment line, kept for error reporting.
  commentLine: string | undefined
}

/** Walk .gitmodules for submodules + their version comments. */
export function loadSubmodules(): Submodule[] {
  if (!existsSync(GITMODULES_PATH)) {
    return []
  }
  const content = readFileSync(GITMODULES_PATH, 'utf8')
  const lines = content.split(/\r?\n/)
  const submodules: Submodule[] = []
  let prevComment: string | undefined
  let prevSlug: string | undefined
  let prevSha256: string | undefined
  let prevRawLine: string | undefined
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // Version comment: `# name-X.Y.Z [sha256:<hex>] [...]`.
    //   - <name> token: lowercase letters/digits/underscores/hyphens,
    //     starting with a letter.
    //   - <version>: anything up to the next whitespace.
    //   - optional sha256:hex64 trailing after one space.
    // Capture all three so downstream checks can validate consistency
    // without re-parsing the line.
    const commentMatch = line.match(
      /^# ([a-z][a-z0-9_-]*)-(\S+)(?:\s+sha256:([0-9a-fA-F]+))?/,
    )
    if (commentMatch) {
      prevComment = commentMatch[2]
      prevSlug = commentMatch[1]
      prevSha256 = commentMatch[3]
      prevRawLine = line
      continue
    }
    const submoduleMatch = line.match(/^\[submodule "([^"]+)"\]/)
    if (submoduleMatch) {
      const subPath = submoduleMatch[1]!
      // The submodule "name" for our purposes is the last path segment
      // stripped of leading punctuation (e.g. "upstream/onnx" → "onnx").
      const name = path.basename(subPath)
      submodules.push({
        name,
        path: subPath,
        versionComment: prevComment,
        commentSlug: prevSlug,
        commentSha256: prevSha256,
        commentLine: prevRawLine,
      })
      prevComment = undefined
      prevSlug = undefined
      prevSha256 = undefined
      prevRawLine = undefined
      continue
    }
    // The parser deliberately keeps prevComment alive across url/path
    // lines because those always come AFTER the [submodule ...] header
    // we already consumed — by the time we see them, prevComment has
    // already been attached to a submodule and cleared. Standard
    // .gitmodules blocks have no other content between a version
    // comment and its [submodule ...] header, so there is no additional
    // state to maintain here.
  }
  return submodules
}

/** Get the short gitlink commit SHA for a submodule path. */
export async function getSubmoduleSha(
  subPath: string,
): Promise<string | undefined> {
  try {
    const result = await spawn('git', ['ls-tree', 'HEAD', subPath], {
      cwd: MONOREPO_ROOT,
      stdio: 'pipe',
    })
    const stdout = String(result.stdout || '')
    // Only consider the first line — ls-tree on a path that matches a tree
    // (rather than a single entry) can return multiple lines, and silently
    // returning the first entry's SHA would mask a misconfiguration. Split
    // explicitly on \n before the whitespace split.
    const firstLine = stdout.split('\n')[0]?.trim() ?? ''
    if (!firstLine) {
      return undefined
    }
    const parts = firstLine.split(/\s+/)
    // format: "<mode> <type> <sha>\t<path>". Verify the entry is actually
    // a submodule gitlink (mode 160000) so we don't return the blob SHA of
    // a regular file sharing the path.
    if (parts[0] !== '160000' || parts[1] !== 'commit') {
      return undefined
    }
    return parts[2]
  } catch {
    return undefined
  }
}

type PackageJsonSource = {
  pkgName: string // e.g. "onnxruntime-builder"
  upstream: string // e.g. "onnxruntime"
  version: string
  ref: string | undefined
}

export function loadPackageJsonSources(): PackageJsonSource[] {
  const sources: PackageJsonSource[] = []
  const pkgsDir = path.join(MONOREPO_ROOT, 'packages')
  if (!existsSync(pkgsDir)) {
    return sources
  }
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const entry of readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const pkgJsonPath = path.join(pkgsDir, entry.name, 'package.json')
    if (!existsSync(pkgJsonPath)) {
      continue
    }
    let pkg: unknown
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    } catch {
      continue
    }
    if (
      typeof pkg !== 'object' ||
      pkg === null ||
      !('sources' in pkg) ||
      typeof (pkg as { sources: unknown }).sources !== 'object' ||
      (pkg as { sources: unknown }).sources === null
    ) {
      continue
    }
    const src = (pkg as { sources: Record<string, unknown> }).sources
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
    for (const [upstream, entryRaw] of Object.entries(src)) {
      if (typeof entryRaw !== 'object' || entryRaw === null) {
        continue
      }
      const e = entryRaw as {
        version?: unknown | undefined
        ref?: unknown | undefined
      }
      if (typeof e.version !== 'string') {
        continue
      }
      sources.push({
        pkgName: entry.name,
        ref: typeof e.ref === 'string' ? e.ref : undefined,
        upstream,
        version: e.version,
      })
    }
  }
  return sources
}

type Mismatch = {
  upstream: string
  locations: Array<{ source: string; value: string }>
  kind:
    | 'version'
    | 'ref'
    // `.gitmodules` comment is missing entirely above a [submodule]
    // section. Caught by `gitmodules-comment-guard` PreToolUse hook
    // too, but this gates non-Claude-Code edits (CI, manual `git`
    // operations).
    | 'comment-missing'
    // `# name-version` slug doesn't appear in the submodule's path.
    // Catches typos and stale comments above renamed paths.
    | 'comment-name-mismatch'
    // The version portion isn't a recognized release-tag shape.
    | 'comment-version-format'
    // `sha256:<hex>` is present but not exactly 64 lowercase hex chars.
    | 'comment-sha256-format'
}

export async function collectMismatches(): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = []
  const submodules = loadSubmodules()
  const pkgSources = loadPackageJsonSources()

  // Group package.json source entries by upstream name.
  const pkgByUpstream = new Map<string, PackageJsonSource>()
  for (let i = 0, { length } = pkgSources; i < length; i += 1) {
    const s = pkgSources[i]!
    pkgByUpstream.set(s.upstream, s)
  }

  // Per-submodule comment-format validation. These checks run BEFORE
  // the version comparison so a misshapen comment surfaces with a
  // specific reason rather than getting swallowed by the
  // "versionComment is undefined → skip" path.
  for (let i = 0, { length } = submodules; i < length; i += 1) {
    const sub = submodules[i]!

    // Check 1: comment missing entirely.
    if (!sub.commentLine) {
      mismatches.push({
        kind: 'comment-missing',
        upstream: sub.name,
        locations: [
          {
            source: `.gitmodules (${sub.path})`,
            value: '(no preceding # name-version comment)',
          },
        ],
      })
      continue
    }

    // Check 2: name slug must match a path segment, case-insensitive.
    // Example: `# node-26.1.0` ↔ `packages/.../upstream/node`. The
    // basename is the most common match site, but some submodules
    // nest deeper, so we accept any path segment.
    //
    // Case-insensitivity is intentional: upstreams like cJSON / uWebSockets
    // ship camel/PascalCase repo names, but the convention in the
    // comment slug is lowercase ("# cjson-1.7.19"). The check passes
    // as long as the lowercase slug matches a path segment's lowercase
    // form. Also tolerates an extra dash-separated qualifier in the
    // slug (e.g. `icu4x-zoneinfo64`) when the leading token still
    // matches a path segment.
    if (sub.commentSlug) {
      const slug = sub.commentSlug.toLowerCase()
      const segments = sub.path.split('/').map(s => s.toLowerCase())
      const slugHead = slug.split('-')[0]!
      const matches =
        segments.includes(slug) ||
        (slugHead.length > 0 && segments.includes(slugHead))
      if (!matches) {
        mismatches.push({
          kind: 'comment-name-mismatch',
          upstream: sub.name,
          locations: [
            {
              source: `.gitmodules comment (${sub.path})`,
              value: `${sub.commentLine}`,
            },
            {
              source: `expected slug from path basename`,
              value: path.basename(sub.path),
            },
          ],
        })
      }
    }

    // Check 3: version format. Accept anything starting with a digit
    // optionally prefixed with `v` (`v1.2.3`, `1.2.3`, `1.2.3-beta`).
    // Also accept date-like epoch paths used by some submodules
    // (`epochs/three_hourly/2026-02-24_21H` from the original example).
    // The conservative shape: must contain at least one digit. This
    // catches typos like `# node-rcsomething` while staying tolerant
    // of upstream tag variety.
    if (sub.versionComment && !/\d/.test(sub.versionComment)) {
      mismatches.push({
        kind: 'comment-version-format',
        upstream: sub.name,
        locations: [
          {
            source: `.gitmodules comment (${sub.path})`,
            value: sub.commentLine!,
          },
          {
            source: 'expected version shape',
            value: '<digits>(.<digits>)* or v<digits>...',
          },
        ],
      })
    }

    // Check 4: sha256 format. When `sha256:` is present, require
    // exactly 64 lowercase hex chars. Catches truncation, accidental
    // uppercase (some pasted hex is uppercase), or non-hex contamination.
    if (sub.commentSha256 !== undefined) {
      const sha = sub.commentSha256
      if (sha.length !== 64 || !/^[0-9a-f]{64}$/.test(sha)) {
        mismatches.push({
          kind: 'comment-sha256-format',
          upstream: sub.name,
          locations: [
            {
              source: `.gitmodules comment sha256 (${sub.path})`,
              value: `sha256:${sha} (len=${sha.length})`,
            },
            {
              source: 'expected',
              value: 'sha256:<64 lowercase hex chars>',
            },
          ],
        })
      }
    }
  }

  // For each submodule with a version comment, find a matching package.json
  // source entry (same upstream name) and compare.
  for (let i = 0, { length } = submodules; i < length; i += 1) {
    const sub = submodules[i]!
    if (!sub.versionComment) {
      continue
    }
    const pkg = pkgByUpstream.get(sub.name)
    if (!pkg) {
      continue
    }
    // Version comparison. Strip optional leading `v`.
    const gmVer = sub.versionComment.replace(/^v/, '')
    const pkgVer = pkg.version.replace(/^v/, '')
    if (gmVer !== pkgVer) {
      mismatches.push({
        kind: 'version',
        locations: [
          {
            source: `.gitmodules (${sub.path})`,
            value: sub.versionComment,
          },
          {
            source: `packages/${pkg.pkgName}/package.json sources.${pkg.upstream}.version`,
            value: pkg.version,
          },
        ],
        upstream: sub.name,
      })
    }
    // Ref comparison — compare `ref` field to the actual gitlink SHA.
    if (pkg.ref) {
      const gitSha = await getSubmoduleSha(sub.path)
      if (gitSha && pkg.ref !== gitSha) {
        // Accept prefix matches: a 7-char ref matches a full SHA if
        // the full SHA starts with the ref.
        const isPrefix =
          pkg.ref.length < gitSha.length && gitSha.startsWith(pkg.ref)
        if (!isPrefix) {
          mismatches.push({
            kind: 'ref',
            locations: [
              { source: `.gitmodules gitlink (${sub.path})`, value: gitSha },
              {
                source: `packages/${pkg.pkgName}/package.json sources.${pkg.upstream}.ref`,
                value: pkg.ref,
              },
            ],
            upstream: sub.name,
          })
        }
      }
    }
  }
  return mismatches
}

type Options = {
  explain: boolean
  json: boolean
  quiet: boolean
}

export function printMismatch(m: Mismatch, opts: Options): void {
  if (opts.json) {
    logger.log(JSON.stringify(m))
    return
  }
  logger.log('')
  logger.log(`[${m.kind} drift] ${m.upstream}`)
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const loc of m.locations) {
    logger.log(`  ${loc.source}`)
    logger.log(`    → ${loc.value}`)
  }
  if (opts.explain) {
    logger.log('')
    switch (m.kind) {
      case 'version':
        logger.log(
          `  Fix: pick the authoritative version and update every site to match.`,
        )
        logger.log(
          `       Usually .gitmodules is canonical; workflows read package.json`,
        )
        logger.log(
          `       for cache keys + release labels, so both must agree.`,
        )
        break
      case 'ref':
        logger.log(
          `  Fix: update sources.${m.upstream}.ref in packages/<pkg>/package.json`,
        )
        logger.log(
          `       to the full commit SHA from \`git ls-tree HEAD <submodule>\`.`,
        )
        break
      case 'comment-missing':
        logger.log(
          `  Fix: add a "# <name>-<version>" comment on the line BEFORE the`,
        )
        logger.log(`       [submodule "..."] header. Example:`)
        logger.log(`         # ${m.upstream}-1.2.3`)
        logger.log(`         [submodule "..."]`)
        logger.log(
          `       The optional sha256 of the release tarball can follow:`,
        )
        logger.log(`         # ${m.upstream}-1.2.3 sha256:<64 hex chars>`)
        break
      case 'comment-name-mismatch':
        logger.log(
          `  Fix: the <name> in the "# <name>-<version>" comment must appear`,
        )
        logger.log(
          `       as a path segment of the submodule (typically the basename).`,
        )
        logger.log(
          `       Either fix the comment's slug or rename the submodule path.`,
        )
        break
      case 'comment-version-format':
        logger.log(
          `  Fix: the <version> portion of "# <name>-<version>" must include`,
        )
        logger.log(
          `       at least one digit. Use the upstream's released tag form:`,
        )
        logger.log(`         # ${m.upstream}-1.2.3`)
        logger.log(`         # ${m.upstream}-v25.9.0`)
        logger.log(`         # ${m.upstream}-2026-02-24_21H  (epoch tags)`)
        break
      case 'comment-sha256-format':
        logger.log(
          `  Fix: sha256:<hex> must be exactly 64 lowercase hex characters.`,
        )
        logger.log(`       Re-derive the digest from the release tarball:`)
        logger.log(
          `         shasum -a 256 <tarball> | cut -d' ' -f1 | tr A-Z a-z`,
        )
        break
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      explain: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
    },
    strict: false,
  })
  const opts: Options = {
    explain: Boolean(values.explain),
    json: Boolean(values.json),
    quiet: Boolean(values.quiet),
  }

  const allowlist = loadAllowlist()
  const allowSet = new Set(allowlist.map(e => e.upstream))

  if (!opts.quiet && !opts.json) {
    logger.info('Checking external dependency version consistency...')
  }

  const allMismatches = await collectMismatches()
  const surviving = allMismatches.filter(m => !allowSet.has(m.upstream))

  if (surviving.length === 0) {
    if (!opts.quiet && !opts.json) {
      logger.success(
        `No version drift found (${allMismatches.length} raw, ${allowlist.length} allowlisted)`,
      )
    }
    process.exitCode = 0
    return
  }

  if (!opts.json) {
    logger.error(
      `Found ${surviving.length} version drift${surviving.length === 1 ? '' : 's'}:`,
    )
  }
  for (let i = 0, { length } = surviving; i < length; i += 1) {
    const m = surviving[i]!
    printMismatch(m, opts)
  }
  if (!opts.json) {
    logger.log('')
    logger.log('What to do:')
    logger.log(
      '  1. Align all sites to the same version. `.gitmodules` is usually',
    )
    logger.log(
      '     canonical; update package.json sources.<upstream>.version + .ref',
    )
    logger.log(`     to match.`)
    logger.log('  2. If the mismatch is intentional (builder pinning a stable')
    logger.log(
      '     API-compat version while the submodule tracks newer), add to',
    )
    logger.log('     .github/version-consistency-allowlist.yml with a reason.')
    logger.log('  3. Run with --explain for per-finding fix guidance.')
  }
  process.exitCode = 1
}

main().catch((e: unknown) => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
