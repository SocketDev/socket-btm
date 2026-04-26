#!/usr/bin/env node
/**
 * @fileoverview Check runner - runs code quality checks.
 * Runs linting checks for socket-btm.
 *
 * Usage:
 *   node scripts/check.mts [options]
 *
 * Options:
 *   --quiet    Suppress progress output
 *   --fix      Auto-fix issues where possible
 */
import process from 'node:process'

import { which } from '@socketsecurity/lib/bin'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'
import { printFooter } from '@socketsecurity/lib/stdio/footer'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

async function runLint(
  fix = false,
  all = false,
  staged = false,
): Promise<number> {
  const args = fix ? ['run', 'lint:fix'] : ['run', 'lint']
  if (all) {
    args.push('--all')
  }
  if (staged) {
    args.push('--staged')
  }

  logger.step(fix ? 'Auto-fixing lint issues' : 'Running lint checks')

  const pnpm = await which('pnpm')
  if (!pnpm || Array.isArray(pnpm)) {
    logger.error('pnpm not found')
    return 1
  }

  const result = await spawn(pnpm, args, {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error('Lint checks failed')
    return result.code
  }

  logger.success('Lint checks passed')
  return 0
}

async function runTypeCheck(): Promise<number> {
  logger.step('Running type checks')

  const tsgoResult = await which('tsgo').catch(() => null)
  if (!tsgoResult || Array.isArray(tsgoResult)) {
    logger.warn('tsgo not found — skipping type checks')
    return 0
  }

  const result = await spawn(tsgoResult, ['--noEmit'], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error('Type checks failed')
    return result.code
  }

  logger.success('Type checks passed')
  return 0
}

async function runBugClassCheck(): Promise<number> {
  logger.step('Running bug-class regression checks')

  const result = await spawn(
    'node',
    ['scripts/check-bug-classes.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Bug-class regression check failed — rerun with --explain for details',
    )
    logger.log(
      '  node scripts/check-bug-classes.mts --explain',
    )
    return result.code ?? 1
  }

  logger.success('Bug-class regression check passed')
  return 0
}

async function runCascadeCompletenessCheck(): Promise<number> {
  logger.step('Running cascade-completeness check')

  const result = await spawn(
    'node',
    ['scripts/check-cascade-completeness.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Cascade-completeness check failed — rerun with --explain for details',
    )
    logger.log('  node scripts/check-cascade-completeness.mts --explain')
    return result.code ?? 1
  }

  logger.success('Cascade-completeness check passed')
  return 0
}

async function runPatchFormatCheck(): Promise<number> {
  logger.step('Running patch format check')

  const result = await spawn(
    'node',
    ['scripts/check-patch-format.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Patch format check failed — rerun with --explain for details',
    )
    logger.log('  node scripts/check-patch-format.mts --explain')
    return result.code ?? 1
  }

  logger.success('Patch format check passed')
  return 0
}

async function runVersionConsistencyCheck(): Promise<number> {
  logger.step('Running version consistency check')

  const result = await spawn(
    'node',
    ['scripts/check-version-consistency.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Version consistency check failed — rerun with --explain for details',
    )
    logger.log('  node scripts/check-version-consistency.mts --explain')
    return result.code ?? 1
  }

  logger.success('Version consistency check passed')
  return 0
}

async function runMirrorDocsCheck(): Promise<number> {
  logger.step('Running mirror-docs sync check')

  const result = await spawn(
    'node',
    ['scripts/check-mirror-docs.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Mirror-docs sync check failed — rerun with --explain for details',
    )
    logger.log('  node scripts/check-mirror-docs.mts --explain')
    return result.code ?? 1
  }

  logger.success('Mirror-docs sync check passed')
  return 0
}

async function runPathHygieneCheck(): Promise<number> {
  logger.step('Running path-hygiene check (1 path, 1 reference)')

  const result = await spawn(
    'node',
    ['scripts/check-paths.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Path-hygiene check failed — rerun with --explain for details',
    )
    logger.log('  node scripts/check-paths.mts --explain')
    return result.code ?? 1
  }

  logger.success('Path-hygiene check passed')
  return 0
}

async function main(): Promise<void> {
  const argv: string[] = process.argv
  const quiet = argv.includes('--quiet')
  const fix = argv.includes('--fix')
  const all = argv.includes('--all')
  const staged = argv.includes('--staged')
  const help = argv.includes('--help')

  if (help) {
    logger.log('Socket BTM Check Runner')
    logger.log('\nUsage: node scripts/check.mts [options]')
    logger.log('\nOptions:')
    logger.log('  --help    Show this help message')
    logger.log('  --fix     Auto-fix issues where possible')
    logger.log('  --all     Run checks on all files')
    logger.log('  --staged  Run checks on staged files only')
    logger.log('  --quiet   Suppress progress messages')
    logger.log('\nExamples:')
    logger.log('  pnpm check             # Run all checks')
    logger.log('  pnpm check --fix       # Run checks and auto-fix')
    logger.log('  pnpm check --staged    # Run checks on staged files')
    logger.log(
      '  pnpm check --all --fix # Run checks on all files and auto-fix',
    )
    process.exitCode = 0
    return
  }

  try {
    if (!quiet) {
      logger.step('Socket BTM Check Runner')
      logger.log('')
    }

    // Run lint checks
    const exitCode = await runLint(fix, all, staged)
    if (exitCode !== 0) {
      process.exitCode = exitCode
      return
    }

    // Run type checks
    const typeCode = await runTypeCheck()
    if (typeCode !== 0) {
      process.exitCode = typeCode
      return
    }

    // Run bug-class regression checks. Cheap grep-based gate that
    // catches regressions of shapes we fixed during R14-R25 quality
    // scans (e.g. ToLocalChecked on user bytes → isolate abort,
    // hardcoded /tmp/ paths → symlink-follow, bare `main()` →
    // unhandled rejection). See .github/bug-class-allowlist.yml for
    // audited exceptions.
    const bugClassCode = await runBugClassCheck()
    if (bugClassCode !== 0) {
      process.exitCode = bugClassCode
      return
    }

    // Run cascade-completeness check. Walks Makefile includes, TS
    // imports, and Dockerfile COPYs to verify every cross-package
    // dependency is covered by a CASCADE_RULE or the consuming
    // workflow's cache-key composition. Catches the shape that
    // powered R18-R27 scope creep — a new build dep shipped without
    // the cache-key update means downstream workflows serve stale.
    const cascadeCode = await runCascadeCompletenessCheck()
    if (cascadeCode !== 0) {
      process.exitCode = cascadeCode
      return
    }

    // Run patch format check. Validates every `.patch` under
    // packages/*\/patches/ against the canonical format (version
    // header + description + unified-diff + accurate hunk counts +
    // one-file-per-patch + no numbered-series gaps). Catches the
    // shapes R17/R19/R21 quality scans fixed by hand.
    const patchFormatCode = await runPatchFormatCheck()
    if (patchFormatCode !== 0) {
      process.exitCode = patchFormatCode
      return
    }

    // Run version consistency check. Cross-references .gitmodules
    // version comments against package.json sources.<upstream>.version
    // + .ref and the actual gitlink SHA so submodule bumps can't
    // silently drift past the version table. Catches the shape R22-R25
    // hand-fixed during upstream version audits.
    const versionConsistencyCode = await runVersionConsistencyCheck()
    if (versionConsistencyCode !== 0) {
      process.exitCode = versionConsistencyCode
      return
    }

    // Run mirror-docs sync check. Enforces CLAUDE.md's doc-mirror
    // invariant: every public `lib/smol-*.js` module has a matching
    // `docs/additions/lib/<name>.js.md` and every mirror doc still
    // has its source file. Catches orphaned docs from deleted sources
    // and new public modules that shipped without a doc.
    const mirrorDocsCode = await runMirrorDocsCheck()
    if (mirrorDocsCode !== 0) {
      process.exitCode = mirrorDocsCode
      return
    }

    // Run path-hygiene check. Enforces "1 path, 1 reference" — a
    // build/test/runtime path is constructed exactly once; everywhere
    // else references the constructed value. Three-level enforcement:
    // CLAUDE.md rule (advisory), .claude/hooks/path-guard (per-edit
    // block), this gate (whole-repo, fails CI).
    const pathHygieneCode = await runPathHygieneCheck()
    if (pathHygieneCode !== 0) {
      process.exitCode = pathHygieneCode
      return
    }

    if (!quiet) {
      logger.log('')
      logger.success('All checks passed')
      printFooter('Checks complete')
    }
  } catch (e) {
    logger.error(`Check runner failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.error(e)
  process.exitCode = 1
})
