#!/usr/bin/env node
/**
 * Automated consistency checker for Socket BTM monorepo.
 * Validates architectural patterns and conventions documented in ARCHITECTURE.md.
 *
 * Usage:
 *   node scripts/check-consistency.mjs              # Check only
 *   node scripts/check-consistency.mjs --fix        # Auto-fix all fixable issues
 *   node scripts/check-consistency.mjs --interactive # Ask before fixing each issue
 *   node scripts/check-consistency.mjs --dry-run    # Show what would be fixed
 *   node scripts/check-consistency.mjs --suggest    # Show ML-powered suggestions
 *
 * Features:
 *   - Auto-fix: Automatically fix missing scripts, fields, and dependencies
 *   - Interactive: Prompts before each fix for manual review
 *   - Dry-run: Shows planned fixes without making changes
 *   - ML suggestions: Analyzes patterns across packages and suggests improvements
 */

import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')
const PACKAGES_DIR = path.join(MONOREPO_ROOT, 'packages')

// Parse CLI flags
const args = process.argv.slice(2)
const CLI_FLAGS = {
  fix: args.includes('--fix'),
  interactive: args.includes('--interactive'),
  dryRun: args.includes('--dry-run'),
  suggest: args.includes('--suggest'),
  help: args.includes('--help') || args.includes('-h'),
}

// Display help and exit if requested
if (CLI_FLAGS.help) {
  console.log(`
Socket BTM Consistency Checker

Usage: node scripts/check-consistency.mjs [options]

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
  node scripts/check-consistency.mjs
    Run consistency checks and report issues

  node scripts/check-consistency.mjs --dry-run
    Show what would be fixed without making changes

  node scripts/check-consistency.mjs --fix
    Automatically fix all fixable issues

  node scripts/check-consistency.mjs --interactive
    Review and approve each fix individually

  node scripts/check-consistency.mjs --suggest
    Show ML-powered suggestions based on codebase patterns

  node scripts/check-consistency.mjs --fix --suggest
    Fix issues and show suggestions in one run
`)
  process.exit(0)
}

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
}

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`)
}

const issues = {
  error: [],
  warning: [],
  info: [],
}

const fixableIssues = []
const fixedIssues = []
const patternStats = {
  scripts: {},
  dependencies: {},
  devDependencies: {},
  fields: {},
  total: 0,
}

function reportIssue(level, category, message, file, fixFn) {
  const issue = { category, message, file }
  issues[level].push(issue)

  // If a fix function is provided, store it as fixable
  if (fixFn) {
    fixableIssues.push({
      level,
      category,
      message,
      file,
      fix: fixFn,
    })
  }
}

/**
 * Prompts user for yes/no confirmation in interactive mode
 */
async function promptUser(question) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise(resolve => {
    rl.question(`${question} (y/n): `, answer => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

// ============================================================================
// Package Discovery
// ============================================================================

async function discoverPackages() {
  const entries = await readdir(PACKAGES_DIR, { withFileTypes: true })
  const packages = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const pkgPath = path.join(PACKAGES_DIR, entry.name)
    const pkgJsonPath = path.join(pkgPath, 'package.json')

    if (!existsSync(pkgJsonPath)) {
      continue
    }

    const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf-8'))
    packages.push({
      name: entry.name,
      path: pkgPath,
      pkgJson,
    })
  }

  return packages
}

// ============================================================================
// Check 1: Required Files
// ============================================================================

async function checkRequiredFiles(packages) {
  log('\n[1/8] Checking required files...', colors.blue)

  for (const pkg of packages) {
    const requiredFiles = ['package.json', 'README.md']

    for (const file of requiredFiles) {
      const filePath = path.join(pkg.path, file)
      if (!existsSync(filePath)) {
        reportIssue(
          'error',
          'required-files',
          `Missing required file: ${file}`,
          `${pkg.name}/${file}`,
        )
      }
    }

    // Check for empty README
    if (existsSync(path.join(pkg.path, 'README.md'))) {
      const readme = await readFile(path.join(pkg.path, 'README.md'), 'utf-8')
      if (readme.trim().length < 50) {
        reportIssue(
          'warning',
          'required-files',
          'README.md is too short (< 50 chars)',
          `${pkg.name}/README.md`,
        )
      }
    }
  }
}

// ============================================================================
// Check 2: Vitest Configuration
// ============================================================================

async function checkVitestConfig(packages) {
  log('[2/8] Checking vitest configurations...', colors.blue)

  const vitestPackages = packages.filter(pkg =>
    existsSync(path.join(pkg.path, 'vitest.config.mts')),
  )

  for (const pkg of vitestPackages) {
    const configPath = path.join(pkg.path, 'vitest.config.mts')
    const config = await readFile(configPath, 'utf-8')

    // Check if extending base config
    const needsMergeConfig = !config.includes('mergeConfig')
    const needsBaseImport = !config.includes('../../vitest.config.mts')

    if (needsMergeConfig || needsBaseImport) {
      reportIssue(
        'error',
        'vitest-config',
        'Vitest config must use mergeConfig to extend base config',
        `${pkg.name}/vitest.config.mts`,
        async () => {
          // Generate standard vitest config that extends base
          const standardConfig = `import { mergeConfig } from 'vitest/config'
