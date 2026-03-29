/**
 * @fileoverview Unified lint runner with flag-based configuration.
 * Provides smart linting that can target affected files or lint everything.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { isQuiet } from '@socketsecurity/lib/argv/flags'
import { parseArgs } from '@socketsecurity/lib/argv/parse'
import { getChangedFiles, getStagedFiles } from '@socketsecurity/lib/git'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { runCommandQuiet } from './utils/run-command.mjs'

// Initialize logger
const logger = getDefaultLogger()

// Config patterns that trigger a full lint
const CONFIG_PATTERNS = [
  '.config/**',
  'scripts/utils/**',
  'pnpm-lock.yaml',
  '.oxlintrc.json',
  '.oxfmtrc.json',
]

/**
 * Get Oxlint exclude patterns from .oxlintrc.json.
 */
function getOxlintExcludePatterns() {
  try {
    const oxlintConfigPath = path.join(process.cwd(), '.oxlintrc.json')
    if (!existsSync(oxlintConfigPath)) {
      return []
    }

    const oxlintConfig = JSON.parse(readFileSync(oxlintConfigPath, 'utf8'))
    return oxlintConfig.ignorePatterns ?? []
  } catch {
    // If we can't read .oxlintrc.json, return empty array
    return []
  }
}

/**
 * Check if a file matches any of the exclude patterns.
 */
function isExcludedByOxlint(file, excludePatterns) {
  for (const pattern of excludePatterns) {
    // Convert glob pattern to regex-like matching
    // Support **/ for directory wildcards and * for filename wildcards
    const regexPattern = pattern
      // **/ matches any directory
      .replace(/\*\*\//g, '.*')
      // * matches any characters except /
      .replace(/\*/g, '[^/]*')
      // Escape dots
      .replace(/\./g, String.raw`\.`)

    const regex = new RegExp(`^${regexPattern}$`)
    if (regex.test(file)) {
      return true
    }
  }
  return false
}

/**
 * Check if we should run all linters based on changed files.
 */
function shouldRunAllLinters(changedFiles) {
  for (const file of changedFiles) {
    // Config or infrastructure files
    for (const pattern of CONFIG_PATTERNS) {
      if (file.includes(pattern.replace('**', ''))) {
        return { reason: 'config files changed', runAll: true }
      }
    }
  }

  return { runAll: false }
}

/**
 * Filter files to only those that should be linted.
 */
function filterLintableFiles(files) {
  // Only include extensions actually supported by oxfmt/oxlint
  const lintableExtensions = new Set(['.js', '.mjs', '.cjs'])

  const oxlintExcludePatterns = getOxlintExcludePatterns()

  return files.filter(file => {
    const ext = path.extname(file)
    // Only lint files that have lintable extensions AND still exist.
    if (!lintableExtensions.has(ext) || !existsSync(file)) {
      return false
    }

    // Filter out files excluded by .oxlintrc.json
    if (isExcludedByOxlint(file, oxlintExcludePatterns)) {
      return false
    }

    return true
  })
}

/**
 * Run linters on specific files.
 */
async function runLintOnFiles(files, options = {}) {
  const { fix = false, quiet = false } = options

  if (!files.length) {
    logger.substep('No files to lint')
    return 0
  }

  if (!quiet) {
    logger.stdout.progress(`Linting ${files.length} file(s)`)
  }

  // Build the linter configurations.
  const linters = [
    {
      args: [
        'exec',
        'oxlint',
        '-c',
        '.oxlintrc.json',
        '--import-plugin',
        '--node-plugin',
        '--vitest-plugin',
        ...(fix ? ['--fix'] : []),
        ...files,
      ],
      enabled: true,
      name: 'oxlint',
    },
  ]

  for (const { args, enabled } of linters) {
    if (!enabled) {
      continue
    }

    const result = await runCommandQuiet('pnpm', args)

    if (result.exitCode !== 0) {
      // When fixing, non-zero exit codes are normal if fixes were applied.
      if (!fix || (result.stderr && result.stderr.trim().length > 0)) {
        if (!quiet) {
          logger.error('Linting failed')
        }
        if (result.stderr) {
          logger.error(result.stderr)
        }
        if (result.stdout && !fix) {
          logger.log(result.stdout)
        }
        return result.exitCode
      }
    }
  }

  if (!quiet) {
    logger.stdout.clearLine()
    logger.success('Linting passed')
    // Add newline after message (use error to write to same stream)
    logger.error('')
  }

  return 0
}

/**
 * Run linters on all files.
 */
async function runLintOnAll(options = {}) {
  const { fix = false, quiet = false } = options

  if (!quiet) {
    logger.stdout.progress('Linting all files')
  }

  const linters = [
    {
      args: [
        'exec',
        'oxlint',
        '-c',
        '.oxlintrc.json',
        '--import-plugin',
        '--node-plugin',
        '--vitest-plugin',
        ...(fix ? ['--fix'] : []),
        '.',
      ],
      name: 'oxlint',
    },
  ]

  for (const { args } of linters) {
    const result = await runCommandQuiet('pnpm', args)

    if (result.exitCode !== 0) {
      // When fixing, non-zero exit codes are normal if fixes were applied.
      if (!fix || (result.stderr && result.stderr.trim().length > 0)) {
        if (!quiet) {
          logger.error('Linting failed')
        }
        if (result.stderr) {
          logger.error(result.stderr)
        }
        if (result.stdout && !fix) {
          logger.log(result.stdout)
        }
        return result.exitCode
      }
    }
  }

  if (!quiet) {
    logger.stdout.clearLine()
    logger.success('Linting passed')
    // Add newline after message (use error to write to same stream)
    logger.error('')
  }

  return 0
}

/**
 * Get files to lint based on options.
 */
async function getFilesToLint(options) {
  const { all, changed, staged } = options

  // If --all, return early
  if (all) {
    return { files: 'all', mode: 'all', reason: 'all flag specified' }
  }

  // Get changed files
  let changedFiles = []
  // Track what mode we're in
  let mode = 'changed'

  if (staged) {
    mode = 'staged'
    changedFiles = await getStagedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: undefined, mode, reason: 'no staged files' }
    }
  } else if (changed) {
    mode = 'changed'
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: undefined, mode, reason: 'no changed files' }
    }
  } else {
    // Default to changed files if no specific flag
    mode = 'changed'
    changedFiles = await getChangedFiles({ absolute: false })
    if (!changedFiles.length) {
      return { files: undefined, mode, reason: 'no changed files' }
    }
  }

  // Check if we should run all based on changed files
  const { reason, runAll } = shouldRunAllLinters(changedFiles)
  if (runAll) {
    return { files: 'all', mode: 'all', reason }
  }

  // Filter to lintable files
  const lintableFiles = filterLintableFiles(changedFiles)
  if (!lintableFiles.length) {
    return { files: undefined, mode, reason: 'no lintable files changed' }
  }

  return { files: lintableFiles, mode, reason: undefined }
}

