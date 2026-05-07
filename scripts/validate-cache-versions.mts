#!/usr/bin/env node

/**
 * Cache Version Cascade Validator
 *
 * Validates that cache versions are bumped correctly when source packages change.
 * This enforces the cascade dependencies documented in CLAUDE.md.
 *
 * Run in CI to ensure developers don't forget to bump dependent cache versions.
 */
import process from 'node:process'

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { errorMessage } from 'build-infra/lib/error-utils'
import { spawn } from '@socketsecurity/lib/spawn'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.resolve(__dirname, '..')

const logger = getDefaultLogger()

type CacheVersions = Record<string, string>

type CacheVersionsFile = {
  versions: CacheVersions
}

type MissingBump = {
  current: string | undefined
  package: string
  previous: string | undefined
}

// Cache version cascade rules per CLAUDE.md
// Key: Source path prefix, Value: Cache keys that must be bumped when that path changes.
// `src/` mirrors the C++ canonical sources (copied into additions/ during
// build). `lib/` holds the TypeScript helpers every builder imports from
// (`checkpoint-manager`, `platform-mappings`, etc.). Both must cascade
// downstream — a bug fix in checkpoint-manager.mts affects every package
// that builds via it, not just the ones that embed the C++ source.
const ALL_DOWNSTREAM = [
  'binflate',
  'binject',
  'binpress',
  'curl',
  'ink',
  'iocraft',
  'lief',
  'models',
  'node-smol',
  'onnxruntime',
  'opentui',
  'stubs',
  'yoga-layout',
]

