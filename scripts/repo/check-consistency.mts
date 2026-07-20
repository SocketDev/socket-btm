#!/usr/bin/env node

/**
 * Automated consistency checker for Socket BTM monorepo. Validates
 * architectural patterns and conventions documented in ARCHITECTURE.md.
 *
 * Usage: node scripts/repo/check-consistency.mts # Check only node
 * scripts/repo/check-consistency.mts --fix # Auto-fix all fixable issues node
 * scripts/repo/check-consistency.mts --interactive # Ask before fixing each
 * issue node scripts/repo/check-consistency.mts --dry-run # Show what would be
 * fixed node scripts/repo/check-consistency.mts --suggest # Show ML-powered
 * suggestions.
 *
 * Features: - Auto-fix: Automatically fix missing scripts, fields, and
 * dependencies - Interactive: Prompts before each fix for manual review -
 * Dry-run: Shows planned fixes without making changes - ML suggestions:
 * Analyzes patterns across packages and suggests improvements.
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { errorMessage } from 'build-infra/lib/error-utils'

import {
  checkCoverageScripts,
  checkRequiredFiles,
  checkTestScripts,
  checkVitestConfig,
} from './check-consistency-checks-files.mts'
import {
  checkBuildOutputStructure,
  checkExternalTools,
  checkPackageJsonStructure,
  checkWorkspaceDependencies,
} from './check-consistency-checks-structure.mts'
import {
  colors,
  discoverPackages,
  fixableIssues,
  fixedIssues,
  issues,
  log,
  PACKAGES_DIR,
  promptUser,
} from './check-consistency-state.mts'
import {
  collectPatterns,
  displaySuggestions,
  generateSuggestions,
} from './check-consistency-suggestions.mts'

const logger = getDefaultLogger()

// Parse CLI flags
const argv: string[] = process.argv
const args = new Set(argv.slice(2))
const CLI_FLAGS = {
  dryRun: args.has('--dry-run'),
  fix: args.has('--fix'),
  help: args.has('--help') || args.has('-h'),
  interactive: args.has('--interactive'),
  suggest: args.has('--suggest'),
}

const HELP_TEXT = `
Socket BTM Consistency Checker

Usage: node scripts/repo/check-consistency.mts [options]

Options:
  --help, -h       Show this help message
  --fix            Automatically fix all fixable issues
  --interactive    Prompt before fixing each issue
  --dry-run        Show what would be fixed without making changes
  --suggest        Show ML-powered suggestions based on pattern analysis

Fixable Issues:
  • Missing clean scripts in package.json
  • Missing license field (adds "MIT")
  • Missing private field (adds "private: true")
  • Vitest configs not using mergeConfig pattern
  • Internal dependencies not using "workspace:*"

ML-Powered Suggestions:
  The --suggest flag analyzes patterns across all packages and suggests
  improvements based on majority usage (≥75% adoption threshold):
  • Scripts used by most packages
  • Dependencies used by most packages
  • Common field patterns

Examples:
  node scripts/repo/check-consistency.mts
    Run consistency checks and report issues

  node scripts/repo/check-consistency.mts --dry-run
    Show what would be fixed without making changes

  node scripts/repo/check-consistency.mts --fix
    Automatically fix all fixable issues

  node scripts/repo/check-consistency.mts --interactive
    Review and approve each fix individually

  node scripts/repo/check-consistency.mts --suggest
    Show ML-powered suggestions based on codebase patterns

  node scripts/repo/check-consistency.mts --fix --suggest
    Fix issues and show suggestions in one run
`

// ============================================================================
// Fix Execution
// ============================================================================

/**
 * Executes fixes for all fixable issues.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function executeFixes(): Promise<void> {
  if (fixableIssues.length === 0) {
    log('\nNo fixable issues found.', colors.green)
    return
  }

  log(`\n${'='.repeat(60)}`, colors.bright)
  log(`Found ${fixableIssues.length} fixable issue(s)`, colors.yellow)
  log('='.repeat(60), colors.bright)

  for (let i = 0, { length } = fixableIssues; i < length; i += 1) {
    const issue = fixableIssues[i]!
    if (CLI_FLAGS.dryRun) {
      log('\n[DRY RUN] Would fix:', colors.yellow)
      log(`  ${issue.file}`, colors.blue)
      log(`  ${issue.message}`, colors.reset)
      continue
    }

    if (CLI_FLAGS.interactive) {
      log(`\n${issue.file}`, colors.blue)
      log(`  ${issue.message}`, colors.reset)

      const shouldFix = await promptUser('Apply this fix?')
      if (!shouldFix) {
        log('  Skipped', colors.yellow)
        continue
      }
    }

    try {
      const result = await issue.fix()
      fixedIssues.push({
        file: issue.file,
        level: issue.level,
        message: issue.message,
        result,
      })

      if (!CLI_FLAGS.interactive) {
        // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
        log(`\n✓ Fixed: ${issue.file}`, colors.green)
        log(`  ${result}`, colors.reset)
      } else {
        // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
        log(`  ✓ ${result}`, colors.green)
      }
    } catch (e) {
      // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
      log(`\n✗ Failed to fix: ${issue.file}`, colors.red)
      log(`  Error: ${errorMessage(e)}`, colors.red)
    }
  }

  if (CLI_FLAGS.dryRun) {
    log(
      `\n${fixableIssues.length} issue(s) would be fixed (dry run mode)`,
      colors.yellow,
    )
  } else if (fixedIssues.length > 0) {
    log(`\n${'='.repeat(60)}`, colors.bright)
    log('Fix Summary', colors.bright)
    log('='.repeat(60), colors.bright)
    log(`Successfully fixed ${fixedIssues.length} issue(s)`, colors.green)

    for (let i = 0, { length } = fixedIssues; i < length; i += 1) {
      const fixed = fixedIssues[i]!
      // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
      log(`  ✓ ${fixed.file}`, colors.green)
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  // Display help and exit early if requested
  if (CLI_FLAGS.help) {
    logger.log(HELP_TEXT)
    return
  }

  log(
    `${colors.bright}${colors.blue}Socket BTM Consistency Checker${colors.reset}\n`,
  )
  log(`Analyzing packages in ${PACKAGES_DIR}...\n`, colors.reset)

  // Show active flags
  const activeFlags = Object.entries(CLI_FLAGS)
    .filter(([, value]) => value)
    .map(([key]) => `--${key}`)
  if (activeFlags.length > 0) {
    log(`Active flags: ${activeFlags.join(', ')}\n`, colors.blue)
  }

  const packages = await discoverPackages()
  log(`Found ${packages.length} packages\n`, colors.green)

  // Collect patterns for ML suggestions
  if (CLI_FLAGS.suggest) {
    collectPatterns(packages)
  }

  // Run all checks
  await checkRequiredFiles(packages)
  await checkVitestConfig(packages)
  await checkTestScripts(packages)
  await checkCoverageScripts(packages)
  await checkExternalTools(packages)
  await checkBuildOutputStructure(packages)
  await checkPackageJsonStructure(packages)
  await checkWorkspaceDependencies(packages)

  // Report results
  log(`\n${'='.repeat(60)}`, colors.bright)
  log('Consistency Check Results', colors.bright)
  log('='.repeat(60), colors.bright)

  const totalIssues =
    issues.error.length + issues.warning.length + issues.info.length

  if (totalIssues === 0) {
    // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
    log('\n✓ All checks passed!', colors.green)
  } else {
    // Group issues by category
    const categories = new Set([
      ...issues.error.map(i => i.category),
      ...issues.warning.map(i => i.category),
      ...issues.info.map(i => i.category),
    ])

    // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is a Set (not array-indexed)
    for (const category of categories) {
      const categoryIssues = {
        error: issues.error.filter(i => i.category === category),
        info: issues.info.filter(i => i.category === category),
        warning: issues.warning.filter(i => i.category === category),
      }

      const categoryTotal =
        categoryIssues.error.length +
        categoryIssues.warning.length +
        categoryIssues.info.length

      if (categoryTotal === 0) {
        continue
      }

      log(`\n[${category}] ${categoryTotal} issue(s)`, colors.bright)

      // Errors
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const issue of categoryIssues.error) {
        // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
        log(`  ✗ ${issue.file}`, colors.red)
        log(`    ${issue.message}`, colors.red)
      }

      // Warnings
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const issue of categoryIssues.warning) {
        // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
        log(`  ⚠ ${issue.file}`, colors.yellow)
        log(`    ${issue.message}`, colors.yellow)
      }

      // Info
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- iterable is not a bare identifier (could be Map/Set/Generator/expression)
      for (const issue of categoryIssues.info) {
        log(`  ℹ ${issue.file}`, colors.blue)
        log(`    ${issue.message}`, colors.blue)
      }
    }

    // Summary
    log(`\n${'='.repeat(60)}`, colors.bright)
    log('Summary', colors.bright)
    log('='.repeat(60), colors.bright)
    log(`Errors:   ${issues.error.length}`, colors.red)
    log(`Warnings: ${issues.warning.length}`, colors.yellow)
    log(`Info:     ${issues.info.length}`, colors.blue)

    if (fixableIssues.length > 0) {
      log(`Fixable:  ${fixableIssues.length}`, colors.green)
    }
  }

  // Execute fixes if requested
  if (CLI_FLAGS.fix || CLI_FLAGS.interactive || CLI_FLAGS.dryRun) {
    await executeFixes()
  }

  // Display ML-powered suggestions if requested
  if (CLI_FLAGS.suggest) {
    const suggestions = generateSuggestions(packages)
    displaySuggestions(suggestions)
  }

  // Final status
  log(`\n${'='.repeat(60)}`, colors.bright)

  if (CLI_FLAGS.dryRun) {
    log('Dry run complete - no changes made', colors.yellow)
  } else if (fixedIssues.length > 0) {
    // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
    log(`✓ Fixed ${fixedIssues.length} issue(s)`, colors.green)

    // Recount remaining issues
    const remainingIssues =
      issues.error.length + issues.warning.length - fixedIssues.length
    if (remainingIssues > 0) {
      log(
        // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
        `⚠ ${remainingIssues} issue(s) still require manual attention`,
        colors.yellow,
      )
    }
  }

  // Count fixes that were originally errors, not total fixes. `fixedIssues`
  // is populated from every level (error + warning + info); comparing its
  // length to `issues.error.length` silently passed when warnings/info
  // were auto-fixed but errors remained.
  const fixedErrorCount = fixedIssues.filter(f => f.level === 'error').length
  if (issues.error.length > 0 && fixedErrorCount < issues.error.length) {
    // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
    log('\n✗ Consistency check failed', colors.red)
    process.exitCode = 1
  } else if (issues.warning.length > 0) {
    // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
    log('\n⚠ Consistency check passed with warnings', colors.yellow)
  } else if (totalIssues === 0) {
    // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
    log('\n✓ Consistency check passed', colors.green)
  } else {
    // oxlint-disable-next-line socket/no-status-emoji -- script uses a local log(msg, color) helper that composes ANSI color with status markers; logger.success/fail would drop the explicit color control needed for the consistency-checker's multi-column report.
    log('\n✓ All fixable issues resolved', colors.green)
  }
}

main().catch((e: unknown) => {
  log(`\nFatal error: ${errorMessage(e)}`, colors.red)
  logger.error((e as Error).stack)
  process.exitCode = 1
})