async function main() {
  try {
    // Parse arguments
    const { positionals, values } = parseArgs({
      allowPositionals: true,
      options: {
        help: {
          type: 'boolean',
          default: false,
        },
        fix: {
          type: 'boolean',
          default: false,
        },
        all: {
          type: 'boolean',
          default: false,
        },
        changed: {
          type: 'boolean',
          default: false,
        },
        staged: {
          type: 'boolean',
          default: false,
        },
        quiet: {
          type: 'boolean',
          default: false,
        },
        silent: {
          type: 'boolean',
          default: false,
        },
      },
      strict: false,
    })

    // Show help if requested
    if (values.help) {
      logger.log('Lint Runner')
      logger.log('\nUsage: pnpm lint [options] [files...]')
      logger.log('\nOptions:')
      logger.log('  --help         Show this help message')
      logger.log('  --fix          Automatically fix problems')
      logger.log('  --all          Lint all files')
      logger.log('  --changed      Lint changed files (default behavior)')
      logger.log('  --staged       Lint staged files')
      logger.log('  --quiet, --silent  Suppress progress messages')
      logger.log('\nExamples:')
      logger.log('  pnpm lint                   # Lint changed files (default)')
      logger.log('  pnpm lint --fix             # Fix issues in changed files')
      logger.log('  pnpm lint --all             # Lint all files')
      logger.log('  pnpm lint --staged --fix    # Fix issues in staged files')
      logger.log('  pnpm lint scripts/*.mjs     # Lint specific file(s)')
      process.exitCode = 0
      return
    }

    const quiet = isQuiet(values)

    if (!quiet) {
      logger.step('Lint Runner')
      logger.log('')
    }

    let exitCode = 0

    // Handle positional arguments (specific files)
    if (positionals.length > 0) {
      const files = filterLintableFiles(positionals)
      if (!quiet) {
        logger.step('Linting specified files')
      }
      exitCode = await runLintOnFiles(files, {
        fix: values.fix,
        quiet,
      })
    } else {
      // Get files to lint based on flags
      const { files, mode, reason } = await getFilesToLint(values)

      if (files === undefined) {
        if (!quiet) {
          logger.step('Skipping lint')
          logger.substep(reason)
        }
        exitCode = 0
      } else if (files === 'all') {
        if (!quiet) {
          logger.step(`Linting all files (${reason})`)
        }
        exitCode = await runLintOnAll({
          fix: values.fix,
          quiet,
        })
      } else {
        if (!quiet) {
          const modeText = mode === 'staged' ? 'staged' : 'changed'
          logger.step(`Linting ${modeText} files`)
        }
        exitCode = await runLintOnFiles(files, {
          fix: values.fix,
          quiet,
        })
      }
    }

    if (exitCode !== 0) {
      if (!quiet) {
        logger.error('')
        logger.log('Lint failed')
      }
      process.exitCode = exitCode
    } else {
      if (!quiet) {
        logger.log('')
        logger.success('All lint checks passed!')
      }
    }
  } catch (error) {
    logger.error(`Lint runner failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  logger.error(error)
  process.exitCode = 1
})