import baseConfig from '../../vitest.config.mts'

export default mergeConfig(baseConfig, {
  test: {
    // Package-specific test configuration
  },
})
`
          await writeFile(configPath, standardConfig, 'utf-8')
          return 'Standardized vitest config to extend base config with mergeConfig'
        },
      )
    }

    if (!needsMergeConfig && needsBaseImport) {
      reportIssue(
        'error',
        'vitest-config',
        'Vitest config must import base config from ../../vitest.config.mts',
        `${pkg.name}/vitest.config.mts`,
      )
    }
  }
}

// ============================================================================
// Check 3: Test Scripts
// ============================================================================

async function checkTestScripts(packages) {
  log('[3/8] Checking test scripts...', colors.blue)

  const PATTERNS = {
    standard: 'vitest run',
    envAware: 'dotenvx run --env-file=.env.test -- vitest run',
    makefile: 'dotenvx run --env-file=.env.test -- node scripts/test.mjs',
  }

  for (const pkg of packages) {
    const { scripts } = pkg.pkgJson

    if (!scripts || !scripts.test) {
      reportIssue(
        'error',
        'test-scripts',
        'Missing test script in package.json',
        `${pkg.name}/package.json`,
      )
      continue
    }

    const testScript = scripts.test
    const matchesPattern = Object.values(PATTERNS).some(pattern =>
      testScript.includes(pattern),
    )

    if (!matchesPattern) {
      reportIssue(
        'warning',
        'test-scripts',
        `Test script doesn't match documented patterns: ${testScript}`,
        `${pkg.name}/package.json`,
      )
    }
  }
}

// ============================================================================
// Check 4: Coverage Scripts
// ============================================================================

async function checkCoverageScripts(packages) {
  log('[4/8] Checking coverage scripts...', colors.blue)

  const C_PACKAGES = ['binflate', 'binpress', 'binject']
  const jsPackages = packages.filter(pkg => !C_PACKAGES.includes(pkg.name))

  for (const pkg of jsPackages) {
    const { devDependencies, scripts } = pkg.pkgJson

    // Check for coverage script
    if (!scripts || !scripts.coverage) {
      reportIssue(
        'warning',
        'coverage',
        'Missing coverage script (expected for JS/TS packages)',
        `${pkg.name}/package.json`,
      )
      continue
    }

    // Check for coverage dependency
    if (!devDependencies || !devDependencies['@vitest/coverage-v8']) {
      reportIssue(
        'error',
        'coverage',
        'Missing @vitest/coverage-v8 devDependency',
        `${pkg.name}/package.json`,
      )
    }

    // Validate coverage script command
    if (!scripts.coverage.includes('--coverage')) {
      reportIssue(
        'error',
        'coverage',
        'Coverage script must include --coverage flag',
        `${pkg.name}/package.json`,
      )
    }
  }
}

// ============================================================================
// Check 5: External Tools Documentation
// ============================================================================