const CASCADE_RULES = {
  'packages/bin-infra/lib/': ALL_DOWNSTREAM,
  'packages/bin-infra/src/socketsecurity/bin-infra/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  // binflate runtime is embedded in node-smol's compressed binary via the
  // self-extracting stub — an edit to binflate/src must bump node-smol too.
  'packages/binflate/src/': ['binflate', 'node-smol'],
  // binpress compiles binject's smol_config.c directly via its Makefiles,
  // so a binject/src edit changes the compiled binpress binary and must
  // cascade there too.
  'packages/binject/src/socketsecurity/binject/': [
    'binject',
    'binpress',
    'node-smol',
  ],
  // ink bundles the yoga-sync.mjs produced by yoga-layout-builder's
  // scripts, so yoga-layout source edits must cascade to ink. Note:
  // yoga-layout-builder has no patches/ directory today (upstream yoga
  // absorbed our patches); the rule is kept off the list until the
  // directory returns, otherwise the validator would reference a dead
  // path and misleadingly suggest coverage.
  'packages/yoga-layout-builder/scripts/': ['yoga-layout', 'ink'],
  'packages/yoga-layout-builder/src/': ['yoga-layout', 'ink'],
  'packages/binpress/src/': ['binpress', 'node-smol'],
  'packages/build-infra/lib/': ALL_DOWNSTREAM,
  'packages/build-infra/src/socketsecurity/build-infra/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  // build-infra/wasm-synced/ holds the WASM sync wrapper generator +
  // transform helpers that yoga-layout-builder and onnxruntime-builder
  // import from build-infra/wasm-synced/*. ink bundles the produced
  // yoga-sync.mjs so cascades to ink too.
  'packages/build-infra/wasm-synced/': ['yoga-layout', 'onnxruntime', 'ink'],
  // release-assets.json holds SHA-256 checksums for every released
  // binary (curl, lief, stubs, zstd, binject, binflate, binpress, …)
  // consumed by build-infra/lib/release-checksums.mts during offline
  // builds. A checksum update after a new release MUST invalidate
  // every downstream cache so old binaries aren't trusted.
  'packages/build-infra/release-assets.json': ALL_DOWNSTREAM,
  // external-tools.json pins the foundational toolchain (cmake, ninja,
  // clang, gcc, mingw-w64, python, binutils, ccache, musl-tools, …)
  // loaded by every downstream builder via pinned-versions.mts +
  // install-tools.mts. A bump there changes what actually compiles
  // the binaries, so every cache must invalidate.
  'packages/build-infra/external-tools.json': ALL_DOWNSTREAM,
  // build-infra/scripts/ holds shared helpers invoked at build time:
  //   get-checkpoint-chain.mts (delegated to by binflate/binject/
  //     binpress/stubs-builder/libpq-builder)
  //   get-tool-version.mts (called by node-smol.yml + yoga Dockerfile)
  //   smoke-test-binary.mts (called by binsuite.yml + node-smol.yml)
  // An edit there changes chain composition / tool version resolution
  // across every downstream builder, so cascade to all of them.
  'packages/build-infra/scripts/': ALL_DOWNSTREAM,
  // .github/scripts/ holds Docker bootstrappers RUN'd from every
  // binsuite + stubs + node-smol Dockerfile (build-static-openssl.sh
  // hard-codes OPENSSL_VERSION, ensure-zstd.sh fetches zstd when
  // submodule is missing). A bump there silently changes linked
  // OpenSSL across every downstream binary; must cascade.
  '.github/scripts/': ['stubs', 'binflate', 'binject', 'binpress', 'node-smol'],
  // stubs build scripts / Dockerfiles / .mk helpers all influence the
  // produced stub binary. Cascading is identical to src/.
  'packages/stubs-builder/docker/': ['stubs', 'binpress', 'node-smol'],
  'packages/stubs-builder/make/': ['stubs', 'binpress', 'node-smol'],
  'packages/stubs-builder/scripts/': ['stubs', 'binpress', 'node-smol'],
  'packages/stubs-builder/src/': ['stubs', 'binpress', 'node-smol'],
  // curl-builder produces libcurl which stubs links; node-smol embeds
  // stubs. Scripts + Dockerfiles change the compiled curl, so a
  // script-only edit (e.g. new compile flag, new CA bundle path) must
  // bump curl → cascade to stubs + node-smol. lib/ensure-curl is
  // imported by both stubs-builder/scripts/build.mts and
  // bin-infra/lib/build-stubs.mts.
  'packages/curl-builder/docker/': ['curl', 'stubs', 'node-smol'],
  'packages/curl-builder/lib/': ['curl', 'stubs', 'node-smol'],
  'packages/curl-builder/scripts/': ['curl', 'stubs', 'node-smol'],
  // lief-builder/make/lief.mk exports LIEF_CFLAGS / LIEF_DEFINES that
  // binpress + binject Makefiles include; node-smol embeds binpress.
  'packages/lief-builder/make/': [
    'lief',
    'binject',
    'binpress',
    'node-smol',
  ],
  // lief-builder patches change the LIEF library that binject/binpress/
  // node-smol link against.
  'packages/lief-builder/patches/': [
    'lief',
    'binject',
    'binpress',
    'node-smol',
  ],
  // lief-builder/lib/ensure-lief.mts re-exports from scripts/build.mts
  // and is imported by binject + binpress build.mts/test.mts. A change
  // to the download / verify / cache-path logic ships altered LIEF
  // discovery to binject + binpress without touching any of the other
  // rules above. Parallels the curl-builder/{docker,lib,scripts}/
  // cascade added in R19. docker/ added in R21 — Dockerfiles produce
  // the LIEF binary that downstream consumers download via ensure-lief.
  'packages/lief-builder/docker/': [
    'lief',
    'binject',
    'binpress',
    'node-smol',
  ],
  'packages/lief-builder/lib/': [
    'lief',
    'binject',
    'binpress',
    'node-smol',
  ],
  'packages/lief-builder/scripts/': [
    'lief',
    'binject',
    'binpress',
    'node-smol',
  ],
  // build-infra/make/ holds common.mk, crypto.mk, platform-*.mk — every
  // Makefile in binsuite + stubs + node-smol `include`s at least one.
  // Full downstream cascade matches build-infra/lib/ pattern.
  'packages/build-infra/make/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
  // bin-infra/make/ holds zstd.mk + bin-infra-rules.mk; same consumers.
  'packages/bin-infra/make/': [
    'stubs',
    'binflate',
    'binject',
    'binpress',
    'node-smol',
  ],
}

