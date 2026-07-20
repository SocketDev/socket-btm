/**
 * @file Shared state + core helpers for check-consistency.mts: issue
 *   types, the module-scope mutable issue/pattern-stats containers,
 *   reportIssue/log/promptUser, and discoverPackages. Every check
 *   module and the orchestrator import from here so they observe the same
 *   mutable issues / fixableIssues / patternStats state. Split out so
 *   the orchestration file stays under the file-size cap.
 */

import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import readline from 'node:readline'

import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const MONOREPO_ROOT = path.join(__dirname, '..')
export const PACKAGES_DIR = path.join(MONOREPO_ROOT, 'packages')

export type IssueLevel = 'error' | 'info' | 'warning'

type JsonValue =
  | boolean
  | null
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type PackageJson = JsonObject & {
  dependencies?: Record<string, string> | undefined
  description?: string | undefined
  devDependencies?: Record<string, string> | undefined
  license?: string | undefined
  name?: string | undefined
  private?: boolean | undefined
  scripts?: Record<string, string> | undefined
  type?: string | undefined
  version?: string | undefined
}

export type PackageInfo = {
  name: string
  path: string
  pkgJson: PackageJson
}

export type Issue = {
  category: string
  file: string
  message: string
}

export type FixFn = () => Promise<string>

export type FixableIssue = Issue & {
  fix: FixFn
  level: IssueLevel
}

export type FixedIssue = {
  file: string
  level: IssueLevel
  message: string
  result: string
}

export type PatternRecord = {
  count: number
  packages: string[]
  values: Record<string, number>
}

export type DependencyPatternRecord = {
  count: number
  packages: string[]
  versions: Record<string, number>
}

export type Suggestion = {
  confidence: number
  description: string
  level: 'HIGH' | 'LOW' | 'MEDIUM' | 'VERY HIGH'
  missing: string[]
  suggested: string
  title: string
  type: 'dependency' | 'devDependency' | 'field' | 'script'
}

// ANSI colors for formatted output
// Note: This consistency checker requires precise color control for multi-level severity
// reports (errors in red, warnings in yellow, info in blue). The log() wrapper below
// delegates to @socketsecurity/lib-stable/logger.log() for all output, ensuring consistent
// logging behavior while adding color formatting. This is intentional and follows the
// Socket Security standard of using the centralized logger for all output.
export const colors = {
  blue: '\x1b[36m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  reset: '\x1b[0m',
  yellow: '\x1b[33m',
}

// Wrapper for logger.log() with color support for consistency report formatting
export function log(message: string, color = colors.reset): void {
  logger.log(`${color}${message}${colors.reset}`)
}

export const issues: Record<IssueLevel, Issue[]> = {
  error: [],
  info: [],
  warning: [],
}

export const fixableIssues: FixableIssue[] = []
export const fixedIssues: FixedIssue[] = []
export const patternStats: {
  dependencies: Record<string, DependencyPatternRecord>
  devDependencies: Record<string, DependencyPatternRecord>
  fields: Record<string, PatternRecord>
  scripts: Record<string, PatternRecord>
  total: number
} = {
  dependencies: {},
  devDependencies: {},
  fields: {},
  scripts: {},
  total: 0,
}

export function reportIssue(
  level: IssueLevel,
  category: string,
  message: string,
  file: string,
  fixFn?: FixFn,
): void {
  const issue = { category, file, message }
  issues[level].push(issue)

  // If a fix function is provided, store it as fixable
  if (fixFn) {
    fixableIssues.push({
      category,
      file,
      fix: fixFn,
      level,
      message,
    })
  }
}

/**
 * Prompts user for yes/no confirmation in interactive mode.
 */
// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function promptUser(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise<boolean>(resolve => {
    rl.question(`${question} (y/n): `, (answer: string) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

// ============================================================================
// Package Discovery
// ============================================================================

// oxlint-disable-next-line socket/sort-source-methods -- script ordered as a top-down checker pipeline (discover issues per category → batch fixes → report); alphabetizing would scatter the per-rule check flow.
export async function discoverPackages(): Promise<PackageInfo[]> {
  const entries = await fs.readdir(PACKAGES_DIR, {
    withFileTypes: true,
  })
  const packages: PackageInfo[] = []

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (!entry.isDirectory()) {
      continue
    }

    const pkgPath = path.join(PACKAGES_DIR, entry.name)
    const pkgJsonPath = path.join(pkgPath, 'package.json')

    if (!existsSync(pkgJsonPath)) {
      continue
    }

    const pkgJson = JSON.parse(
      await fs.readFile(pkgJsonPath, 'utf8'),
    ) as PackageJson
    packages.push({
      name: entry.name,
      path: pkgPath,
      pkgJson,
    })
  }

  return packages
}