async function checkExternalTools(packages) {
  log('[5/8] Checking external-tools.json...', colors.blue)

  const C_PACKAGES = [
    'binflate',
    'binpress',
    'binject',
    'bin-infra',
    'bin-stubs',
  ]

  for (const pkgName of C_PACKAGES) {
    const pkg = packages.find(p => p.name === pkgName)
    if (!pkg) {
      continue
    }

    const externalToolsPath = path.join(pkg.path, 'external-tools.json')

    if (!existsSync(externalToolsPath)) {
      reportIssue(
        'warning',
        'external-tools',
        'Missing external-tools.json (expected for C packages)',
        `${pkg.name}/external-tools.json`,
      )
      continue
    }

    // Validate schema
    try {
      const tools = JSON.parse(await readFile(externalToolsPath, 'utf-8'))

      if (!tools.$schema) {
        reportIssue(
          'error',
          'external-tools',
          'Missing $schema in external-tools.json',
          `${pkg.name}/external-tools.json`,
        )
      }

      if (!tools.tools || typeof tools.tools !== 'object') {
        reportIssue(
          'error',
          'external-tools',
          'Missing or invalid tools object',
          `${pkg.name}/external-tools.json`,
        )
      }
    } catch (error) {
      reportIssue(
        'error',
        'external-tools',
        `Invalid JSON: ${error.message}`,
        `${pkg.name}/external-tools.json`,
      )
    }
  }
}

// ============================================================================
// Check 6: Build Output Structure
// ============================================================================

async function checkBuildOutputStructure(packages) {
  log('[6/8] Checking build output structure...', colors.blue)

  for (const pkg of packages) {
    const buildDir = path.join(pkg.path, 'build')

    if (!existsSync(buildDir)) {
      reportIssue(
        'info',
        'build-output',
        'No build directory (may not have been built yet)',
        `${pkg.name}/build`,
      )
      continue
    }

    // Check for standard structure
    const devFinalDir = path.join(buildDir, 'dev', 'out', 'Final')
    const prodFinalDir = path.join(buildDir, 'prod', 'out', 'Final')

    // Special case: model builders use different structure
    const MODEL_BUILDERS = ['codet5-models-builder', 'minilm-builder']
    if (MODEL_BUILDERS.includes(pkg.name)) {
      // Model builders have intentional deviations
      continue
    }

    if (existsSync(path.join(buildDir, 'dev'))) {
      if (!existsSync(devFinalDir)) {
        reportIssue(
          'warning',
          'build-output',
          'Dev build exists but missing standard out/Final/ structure',
          `${pkg.name}/build/dev/out/Final`,
        )
      }
    }

    if (existsSync(path.join(buildDir, 'prod'))) {
      if (!existsSync(prodFinalDir)) {
        reportIssue(
          'warning',
          'build-output',
          'Prod build exists but missing standard out/Final/ structure',
          `${pkg.name}/build/prod/out/Final`,
        )
      }
    }
  }
}

// ============================================================================
// Check 7: Package.json Structure
// ============================================================================

async function checkPackageJsonStructure(packages) {
  log('[7/8] Checking package.json structure...', colors.blue)

  for (const pkg of packages) {
    const { description, license, name, scripts, type, version } = pkg.pkgJson
    const pkgJsonPath = path.join(pkg.path, 'package.json')

    if (!name) {
      reportIssue(
        'error',
        'package-json',
        'Missing name field',
        `${pkg.name}/package.json`,
      )
    }

    if (!version) {
      reportIssue(
        'error',
        'package-json',
        'Missing version field',
        `${pkg.name}/package.json`,
      )
    }

    if (!description) {
      reportIssue(
        'warning',
        'package-json',
        'Missing description field',
        `${pkg.name}/package.json`,
      )
    }

    if (!license) {
      reportIssue(
        'warning',
        'package-json',
        'Missing license field',
        `${pkg.name}/package.json`,
        async () => {
          const content = await readFile(pkgJsonPath, 'utf-8')
          const json = JSON.parse(content)
          json.license = 'MIT'
          await writeFile(
            pkgJsonPath,
            `${JSON.stringify(json, undefined, 2)}\n`,
            'utf-8',
          )
          return 'Added license: "MIT"'
        },
      )
    }

    // Check for private field
    if (pkg.pkgJson.private === undefined) {
      reportIssue(
        'warning',
        'package-json',
        'Missing private field (should be true for internal packages)',
        `${pkg.name}/package.json`,
        async () => {
          const content = await readFile(pkgJsonPath, 'utf-8')
          const json = JSON.parse(content)
          json.private = true
          await writeFile(
            pkgJsonPath,
            `${JSON.stringify(json, undefined, 2)}\n`,
            'utf-8',
          )
          return 'Added private: true'
        },
      )
    }

    if (type !== 'module') {
      reportIssue(
        'error',
        'package-json',
        'Must use type: "module" (ESM)',
        `${pkg.name}/package.json`,
      )
    }

    // Check for clean script (all packages should have it)
    if (!scripts || !scripts.clean) {
      reportIssue(
        'warning',
        'package-json',
        'Missing clean script',
        `${pkg.name}/package.json`,
        async () => {
          const content = await readFile(pkgJsonPath, 'utf-8')
          const json = JSON.parse(content)
          if (!json.scripts) {
            json.scripts = {}
          }
          // Infer clean script based on package type
          const hasNodeGyp = existsSync(path.join(pkg.path, 'binding.gyp'))
          json.scripts.clean = hasNodeGyp
            ? 'node-gyp clean && rm -rf build'
            : 'rm -rf build dist coverage .turbo'
          await writeFile(
            pkgJsonPath,
            `${JSON.stringify(json, undefined, 2)}\n`,
            'utf-8',
          )
          return `Added clean script: "${json.scripts.clean}"`
        },
      )
    }
  }
}