function validateBranchName(branchName: string): string {
  // Validate branch name to prevent command injection
  // Allow: alphanumeric, slashes, hyphens, underscores, dots
  if (!/^[\w./-]+$/.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}`)
  }
  return branchName
}

async function getChangedFiles(baseBranch = 'origin/main'): Promise<string[]> {
  try {
    // Validate branch name to prevent command injection
    const safeBranch = validateBranchName(baseBranch)
    // Get list of changed files between current HEAD and base branch
    const { stdout } = await spawn(
      'git',
      ['diff', '--name-only', `${safeBranch}...HEAD`],
      { cwd: MONOREPO_ROOT },
    )
    const output = String(stdout).trim()
    return output ? output.split('\n') : []
  } catch {
    // Fallback: compare to previous commit
    try {
      const { stdout } = await spawn(
        'git',
        ['diff', '--name-only', 'HEAD~1', 'HEAD'],
        { cwd: MONOREPO_ROOT },
      )
      const output = String(stdout).trim()
      return output ? output.split('\n') : []
    } catch {
      return []
    }
  }
}

function getCacheVersions(): CacheVersions {
  const cacheVersionsPath = path.join(
    MONOREPO_ROOT,
    '.github/cache-versions.json',
  )
  if (!existsSync(cacheVersionsPath)) {
    throw new Error(`Cache versions file not found: ${cacheVersionsPath}`)
  }
  const content = readFileSync(cacheVersionsPath, 'utf8')
  return (JSON.parse(content) as CacheVersionsFile).versions
}

function parseVersion(versionString: string): number {
  // Parse "v123" → 123
  const match = versionString.match(/^v(\d+)$/)
  return match ? Number.parseInt(match[1]!, 10) : 0
}

async function main(): Promise<void> {
  const argv: string[] = process.argv
  const baseBranchInput = argv[2] || 'origin/main'
  // Validate branch name early to prevent command injection
  const baseBranch = validateBranchName(baseBranchInput)
  logger.info(`Validating cache version cascade (base: ${baseBranch})...`)

  const changedFiles = await getChangedFiles(baseBranch)
  if (changedFiles.length === 0) {
    logger.info('No changed files detected. Nothing to validate.')
    process.exitCode = 0
    return
  }

  logger.info(`Changed files (${changedFiles.length}):`)
  changedFiles.forEach(f => logger.info(`  - ${f}`))

  // Check if cache-versions.json was modified
  const cacheVersionsChanged = changedFiles.includes(
    '.github/cache-versions.json',
  )

  // Determine which packages need cache bumps based on changed source files
  const requiredBumps = new Set<string>()

  for (const file of changedFiles) {
    for (const [pathPrefix, packages] of Object.entries(CASCADE_RULES)) {
      if (file.startsWith(pathPrefix)) {
        packages.forEach(pkg => requiredBumps.add(pkg))
      }
    }
  }

  if (requiredBumps.size === 0) {
    logger.info('No source package changes detected that require cache bumps.')
    process.exitCode = 0
    return
  }

  logger.info('Required cache version bumps:')
  requiredBumps.forEach(pkg => logger.info(`  - ${pkg}`))

  // If cache-versions.json wasn't modified, that's an error
  if (!cacheVersionsChanged) {
    logger.error(
      'Source packages changed but .github/cache-versions.json was not modified.',
    )
    logger.error('You must bump cache versions for the following packages:')
    requiredBumps.forEach(pkg => logger.error(`  - ${pkg}`))
    logger.error(
      'See CLAUDE.md "Cache Version Cascade Dependencies" for details.',
    )
    process.exitCode = 1
    return
  }

  // Get current and previous cache versions to verify bumps actually happened
  try {
    const currentVersions = getCacheVersions()

    // Get previous versions from base branch
    let previousVersions: CacheVersions
    try {
      const { stdout } = await spawn(
        'git',
        ['show', `${baseBranch}:.github/cache-versions.json`],
        { cwd: MONOREPO_ROOT },
      )
      previousVersions = (JSON.parse(String(stdout)) as CacheVersionsFile).versions
    } catch {
      logger.warn('Could not get previous cache versions from base branch.')
      logger.warn(
        'Assuming this is a new addition or base branch is unavailable.',
      )
      process.exitCode = 0
      return
    }

    // Check each required bump actually happened
    const missingBumps: MissingBump[] = []
    for (const pkg of requiredBumps) {
      const current = parseVersion(currentVersions[pkg] || 'v0')
      const previous = parseVersion(previousVersions[pkg] || 'v0')

      if (current <= previous) {
        missingBumps.push({
          current: currentVersions[pkg],
          package: pkg,
          previous: previousVersions[pkg],
        })
      }
    }

    if (missingBumps.length > 0) {
      logger.error('Cache versions were not properly bumped:')
      missingBumps.forEach(({ current, package: pkg, previous }) => {
        logger.error(`  - ${pkg}: ${previous} → ${current} (should increase)`)
      })
      logger.error(
        'See CLAUDE.md "Cache Version Cascade Dependencies" for details.',
      )
      process.exitCode = 1
      return
    }

    logger.success('All required cache version bumps verified.')
    process.exitCode = 0
  } catch (e) {
    logger.error(`Error validating cache versions: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

main().catch(e => {
  logger.error(errorMessage(e))
  process.exitCode = 1
})
