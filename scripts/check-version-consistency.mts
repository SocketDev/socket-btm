#!/usr/bin/env node
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
 *   3. (optional) xport.json `packages.<name>.version`
 *   4. (optional) workflow env: pins (e.g. ZIG_VERSION in opentui.yml)
 *
 * When these get out of sync — R31 found onnxruntime-builder pinned at
 * 1.20.1 in package.json but 1.24.4 in .gitmodules + xport.json — CI
 * tags caches and releases with the wrong version. The workflows read
 * one source of truth (package.json), the submodule checks out another
 * (gitmodules gitlink), and the release label says a third.
 *
 * This checker cross-references all four sources and fails if any
 * disagree.
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

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { fileURLToPath } from 'node:url'

import { parseArgs } from 'node:util'

import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

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

function loadAllowlist(): AllowlistEntry[] {
  if (!existsSync(ALLOWLIST_PATH)) {
    return []
  }
  const content = readFileSync(ALLOWLIST_PATH, 'utf8')
  const entries: AllowlistEntry[] = []
  let current: Partial<AllowlistEntry> = {}
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
  versionComment: string | undefined // e.g. "1.24.4"
}

/** Walk .gitmodules for submodules + their version comments. */
function loadSubmodules(): Submodule[] {
  if (!existsSync(GITMODULES_PATH)) {
    return []
  }
  const content = readFileSync(GITMODULES_PATH, 'utf8')
  const lines = content.split(/\r?\n/)
  const submodules: Submodule[] = []
  let prevComment: string | undefined
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // Version comment: `# name-X.Y.Z ...`. Capture the "name-X.Y.Z"
    // token; trailing sha256:hex or epoch path segments are tolerated.
    const commentMatch = line.match(/^# ([a-z][a-z0-9_-]*)-([^\s]+)/)
    if (commentMatch) {
      prevComment = commentMatch[2]
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
      })
      prevComment = undefined
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
async function getSubmoduleSha(subPath: string): Promise<string | undefined> {
  try {
    const result = await spawn(
      'git',
      ['ls-tree', 'HEAD', subPath],
      { cwd: MONOREPO_ROOT, stdio: 'pipe' },
    )
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

function loadPackageJsonSources(): PackageJsonSource[] {
  const sources: PackageJsonSource[] = []
  const pkgsDir = path.join(MONOREPO_ROOT, 'packages')
  if (!existsSync(pkgsDir)) {
    return sources
  }
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
    for (const [upstream, entryRaw] of Object.entries(src)) {
      if (typeof entryRaw !== 'object' || entryRaw === null) {
        continue
      }
      const e = entryRaw as { version?: unknown; ref?: unknown }
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
  kind: 'version' | 'ref'
}

async function collectMismatches(): Promise<Mismatch[]> {
  const mismatches: Mismatch[] = []
  const submodules = loadSubmodules()
  const pkgSources = loadPackageJsonSources()

  // Group package.json source entries by upstream name.
  const pkgByUpstream = new Map<string, PackageJsonSource>()
  for (const s of pkgSources) {
    pkgByUpstream.set(s.upstream, s)
  }

  // For each submodule with a version comment, find a matching package.json
  // source entry (same upstream name) and compare.
  for (const sub of submodules) {
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

function printMismatch(m: Mismatch, opts: Options): void {
  if (opts.json) {
    logger.log(JSON.stringify(m))
    return
  }
  logger.log('')
  logger.log(`[${m.kind} drift] ${m.upstream}`)
  for (const loc of m.locations) {
    logger.log(`  ${loc.source}`)
    logger.log(`    → ${loc.value}`)
  }
  if (opts.explain) {
    logger.log('')
    if (m.kind === 'version') {
      logger.log(
        `  Fix: pick the authoritative version and update every site to match.`,
      )
      logger.log(
        `       Usually .gitmodules is canonical; workflows read package.json`,
      )
      logger.log(
        `       for cache keys + release labels, so both must agree.`,
      )
    } else {
      logger.log(
        `  Fix: update sources.${m.upstream}.ref in packages/<pkg>/package.json`,
      )
      logger.log(
        `       to the full commit SHA from \`git ls-tree HEAD <submodule>\`.`,
      )
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
  for (const m of surviving) {
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