// ============================================================================
// Check 8: Workspace Dependencies
// ============================================================================

async function checkWorkspaceDependencies(packages) {
  log('[8/8] Checking workspace dependencies...', colors.blue)

  for (const pkg of packages) {
    const { dependencies = {}, devDependencies = {} } = pkg.pkgJson
    const allDeps = { ...dependencies, ...devDependencies }
    const pkgJsonPath = path.join(pkg.path, 'package.json')

    // Find internal dependencies
    const internalDeps = Object.entries(allDeps).filter(([depName]) =>
      packages.some(p => p.name === depName),
    )

    for (const [depName, version] of internalDeps) {
      if (version !== 'workspace:*') {
        reportIssue(
          'error',
          'workspace-deps',
          `Internal dependency "${depName}" must use "workspace:*", got "${version}"`,
          `${pkg.name}/package.json`,
          async () => {
            const content = await readFile(pkgJsonPath, 'utf-8')
            const json = JSON.parse(content)

            // Fix in both dependencies and devDependencies
            if (json.dependencies?.[depName]) {
              json.dependencies[depName] = 'workspace:*'
            }
            if (json.devDependencies?.[depName]) {
              json.devDependencies[depName] = 'workspace:*'
            }

            await writeFile(
              pkgJsonPath,
              `${JSON.stringify(json, undefined, 2)}\n`,
              'utf-8',
            )
            return `Fixed "${depName}" to use workspace:*`
          },
        )
      }
    }

    // Check for catalog usage
    const catalogDeps = Object.entries(allDeps).filter(
      ([, version]) => version === 'catalog:',
    )

    if (catalogDeps.length > 0) {
      // Verify catalog entries exist in pnpm-workspace.yaml
      // (This is a simplified check - full validation would parse YAML)
      reportIssue(
        'info',
        'workspace-deps',
        `Uses ${catalogDeps.length} catalog dependencies`,
        `${pkg.name}/package.json`,
      )
    }
  }
}

// ============================================================================
// Pattern Analysis for ML-Powered Suggestions
// ============================================================================

/**
 * Collects patterns across all packages for ML-powered suggestions
 */
function collectPatterns(packages) {
  patternStats.total = packages.length

  for (const pkg of packages) {
    // Collect script patterns
    if (pkg.pkgJson.scripts) {
      for (const [scriptName, scriptValue] of Object.entries(
        pkg.pkgJson.scripts,
      )) {
        if (!patternStats.scripts[scriptName]) {
          patternStats.scripts[scriptName] = {
            count: 0,
            values: {},
            packages: [],
          }
        }
        patternStats.scripts[scriptName].count++
        patternStats.scripts[scriptName].packages.push(pkg.name)

        if (!patternStats.scripts[scriptName].values[scriptValue]) {
          patternStats.scripts[scriptName].values[scriptValue] = 0
        }
        patternStats.scripts[scriptName].values[scriptValue]++
      }
    }

    // Collect dependency patterns
    if (pkg.pkgJson.dependencies) {
      for (const [depName, depVersion] of Object.entries(
        pkg.pkgJson.dependencies,
      )) {
        if (!patternStats.dependencies[depName]) {
          patternStats.dependencies[depName] = {
            count: 0,
            versions: {},
            packages: [],
          }
        }
        patternStats.dependencies[depName].count++
        patternStats.dependencies[depName].packages.push(pkg.name)
        patternStats.dependencies[depName].versions[depVersion] =
          (patternStats.dependencies[depName].versions[depVersion] || 0) + 1
      }
    }

    // Collect devDependency patterns
    if (pkg.pkgJson.devDependencies) {
      for (const [depName, depVersion] of Object.entries(
        pkg.pkgJson.devDependencies,
      )) {
        if (!patternStats.devDependencies[depName]) {
          patternStats.devDependencies[depName] = {
            count: 0,
            versions: {},
            packages: [],
          }
        }
        patternStats.devDependencies[depName].count++
        patternStats.devDependencies[depName].packages.push(pkg.name)
        patternStats.devDependencies[depName].versions[depVersion] =
          (patternStats.devDependencies[depName].versions[depVersion] || 0) + 1
      }
    }

    // Collect field patterns
    for (const [field, value] of Object.entries(pkg.pkgJson)) {
      if (
        [
          'name',
          'version',
          'dependencies',
          'devDependencies',
          'scripts',
        ].includes(field)
      ) {
        continue
      }

      if (!patternStats.fields[field]) {
        patternStats.fields[field] = {
          count: 0,
          values: {},
          packages: [],
        }
      }
      patternStats.fields[field].count++
      patternStats.fields[field].packages.push(pkg.name)

      const valueStr =
        typeof value === 'object' ? JSON.stringify(value) : String(value)
      if (!patternStats.fields[field].values[valueStr]) {
        patternStats.fields[field].values[valueStr] = 0
      }
      patternStats.fields[field].values[valueStr]++
    }
  }
}

