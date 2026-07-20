/**
 * @file Collectors for `check-version-consistency.mts`. Loads the two
 *   primary sources of truth for an upstream dependency's pinned version
 *   (`.gitmodules` comments + gitlink SHAs, `package.json` `sources.*`
 *   entries) and cross-references them into `Mismatch` findings. Split out
 *   of the main checker so the orchestration file (arg parsing, allowlist,
 *   report printing) stays under the file-size soft cap.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
export const MONOREPO_ROOT = path.join(__dirname, '..')
const GITMODULES_PATH = path.join(MONOREPO_ROOT, '.gitmodules')

export type Submodule = {
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

/**
 * Walk .gitmodules for submodules + their version comments.
 */
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

/**
 * Get the short gitlink commit SHA for a submodule path.
 */
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

export type PackageJsonSource = {
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

export type Mismatch = {
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
      const segments = normalizePath(sub.path)
        .split('/')
        .map(s => s.toLowerCase())
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
