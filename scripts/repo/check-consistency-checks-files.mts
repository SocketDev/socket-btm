/**
 * @file Checks 1-4 for check-consistency.mts: required files, vitest
 *   config, test scripts, and coverage scripts. Split out of the main
 *   checker so the orchestration file stays under the file-size cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { colors, log, reportIssue } from './check-consistency-state.mts'
import type { PackageInfo } from './check-consistency-state.mts'

// ============================================================================
// Check 1: Required Files
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkRequiredFiles(
  packages: PackageInfo[],
): Promise<void> {
  log('\n[1/8] Checking required files…', colors.blue)

  for (
    let pkgIndex = 0, { length: pkgCount } = packages;
    pkgIndex < pkgCount;
    pkgIndex += 1
  ) {
    const pkg = packages[pkgIndex]!
    const requiredFiles: string[] = ['package.json', 'README.md']

    for (
      let fileIndex = 0, { length: fileCount } = requiredFiles;
      fileIndex < fileCount;
      fileIndex += 1
    ) {
      const file = requiredFiles[fileIndex]!
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
      const readme = await fs.readFile(path.join(pkg.path, 'README.md'), 'utf8')
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

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkVitestConfig(
  packages: PackageInfo[],
): Promise<void> {
  log('[2/8] Checking vitest configurations…', colors.blue)

  const vitestPackages = packages.filter(pkg =>
    existsSync(path.join(pkg.path, 'vitest.config.mts')),
  )

  for (let i = 0, { length } = vitestPackages; i < length; i += 1) {
    const pkg = vitestPackages[i]!
    const configPath = path.join(pkg.path, 'vitest.config.mts')
    const config = await fs.readFile(configPath, 'utf8')

    // Check if extending base config
    const needsMergeConfig = !config.includes('mergeConfig')
    const needsBaseImport = !config.includes(
      '../../.config/repo/vitest.config.mts',
    )

    if (needsMergeConfig || needsBaseImport) {
      reportIssue(
        'error',
        'vitest-config',
        'Vitest config must use mergeConfig to extend base config',
        `${pkg.name}/vitest.config.mts`,
        async () => {
          // Generate standard vitest config that extends base
          const standardConfig = `import { mergeConfig } from 'vitest/config'
import baseConfig from '../../.config/repo/vitest.config.mts'

export default mergeConfig(baseConfig, {
  test: {
    // Package-specific test configuration
  },
})
`
          await fs.writeFile(configPath, standardConfig, 'utf8')
          return 'Standardized vitest config to extend base config with mergeConfig'
        },
      )
    }

    if (!needsMergeConfig && needsBaseImport) {
      reportIssue(
        'error',
        'vitest-config',
        'Vitest config must import base config from ../../.config/repo/vitest.config.mts',
        `${pkg.name}/vitest.config.mts`,
      )
    }
  }
}

// ============================================================================
// Check 3: Test Scripts
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkTestScripts(packages: PackageInfo[]): Promise<void> {
  log('[3/8] Checking test scripts…', colors.blue)

  const PATTERNS = {
    envAware: 'dotenvx run --env-file=.env.test -- vitest run',
    makefile: 'dotenvx run --env-file=.env.test -- node scripts/test.mts',
    // node-smol runs vitest under a memory-limit wrapper so OOMs don't hang CI.
    memoryLimited: 'node scripts/test-with-memory-limit.mts',
    standard: 'vitest run',
  }

  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    const { scripts } = pkg.pkgJson

    if (!scripts || !scripts['test']) {
      reportIssue(
        'error',
        'test-scripts',
        'Missing test script in package.json',
        `${pkg.name}/package.json`,
      )
      continue
    }

    const testScript = scripts['test']
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

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function checkCoverageScripts(
  packages: PackageInfo[],
): Promise<void> {
  log('[4/8] Checking coverage scripts…', colors.blue)

  const C_PACKAGES = new Set(['binflate', 'binject', 'binpress'])
  const jsPackages = packages.filter(pkg => !C_PACKAGES.has(pkg.name))

  for (let i = 0, { length } = jsPackages; i < length; i += 1) {
    const pkg = jsPackages[i]!
    const { devDependencies, scripts } = pkg.pkgJson

    // Check for cover script (standardized name across the workspace).
    if (!scripts || !scripts['cover']) {
      reportIssue(
        'warning',
        'coverage',
        'Missing cover script (expected for JS/TS packages)',
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

    // Validate cover script runs coverage (either via `--coverage` for vitest,
    // or by calling the C-package gcov helper in bin-infra).
    const coverCmd = scripts['cover']
    const isVitest = coverCmd.includes('--coverage')
    const isGcovHelper =
      coverCmd.includes('run-coverage.js') ||
      coverCmd.includes('scripts/cover.mts')
    if (!isVitest && !isGcovHelper) {
      reportIssue(
        'error',
        'coverage',
        'cover script must include --coverage, run-coverage.js, or scripts/cover.mts',
        `${pkg.name}/package.json`,
      )
    }
  }
}