/**
 * Calculate confidence score as percentage
 */
function getConfidence(count, total) {
  return (count / total) * 100
}

/**
 * Get confidence level based on percentage
 */
function getConfidenceLevel(confidence) {
  if (confidence >= 96) {
    return 'VERY HIGH'
  }
  if (confidence >= 90) {
    return 'HIGH'
  }
  if (confidence >= 80) {
    return 'MEDIUM'
  }
  return 'LOW'
}

/**
 * Generates ML-powered suggestions based on pattern analysis
 */
function generateSuggestions(packages) {
  const suggestions = []

  // Analyze script patterns
  for (const [scriptName, stats] of Object.entries(patternStats.scripts)) {
    const confidence = getConfidence(stats.count, patternStats.total)
    if (confidence >= 75) {
      // Find packages missing this script
      const missingPackages = packages
        .filter(pkg => !pkg.pkgJson.scripts || !pkg.pkgJson.scripts[scriptName])
        .map(pkg => pkg.name)

      if (missingPackages.length > 0) {
        // Find most common value
        const mostCommonValue = Object.entries(stats.values).sort(
          ([, a], [, b]) => b - a,
        )[0][0]

        suggestions.push({
          confidence,
          level: getConfidenceLevel(confidence),
          type: 'script',
          title: `Add "${scriptName}" script`,
          description: `${stats.count}/${patternStats.total} packages have this script`,
          missing: missingPackages,
          suggested: `"${scriptName}": "${mostCommonValue}"`,
        })
      }
    }
  }

  // Analyze dependency patterns
  for (const [depName, stats] of Object.entries(patternStats.dependencies)) {
    const confidence = getConfidence(stats.count, patternStats.total)
    if (confidence >= 75) {
      const missingPackages = packages
        .filter(
          pkg =>
            !pkg.pkgJson.dependencies || !pkg.pkgJson.dependencies[depName],
        )
        .map(pkg => pkg.name)

      if (missingPackages.length > 0) {
        const mostCommonVersion = Object.entries(stats.versions).sort(
          ([, a], [, b]) => b - a,
        )[0][0]

        suggestions.push({
          confidence,
          level: getConfidenceLevel(confidence),
          type: 'dependency',
          title: `Consider adding "${depName}" dependency`,
          description: `${stats.count}/${patternStats.total} packages use this dependency`,
          missing: missingPackages,
          suggested: `"${depName}": "${mostCommonVersion}"`,
        })
      }
    }
  }

  // Analyze devDependency patterns
  for (const [depName, stats] of Object.entries(patternStats.devDependencies)) {
    const confidence = getConfidence(stats.count, patternStats.total)
    if (confidence >= 75) {
      const missingPackages = packages
        .filter(
          pkg =>
            !pkg.pkgJson.devDependencies ||
            !pkg.pkgJson.devDependencies[depName],
        )
        .map(pkg => pkg.name)

      if (missingPackages.length > 0) {
        const mostCommonVersion = Object.entries(stats.versions).sort(
          ([, a], [, b]) => b - a,
        )[0][0]

        suggestions.push({
          confidence,
          level: getConfidenceLevel(confidence),
          type: 'devDependency',
          title: `Consider adding "${depName}" devDependency`,
          description: `${stats.count}/${patternStats.total} packages use this devDependency`,
          missing: missingPackages,
          suggested: `"${depName}": "${mostCommonVersion}"`,
        })
      }
    }
  }

  // Sort by confidence (highest first)
  return suggestions.sort((a, b) => b.confidence - a.confidence)
}

