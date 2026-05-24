#!/usr/bin/env node
/**
 * @fileoverview Verify upstream tier publishes are fresh before dispatching a
 * downstream builder. Hard-fails when a downstream workflow (stubs, binsuite,
 * node-smol) is about to consume STALE upstream artifacts because cache-versions
 * was bumped without re-publishing the upstream.
 *
 * Publish chain:
 *   (curl ∥ lief) → stubs → binsuite → node-smol
 *
 * Without this gate, dispatching out of order silently pulls binaries from
 * the prior cache-version: no hard error, just wrong artifacts. This script
 * makes the staleness loud.
 *
 * Usage:
 *   node scripts/check-publish-prereq.mts <package>
 *
 * Where <package> is one of: stubs, binsuite, node-smol.
 *
 * For each upstream tier the chosen package depends on, the script:
 *  1. Reads .github/cache-versions.json to find the upstream's current version
 *  2. Walks `git log --oneline .github/cache-versions.json` to find the commit
 *     that introduced that version line
 *  3. Queries `gh release list` to find the most recent published release for
 *     the upstream (e.g. `curl-<date>-<sha>`)
 *  4. Verifies the release's commit SHA is >= the cache-version bump SHA in
 *     main's history. If not, exit 1 with a clear message.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'

const logger = getDefaultLogger()

// Publish dependency chain (see CLAUDE.md "Builder publish dispatch order"):
//
//   Parallel leaves (curl, lief, libpq, dawn, yoga-layout, opentui, onnxruntime)
//     fan into stubs (curl + lief), then binsuite (stubs + lief),
//     then node-smol (binsuite + every leaf above).
//
// Tier-1b builders (codet5-models, minilm, ultraviolet) publish
// independently and are NOT in CHAIN — node-smol does not depend on them;
// they flow to socket-cli + other downstream consumers.
//
// `binsuite` ships three releases (binflate, binject, binpress) from a
// single workflow file (binsuite.yml). cache-versions.json keys the three
// individually. The `dispatchWorkflow` field on each upstream entry
// controls the error message — if multiple deps share the same workflow,
// they coalesce into one "Run binsuite.yml" hint instead of three
// separate "binflate.yml / binject.yml / binpress.yml" suggestions for a
// non-existent set of workflows.
interface UpstreamEntry {
  pkg: string
  dispatchWorkflow: string
}
interface ChainEntry {
  pkg: string
  deps: UpstreamEntry[]
}
const STUBS_DEPS: UpstreamEntry[] = [
  { pkg: 'curl', dispatchWorkflow: 'curl.yml' },
  { pkg: 'lief', dispatchWorkflow: 'lief.yml' },
]
// binsuite (binflate / binject / binpress) all consume lief and stubs at
// build time. binject directly links LIEF; binpress packs the stubs
// binary. So the binsuite workflow itself needs lief+stubs fresh too.
const BINSUITE_DEPS: UpstreamEntry[] = [
  { pkg: 'lief', dispatchWorkflow: 'lief.yml' },
  { pkg: 'stubs', dispatchWorkflow: 'stubs.yml' },
]
// Each entry below fires the freshness gate before node-smol publish runs,
// requiring that builder's workflow to be re-dispatched when its
// cache-version bumps. Two workflows don't yet exist on disk:
// dawn.yml + libpq.yml — land in follow-up commits, dispatchWorkflow
// string is the pre-declared name so the error message points the
// right direction.
const NODE_SMOL_DEPS: UpstreamEntry[] = [
  { pkg: 'binflate', dispatchWorkflow: 'binsuite.yml' },
  { pkg: 'binject', dispatchWorkflow: 'binsuite.yml' },
  { pkg: 'binpress', dispatchWorkflow: 'binsuite.yml' },
  { pkg: 'dawn', dispatchWorkflow: 'dawn.yml' },
  { pkg: 'libpq', dispatchWorkflow: 'libpq.yml' },
  { pkg: 'onnxruntime', dispatchWorkflow: 'onnxruntime.yml' },
  { pkg: 'opentui', dispatchWorkflow: 'opentui.yml' },
  { pkg: 'yoga-layout', dispatchWorkflow: 'yoga-layout.yml' },
]
const CHAIN: ChainEntry[] = [
  // Leaves — no upstream deps.
  { pkg: 'curl', deps: [] },
  { pkg: 'dawn', deps: [] },
  { pkg: 'libpq', deps: [] },
  { pkg: 'lief', deps: [] },
  { pkg: 'onnxruntime', deps: [] },
  { pkg: 'opentui', deps: [] },
  { pkg: 'yoga-layout', deps: [] },
  // stubs links libcurl + libLIEF.
  { pkg: 'stubs', deps: STUBS_DEPS },
  // binsuite (binflate/binject/binpress) links LIEF + stubs.
  { pkg: 'binsuite', deps: BINSUITE_DEPS },
  // node-smol links every leaf + binsuite output.
  { pkg: 'node-smol', deps: NODE_SMOL_DEPS },
]

// oxlint-disable-next-line socket/no-process-cwd-in-scripts-hooks -- check-publish-prereq.mts is invoked from `pnpm run check:publish-prereq` which sets cwd=REPO_ROOT
const repoRoot = process.cwd()
const cacheVersionsPath = path.join(repoRoot, '.github', 'cache-versions.json')

if (!existsSync(cacheVersionsPath)) {
  logger.fail(`cache-versions.json not found at ${cacheVersionsPath}`)
  process.exit(1)
}

const cacheVersions = JSON.parse(readFileSync(cacheVersionsPath, 'utf8')) as {
  versions: Record<string, string>
}

export async function checkUpstream(
  downstream: string,
  upstream: UpstreamEntry,
): Promise<void> {
  const { pkg, dispatchWorkflow } = upstream
  const version = cacheVersions.versions[pkg]
  if (!version) {
    throw new Error(`upstream ${pkg} not found in cache-versions.json`)
  }
  const bumpSha = await findCacheVersionBumpSha(pkg, version)
  if (!bumpSha) {
    logger.warn(
      `could not locate cache-version bump commit for ${pkg}@${version} — skipping freshness gate`,
    )
    return
  }
  const release = await findLatestRelease(pkg)
  if (!release) {
    throw new Error(
      `${downstream} requires a published ${pkg} release, but none was found via \`gh release list\`.\n` +
        `  Dispatch ${dispatchWorkflow} first: gh workflow run ${dispatchWorkflow} -f dry-run=false`,
    )
  }

  // Stage 1: date check (cheap, fails fast on the common case where the
  // bump landed on a later day than the latest release).
  const bumpDate = await commitDate(bumpSha)
  if (bumpDate && release.date < bumpDate) {
    throw new Error(
      `${downstream} cannot dispatch: ${pkg} cache-version bumped on ${bumpDate} ` +
        `but the latest ${pkg} release is dated ${release.date} (BEFORE the bump). ` +
        `Re-publish ${pkg}.\n` +
        `  Run: gh workflow run ${dispatchWorkflow} -f dry-run=false`,
    )
  }

  // Stage 2: SHA-ancestry check (catches the edge case where bump and
  // release happened on the same day — date-only would falsely pass).
  const releaseSha = await resolveSha(release.sha)
  if (!releaseSha) {
    throw new Error(
      `${pkg} release tag points at SHA ${release.sha} which is not in this clone's history.\n` +
        `  Did you forget \`git fetch\`? If the SHA was rewritten on main, re-publish ${pkg}.`,
    )
  }
  const releaseHasBump = await isDescendantOrEqual(releaseSha, bumpSha)
  if (!releaseHasBump) {
    throw new Error(
      `${downstream} cannot dispatch: ${pkg} cache-version bumped at ${bumpSha.slice(0, 8)} ` +
        `but the latest ${pkg} release was published from ${release.sha} ` +
        `(date matches but SHA predates the bump). Re-publish ${pkg}.\n` +
        `  Run: gh workflow run ${dispatchWorkflow} -f dry-run=false`,
    )
  }

  logger.success(
    `${pkg} released ${release.date} @ ${release.sha} (>= bump ${bumpDate ?? '?'} @ ${bumpSha.slice(0, 8)})`,
  )
}

// Get the YYYYMMDD date of a commit. Used for the cheap date-first gate.
export async function commitDate(sha: string): Promise<string | undefined> {
  try {
    const iso = await git('show', '-s', '--format=%cs', sha)
    // %cs is YYYY-MM-DD; strip dashes for direct lex compare.
    return iso.replaceAll('-', '')
  } catch {
    return undefined
  }
}

// Find the commit SHA where `<package>: "<version>"` was last set in
// cache-versions.json. Uses `git log -L` to follow the line.
export async function findCacheVersionBumpSha(
  pkg: string,
  version: string,
): Promise<string | undefined> {
  // `-G` takes an extended regex; `git log` runs it against ADDED+REMOVED
  // lines for the path, so we search for the value-side appearance to find
  // the commit that introduced the current value.
  const log = await git(
    'log',
    '--format=%H',
    '-G',
    `"${pkg}":[[:space:]]*"${version}"`,
    '--',
    '.github/cache-versions.json',
  )
  const lines = log.split('\n').filter(Boolean)
  return lines[0] // most recent (HEAD-most) match
}

// Find the most recent published release for `<pkg>`. Tag format:
// `<pkg>-<YYYYMMDD>-<short-sha>`. Returns both the date and short SHA so
// the gate can do a cheap date check first then escalate to SHA-ancestry.
export async function findLatestRelease(
  pkg: string,
): Promise<{ date: string; sha: string } | undefined> {
  const out = await gh('release', 'list', '--limit', '20', '--json', 'tagName')
  const releases = JSON.parse(out) as Array<{ tagName: string }>
  const tag = releases.find(r => r.tagName.startsWith(`${pkg}-`))?.tagName
  if (!tag) {
    return undefined
  }
  // Match `<pkg>-<YYYYMMDD>-<short-sha>`. Tag may include a leading
  // `<pkg> ` (with space) form too; gh release list uses the actual tag.
  const m = /^[^-]+-(\d{8})-([0-9a-f]{7,40})$/.exec(tag)
  if (!m) {
    return undefined
  }
  return { date: m[1]!, sha: m[2]! }
}

export async function gh(...args: string[]): Promise<string> {
  const r = await spawn('gh', args, { stdio: 'pipe' })
  return (r.stdout?.toString() ?? '').trim()
}

export async function git(...args: string[]): Promise<string> {
  const r = await spawn('git', args, { stdio: 'pipe' })
  return (r.stdout?.toString() ?? '').trim()
}

// Check whether commit `descendant` is an ancestor-or-equal of `ancestor` in
// main's history (i.e. `descendant` was made AFTER `ancestor`).
export async function isDescendantOrEqual(
  descendant: string,
  ancestor: string,
): Promise<boolean> {
  if (descendant === ancestor) {
    return true
  }
  // git merge-base --is-ancestor returns 0 if first is ancestor of second.
  try {
    await spawn('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

// Resolve a short SHA to a full commit SHA in the local clone.
export async function resolveSha(short: string): Promise<string | undefined> {
  try {
    return await git('rev-parse', short)
  } catch {
    return undefined
  }
}

async function main(): Promise<void> {
  const target = process.argv[2]
  if (!target) {
    logger.fail('Usage: node scripts/check-publish-prereq.mts <package>')
    logger.fail('       packages: ' + CHAIN.map(c => c.pkg).join(', '))
    process.exit(1)
  }
  const entry = CHAIN.find(c => c.pkg === target)
  if (!entry) {
    logger.fail(`unknown package: ${target}`)
    logger.fail('  must be one of: ' + CHAIN.map(c => c.pkg).join(', '))
    process.exit(1)
  }
  if (entry.deps.length === 0) {
    logger.success(
      `${target} has no upstream dependencies — nothing to verify.`,
    )
    return
  }
  logger.log(`Checking publish-chain freshness for ${target}...`)
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
  for (const dep of entry.deps) {
    await checkUpstream(target, dep)
  }
  logger.success(`all ${target} prerequisites are fresh.`)
}

// Skip execution when imported (e.g. scripts/build-status.mts reuses
// the gh-release + git-ancestry helpers above). The CLI entry is
// direct `node scripts/check-publish-prereq.mts <package>` invocation.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => {
    logger.fail(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
