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

import { which } from '@socketsecurity/lib-stable/bin/which'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'
import { spawn } from '@socketsecurity/lib-stable/spawn/spawn'
import { printFooter } from '@socketsecurity/lib-stable/stdio/footer'

import { errorMessage } from 'build-infra/lib/error-utils'

const logger = getDefaultLogger()

export async function runCascadeCompletenessCheck(): Promise<number> {
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

export async function runLint(
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

export async function runMirrorDocsCheck(): Promise<number> {
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

export async function runPatchFormatCheck(): Promise<number> {
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
    logger.error('Patch format check failed — rerun with --explain for details')
    logger.log('  node scripts/check-patch-format.mts --explain')
    return result.code ?? 1
  }

  logger.success('Patch format check passed')
  return 0
}

export async function runPathHygieneCheck(): Promise<number> {
  logger.step('Running path-hygiene check (1 path, 1 reference)')

  const result = await spawn('node', ['scripts/check-paths.mts', '--quiet'], {
    shell: WIN32,
    stdio: 'inherit',
  })

  if (result.code !== 0) {
    logger.error('Path-hygiene check failed — rerun with --explain for details')
    logger.log('  node scripts/check-paths.mts --explain')
    return result.code ?? 1
  }

  logger.success('Path-hygiene check passed')
  return 0
}

export async function runPrimordialsCoverageCheck(): Promise<number> {
  logger.step('Running primordials coverage check')

  const pnpm = await which('pnpm')
  if (!pnpm || Array.isArray(pnpm)) {
    logger.error('pnpm not found')
    return 1
  }

  const result = await spawn(
    pnpm,
    ['exec', 'socket-lib', 'check', 'prim', '--silent'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Primordials coverage check failed — rerun with --explain for details',
    )
    logger.log('  pnpm exec socket-lib check prim --explain')
    return result.code ?? 1
  }

  logger.success('Primordials coverage check passed')
  return 0
}

export async function runRegressionPatternsCheck(): Promise<number> {
  logger.step('Running regression-pattern checks')

  const result = await spawn(
    'node',
    ['scripts/check-regression-patterns.mts', '--quiet'],
    {
      shell: WIN32,
      stdio: 'inherit',
    },
  )

  if (result.code !== 0) {
    logger.error(
      'Regression-pattern check failed — rerun with --explain for details',
    )
    logger.log('  node scripts/check-regression-patterns.mts --explain')
    return result.code ?? 1
  }

  logger.success('Regression-pattern check passed')
  return 0
}

export async function runTypeCheck(): Promise<number> {
  logger.step('Running type checks')

  const tsgoResult = await which('tsgo').catch(() => undefined)
  if (!tsgoResult || Array.isArray(tsgoResult)) {
    logger.warn('tsgo not found — skipping type checks')
    return 0
  }

  const result = await spawn(tsgoResult, ['--noEmit', '-p', 'tsconfig.json'], {
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

export async function runVersionConsistencyCheck(): Promise<number> {
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

async function main(): Promise<void> {
  const argv: string[] = process.argv
  const quiet = argv.includes('--quiet')
  const fix = argv.includes('--fix')
  const all = argv.includes('--all')
  const staged = argv.includes('--staged')
  const help = argv.includes('--help')

  if (help) {
    logger.log('Socket BTM Check Runner')
    logger.log('')
    logger.log('Usage: node scripts/check.mts [options]')
    logger.log('')
    logger.log('Options:')
    logger.log('  --help    Show this help message')
    logger.log('  --fix     Auto-fix issues where possible')
    logger.log('  --all     Run checks on all files')
    logger.log('  --staged  Run checks on staged files only')
    logger.log('  --quiet   Suppress progress messages')
    logger.log('')
    logger.log('Examples:')
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

    // Run regression-pattern checks. Cheap grep-based gate that
    // catches recurring bug shapes (e.g. ToLocalChecked on user bytes →
    // isolate abort, hardcoded /tmp/ paths → symlink-follow, bare
    // `main()` → unhandled rejection). See
    // .github/regression-patterns-allowlist.yml for audited exceptions.
    const regressionCode = await runRegressionPatternsCheck()
    if (regressionCode !== 0) {
      process.exitCode = regressionCode
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

    // Run primordials-coverage check. Diffs every name destructured
    // from `primordials` in additions/source-patched/**/*.js against
    // socket-lib/src/primordials.ts. Catches the case where a new
    // addition introduces a name socket-lib doesn't expose (or vice
    // versa, an alias map gap), so the two stay shape-aligned without
    // anyone having to remember.
    const primordialsCoverageCode = await runPrimordialsCoverageCheck()
    if (primordialsCoverageCode !== 0) {
      process.exitCode = primordialsCoverageCode
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