/**
 * Displays ML-powered suggestions
 */
function displaySuggestions(suggestions) {
  if (suggestions.length === 0) {
    log(
      '\nNo suggestions found. Codebase patterns are consistent!',
      colors.green,
    )
    return
  }

  log(`\n${'='.repeat(60)}`, colors.bright)
  log('ML-Powered Suggestions (Pattern Analysis)', colors.bright)
  log('='.repeat(60), colors.bright)

  for (const suggestion of suggestions) {
    const confidenceColor =
      suggestion.level === 'VERY HIGH' || suggestion.level === 'HIGH'
        ? colors.green
        : suggestion.level === 'MEDIUM'
          ? colors.yellow
          : colors.reset

    log(
      `\n[${suggestion.level} CONFIDENCE - ${suggestion.confidence.toFixed(0)}%] ${suggestion.title}`,
      confidenceColor,
    )
    log(`  ${suggestion.description}`, colors.reset)
    log(`  Missing in: ${suggestion.missing.join(', ')}`, colors.blue)
    log(`  Suggested: ${suggestion.suggested}`, colors.green)
  }

  log(`\n${'='.repeat(60)}`, colors.bright)
  log(`Total suggestions: ${suggestions.length}`, colors.bright)
}

// ============================================================================
// Fix Execution
// ============================================================================

/**
 * Executes fixes for all fixable issues
 */
async function executeFixes() {
  if (fixableIssues.length === 0) {
    log('\nNo fixable issues found.', colors.green)
    return
  }

  log(`\n${'='.repeat(60)}`, colors.bright)
  log(`Found ${fixableIssues.length} fixable issue(s)`, colors.yellow)
  log('='.repeat(60), colors.bright)

  for (const issue of fixableIssues) {
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
        message: issue.message,
        result,
      })

      if (!CLI_FLAGS.interactive) {
        log(`\n✓ Fixed: ${issue.file}`, colors.green)
        log(`  ${result}`, colors.reset)
      } else {
        log(`  ✓ ${result}`, colors.green)
      }
    } catch (error) {
      log(`\n✗ Failed to fix: ${issue.file}`, colors.red)
      log(`  Error: ${error.message}`, colors.red)
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

    for (const fixed of fixedIssues) {
      log(`  ✓ ${fixed.file}`, colors.green)
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
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
    log('\n✓ All checks passed!', colors.green)
  } else {
    // Group issues by category
    const categories = new Set([
      ...issues.error.map(i => i.category),
      ...issues.warning.map(i => i.category),
      ...issues.info.map(i => i.category),
    ])

    for (const category of categories) {
      const categoryIssues = {
        error: issues.error.filter(i => i.category === category),
        warning: issues.warning.filter(i => i.category === category),
        info: issues.info.filter(i => i.category === category),
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
      for (const issue of categoryIssues.error) {
        log(`  ✗ ${issue.file}`, colors.red)
        log(`    ${issue.message}`, colors.red)
      }

      // Warnings
      for (const issue of categoryIssues.warning) {
        log(`  ⚠ ${issue.file}`, colors.yellow)
        log(`    ${issue.message}`, colors.yellow)
      }

      // Info
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
    log(`✓ Fixed ${fixedIssues.length} issue(s)`, colors.green)

    // Recount remaining issues
    const remainingIssues =
      issues.error.length + issues.warning.length - fixedIssues.length
    if (remainingIssues > 0) {
      log(
        `⚠ ${remainingIssues} issue(s) still require manual attention`,
        colors.yellow,
      )
    }
  }

  if (issues.error.length > 0 && fixedIssues.length < issues.error.length) {
    log('\n✗ Consistency check failed', colors.red)
    process.exitCode = 1
  } else if (issues.warning.length > 0) {
    log('\n⚠ Consistency check passed with warnings', colors.yellow)
  } else if (totalIssues === 0) {
    log('\n✓ Consistency check passed', colors.green)
  } else {
    log('\n✓ All fixable issues resolved', colors.green)
  }
}

main().catch(error => {
  log(`\nFatal error: ${error.message}`, colors.red)
  console.error(error.stack)
  process.exitCode = 1
})
