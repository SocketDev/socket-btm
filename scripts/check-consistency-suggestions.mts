/**
 * @file ML-powered pattern-suggestion pass for check-consistency.mts:
 *   collects cross-package script/dependency/field usage patterns and
 *   suggests additions above a confidence threshold. Split out of the main
 *   checker so the orchestration file stays under the file-size cap.
 */

import { colors, log, patternStats } from './check-consistency-state.mts'
import type { PackageInfo, Suggestion } from './check-consistency-state.mts'

// ============================================================================
// Pattern Analysis for ML-Powered Suggestions
// ============================================================================

/**
 * Collects patterns across all packages for ML-powered suggestions.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export function collectPatterns(packages: PackageInfo[]): void {
  patternStats.total = packages.length

  for (let i = 0, { length } = packages; i < length; i += 1) {
    const pkg = packages[i]!
    // Collect script patterns
    if (pkg.pkgJson.scripts) {
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const [scriptName, scriptValue] of Object.entries(
        pkg.pkgJson.scripts,
      )) {
        if (!patternStats.scripts[scriptName]) {
          patternStats.scripts[scriptName] = {
            count: 0,
            packages: [],
            values: {},
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
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const [depName, depVersion] of Object.entries(
        pkg.pkgJson.dependencies,
      )) {
        if (!patternStats.dependencies[depName]) {
          patternStats.dependencies[depName] = {
            count: 0,
            packages: [],
            versions: {},
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
      // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
      for (const [depName, depVersion] of Object.entries(
        pkg.pkgJson.devDependencies,
      )) {
        if (!patternStats.devDependencies[depName]) {
          patternStats.devDependencies[depName] = {
            count: 0,
            packages: [],
            versions: {},
          }
        }
        patternStats.devDependencies[depName].count++
        patternStats.devDependencies[depName].packages.push(pkg.name)
        patternStats.devDependencies[depName].versions[depVersion] =
          (patternStats.devDependencies[depName].versions[depVersion] || 0) + 1
      }
    }

    // Collect field patterns
    // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
          packages: [],
          values: {},
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
 * Calculate confidence score as percentage.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export function getConfidence(count: number, total: number): number {
  return (count / total) * 100
}

/**
 * Get confidence level based on percentage.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export function getConfidenceLevel(
  confidence: number,
): 'HIGH' | 'LOW' | 'MEDIUM' | 'VERY HIGH' {
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
 * Generates ML-powered suggestions based on pattern analysis.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export function generateSuggestions(packages: PackageInfo[]): Suggestion[] {
  const suggestions: Suggestion[] = []

  // Analyze script patterns
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
  for (const [scriptName, stats] of Object.entries(patternStats.scripts)) {
    const confidence = getConfidence(stats.count, patternStats.total)
    if (confidence >= 75) {
      // Find packages missing this script
      const missingPackages = packages
        .filter(pkg => !pkg.pkgJson.scripts || !pkg.pkgJson.scripts[scriptName])
        .map(pkg => pkg.name)

      if (missingPackages.length > 0) {
        // Find most common value
        const mostCommonEntry = Object.entries(stats.values).toSorted(
          ([, a], [, b]) => b - a,
        )[0]
        if (!mostCommonEntry) {
          continue
        }
        const mostCommonValue = mostCommonEntry[0]

        suggestions.push({
          confidence,
          description: `${stats.count}/${patternStats.total} packages have this script`,
          level: getConfidenceLevel(confidence),
          missing: missingPackages,
          suggested: `"${scriptName}": "${mostCommonValue}"`,
          title: `Add "${scriptName}" script`,
          type: 'script',
        })
      }
    }
  }

  // Analyze dependency patterns
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
        const mostCommonEntry = Object.entries(stats.versions).toSorted(
          ([, a], [, b]) => b - a,
        )[0]
        if (!mostCommonEntry) {
          continue
        }
        const mostCommonVersion = mostCommonEntry[0]

        suggestions.push({
          confidence,
          description: `${stats.count}/${patternStats.total} packages use this dependency`,
          level: getConfidenceLevel(confidence),
          missing: missingPackages,
          suggested: `"${depName}": "${mostCommonVersion}"`,
          title: `Consider adding "${depName}" dependency`,
          type: 'dependency',
        })
      }
    }
  }

  // Analyze devDependency patterns
  // oxlint-disable-next-line socket/prefer-cached-for-loop -- loop variable is destructured
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
        const mostCommonEntry = Object.entries(stats.versions).toSorted(
          ([, a], [, b]) => b - a,
        )[0]
        if (!mostCommonEntry) {
          continue
        }
        const mostCommonVersion = mostCommonEntry[0]

        suggestions.push({
          confidence,
          description: `${stats.count}/${patternStats.total} packages use this devDependency`,
          level: getConfidenceLevel(confidence),
          missing: missingPackages,
          suggested: `"${depName}": "${mostCommonVersion}"`,
          title: `Consider adding "${depName}" devDependency`,
          type: 'devDependency',
        })
      }
    }
  }

  // Sort by confidence (highest first)
  return suggestions.toSorted((a, b) => b.confidence - a.confidence)
}

/**
 * Displays ML-powered suggestions.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export function displaySuggestions(suggestions: Suggestion[]): void {
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

  for (let i = 0, { length } = suggestions; i < length; i += 1) {
    const suggestion = suggestions[i]!
    const confidenceColor =
      suggestion.level === 'HIGH' || suggestion.level === 'VERY HIGH'
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
